import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import type { AssetClass, Currency, ImportResult } from "@fc/shared";
import { currencies } from "@fc/shared";
import type { Db } from "../db/client";
import { assets, institutions, trades } from "../db/schema";
import { loadPortfolio } from "../portfolio/service";

/** One operation from the myProfit "Relatório Histórico de investimentos" export. */
export interface MyProfitRow {
  /** 1-based row number in the sheet, for error messages. */
  row: number;
  date: string;
  institution: string;
  number: string;
  currency: Currency;
  fees: string;
  ticker: string;
  group: string;
  /**
   * Signed in the export: positive for buys, negative for sales. Stored here as absolute.
   * "0" on a sale means a full redemption ("Resgate Total"): the quantity held is resolved at import.
   */
  quantity: string;
  /** Total value of the operation without fees, used to price full redemptions. */
  total: string;
  side: "buy" | "sell";
  unitPrice: string;
  dayTrade: boolean;
}

/** Maps the myProfit "Grupo" column to our asset classes. */
export const groupToAssetClass: Record<string, AssetClass> = {
  "ações": "stock_br",
  "fundo imobiliário": "fii",
  "fi agro": "fiagro",
  "fiagro": "fiagro",
  "bdr": "bdr",
  "etf": "etf_br",
  "etf brasil": "etf_br",
  "ações eua": "stock_us",
  "etf usa": "etf_us",
  "reit": "reit",
  "cdb": "fixed_income",
  "lci": "fixed_income",
  "lca": "fixed_income",
  "cri": "fixed_income",
  "cra": "fixed_income",
  "debênture": "fixed_income",
  "debêntures": "fixed_income",
  "renda fixa": "fixed_income",
  "tesouro direto": "treasury",
  "criptomoeda": "crypto",
  "criptomoedas": "crypto",
  "cripto": "crypto",
  "fundo de investimento": "fund",
  "fundos": "fund",
  "direito de subscrição": "subscription_right",
};

const HEADERS = {
  date: "data de negociação",
  institution: "instituição",
  number: "número",
  currency: "moeda",
  fees: "total de taxas",
  ticker: "ativo",
  group: "grupo",
  quantity: "quantidade",
  type: "tipo",
  price: "preço sem taxas",
  total: "total sem taxas",
  obs: "obs",
} as const;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object") {
    if (v instanceof Date) return v;
    if ("result" in v) return v.result; // formula
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return v.text; // hyperlink
  }
  return v;
}

function toIsoDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function toDecimal(v: unknown): Decimal | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Decimal(String(v));
  // Accept "1.234,56" (pt-BR) and "1234.56".
  let s = String(v).trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  try {
    return new Decimal(s);
  } catch {
    return null;
  }
}

export interface ParseResult {
  rows: MyProfitRow[];
  errors: { row: number; message: string }[];
}

/** Reads the first sheet of a myProfit export. The header row is found by its "Data de negociação" cell. */
export async function parseMyProfit(file: Buffer | ArrayBuffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs' Buffer type predates Node's generic Buffer; the runtime accepts both.
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ row: 0, message: "The file has no sheets" }] };

  let headerRow = 0;
  const col: Partial<Record<keyof typeof HEADERS, number>> = {};
  ws.eachRow((row, n) => {
    if (headerRow) return;
    const values = (row.values as ExcelJS.CellValue[]).map((v) => norm(cellValue(v)));
    if (values.includes(HEADERS.date)) {
      headerRow = n;
      for (const [key, label] of Object.entries(HEADERS)) {
        const idx = values.indexOf(label);
        if (idx > 0) col[key as keyof typeof HEADERS] = idx;
      }
    }
  });
  if (!headerRow) {
    return { rows: [], errors: [{ row: 0, message: 'Header row with "Data de negociação" not found' }] };
  }
  const required: (keyof typeof HEADERS)[] = ["date", "institution", "currency", "ticker", "group", "quantity", "type", "price"];
  const missing = required.filter((k) => !col[k]);
  if (missing.length) {
    return {
      rows: [],
      errors: [{ row: headerRow, message: `Missing columns: ${missing.map((k) => HEADERS[k]).join(", ")}` }],
    };
  }

  const rows: MyProfitRow[] = [];
  const errors: ParseResult["errors"] = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const get = (k: keyof typeof HEADERS) => (col[k] ? cellValue(row.getCell(col[k]!).value) : undefined);
    const rawDate = get("date");
    const ticker = String(get("ticker") ?? "").trim();
    if (!rawDate && !ticker) return; // blank line

    const fail = (message: string) => errors.push({ row: n, message });
    const date = toIsoDate(rawDate);
    if (!date) return fail(`Invalid date: ${String(rawDate)}`);
    if (!ticker) return fail("Missing asset");

    const type = norm(get("type"));
    const side = type === "compra" ? "buy" : type === "venda" ? "sell" : null;
    if (!side) return fail(`Unsupported operation type "${String(get("type"))}"`);

    const quantity = toDecimal(get("quantity"))?.abs() ?? new Decimal(0);
    const total = toDecimal(get("total"))?.abs() ?? new Decimal(0);
    const fullRedemption = side === "sell" && quantity.isZero() && !total.isZero();
    if (quantity.isZero() && !fullRedemption) return fail("Missing quantity");

    // Redemptions (e.g. "Resgate Total" of a CDB) often come with price 0 and only the total filled in.
    let unitPrice = toDecimal(get("price")) ?? new Decimal(0);
    if (unitPrice.isZero() && !quantity.isZero()) unitPrice = total.div(quantity);

    const currency = String(get("currency") ?? "BRL").trim().toUpperCase() as Currency;
    if (!currencies.includes(currency)) return fail(`Unsupported currency "${currency}"`);

    const institution = String(get("institution") ?? "").trim().replace(/^\((.*)\)$/, "$1") || "Desconhecida";

    rows.push({
      row: n,
      date,
      institution,
      number: String(get("number") ?? "").trim(),
      currency,
      fees: (toDecimal(get("fees")) ?? new Decimal(0)).abs().toString(),
      ticker: ticker.toUpperCase(),
      group: String(get("group") ?? "").trim(),
      quantity: quantity.toString(),
      total: total.toString(),
      side,
      unitPrice: unitPrice.toString(),
      dayTrade: norm(get("obs")) === "daytrade",
    });
  });

  return { rows, errors };
}

/**
 * Stable id for a row so re-importing the same file skips what is already there.
 * The myProfit "Número" is shared by every operation of a day, so the id hashes the
 * row's content and adds a counter for rows that are otherwise identical.
 */
export function externalIds(rows: MyProfitRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = [r.date, r.institution, r.number, r.ticker, r.side, r.quantity, r.unitPrice, r.fees, r.dayTrade].join("|");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return createHash("sha1").update(`${key}#${n}`).digest("hex");
  });
}

/** Writes parsed rows to the database, creating institutions and assets as needed. */
export function importMyProfit(
  db: Db,
  parsed: ParseResult,
  opts: { dryRun?: boolean } = {},
): ImportResult {
  const result: ImportResult = {
    dryRun: !!opts.dryRun,
    rowsRead: parsed.rows.length + parsed.errors.filter((e) => e.row > 0).length,
    tradesCreated: 0,
    tradesSkipped: 0,
    assetsCreated: 0,
    institutionsCreated: 0,
    errors: [...parsed.errors],
  };
  const ids = externalIds(parsed.rows);

  const run = () => {
    const instCache = new Map<string, number>();
    const assetCache = new Map<string, number>();

    const institutionId = (name: string) => {
      const cached = instCache.get(name);
      if (cached) return cached;
      let row = db.select({ id: institutions.id }).from(institutions).where(eq(institutions.name, name)).get();
      if (!row) {
        row = db.insert(institutions).values({ name, kind: "broker" }).returning({ id: institutions.id }).get();
        result.institutionsCreated++;
      }
      instCache.set(name, row.id);
      return row.id;
    };

    const assetId = (r: MyProfitRow): number | null => {
      const cached = assetCache.get(r.ticker);
      if (cached) return cached;
      let row = db.select({ id: assets.id }).from(assets).where(eq(assets.ticker, r.ticker)).get();
      if (!row) {
        const assetClass = groupToAssetClass[r.group.toLowerCase()];
        if (!assetClass) {
          result.errors.push({ row: r.row, message: `Unknown group "${r.group}" for ${r.ticker}` });
          return null;
        }
        row = db
          .insert(assets)
          .values({ ticker: r.ticker, assetClass, currency: r.currency })
          .returning({ id: assets.id })
          .get();
        result.assetsCreated++;
      }
      assetCache.set(r.ticker, row.id);
      return row.id;
    };

    const insertRow = (r: MyProfitRow, idx: number) => {
      const externalId = ids[idx]!;
      const exists = db
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.source, "myprofit"), eq(trades.externalId, externalId)))
        .get();
      if (exists) {
        result.tradesSkipped++;
        return;
      }
      const aId = assetId(r);
      if (aId == null) return;
      let { quantity, unitPrice } = r;
      if (new Decimal(quantity).isZero()) {
        // Full redemption: sell whatever is held of this asset on that date.
        const held = loadPortfolio(db, r.date).positions.find((p) => p.assetId === aId)?.quantity ?? "0";
        if (new Decimal(held).lte(0)) {
          result.errors.push({ row: r.row, message: `Full redemption of ${r.ticker} but no position was held` });
          return;
        }
        quantity = held;
        unitPrice = new Decimal(r.total).div(held).toString();
      }
      db.insert(trades)
        .values({
          assetId: aId,
          institutionId: institutionId(r.institution),
          tradeDate: r.date,
          type: r.side,
          quantity,
          unitPrice,
          fees: r.fees,
          currency: r.currency,
          isDayTrade: r.dayTrade,
          source: "myprofit",
          externalId,
          notes: r.number ? `myProfit ${r.number}` : null,
        })
        .run();
      result.tradesCreated++;
    };

    // Regular rows first, then full redemptions, which need the positions built by the others.
    const isFull = (r: MyProfitRow) => new Decimal(r.quantity).isZero();
    parsed.rows.forEach((r, idx) => !isFull(r) && insertRow(r, idx));
    parsed.rows.forEach((r, idx) => isFull(r) && insertRow(r, idx));
  };

  // Everything in one transaction; a dry run rolls back at the end.
  const DRY_RUN = Symbol("dry-run");
  try {
    db.transaction(() => {
      run();
      if (opts.dryRun) throw DRY_RUN;
    });
  } catch (e) {
    if (e !== DRY_RUN) throw e;
  }
  return result;
}
