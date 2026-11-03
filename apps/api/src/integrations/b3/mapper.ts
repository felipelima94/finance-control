import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { AssetClass, TradeType } from "@fc/shared";
import type { B3Movements, EquitiesMovement, FixedIncomeMovement, TreasuryBondsMovement } from "./types";

/** A movement converted to what the trades table needs, or the reason it was left out. */
export type Mapped =
  | {
      kind: "trade";
      externalId: string;
      ticker: string;
      assetClass: AssetClass;
      institution: string;
      tradeDate: string;
      type: TradeType;
      quantity: string;
      unitPrice: string;
      /** For buys and sales: also present from another source (e.g. myProfit) is checked at import. */
      matchable: boolean;
      description: string;
    }
  | { kind: "ignored"; reason: string; movementType: string };

const normalize = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const isCredit = (m: { operationType: string }) => normalize(m.operationType).startsWith("cred");

/** Stable id from the movement's own fields, so syncing the same period twice skips what is there. */
function movementId(kind: string, m: object, n: number) {
  const json = JSON.stringify(m, Object.keys(m).sort());
  return createHash("sha1").update(`${kind}|${json}#${n}`).digest("hex");
}

function equitiesClass(m: EquitiesMovement): AssetClass {
  const t = normalize(`${m.productTypeName} ${m.productCategoryName}`);
  if (t.includes("imobili")) return "fii";
  if (t.includes("agro")) return "fiagro";
  if (t.includes("bdr")) return "bdr";
  if (t.includes("etf") || t.includes("indice")) return "etf_br";
  if (t.includes("direito") || t.includes("recibo") || t.includes("subscri")) return "subscription_right";
  return "stock_br";
}

function price(m: { unitPrice?: number | null; operationValue?: number | null }, quantity: Decimal) {
  if (m.unitPrice != null && m.unitPrice > 0) return new Decimal(String(m.unitPrice));
  if (m.operationValue != null && !quantity.isZero()) return new Decimal(String(Math.abs(m.operationValue))).div(quantity);
  return new Decimal(0);
}

/** Proventos are cash, not position changes. They are reported as ignored until cash import exists. */
const INCOME = ["rendimento", "dividendo", "juros", "amortizacao", "restituicao", "premio"];

function classify(movementType: string, credit: boolean): { type: TradeType; matchable: boolean } | { ignored: string } {
  const t = normalize(movementType);
  if (INCOME.some((w) => t.startsWith(w))) return { ignored: "Provento (vai para lançamentos numa próxima etapa)" };
  if (t === "compra" || t === "aplicacao" || t.startsWith("compra ")) return { type: "buy", matchable: true };
  if (t === "venda" || t.startsWith("venda ") || t.startsWith("resgate") || t === "vencimento") return { type: "sell", matchable: true };
  if (t.startsWith("transferencia - liquidacao") || t.startsWith("transferencia-liquidacao")) {
    return { type: credit ? "buy" : "sell", matchable: true };
  }
  // A split arrives as the extra shares credited; adding them at zero cost has the same effect as the factor.
  if (t.startsWith("desdobro") || t.startsWith("bonificacao")) {
    return credit ? { type: "bonus", matchable: false } : { ignored: "Débito de desdobramento ou bonificação" };
  }
  if (t.startsWith("grupamento")) return { ignored: "Grupamento: lance manualmente com o fator" };
  if (t.startsWith("fracao") || t.startsWith("leilao")) return { ignored: "Frações e leilão de frações" };
  if (t.startsWith("transferencia")) return { ignored: "Transferência de custódia entre corretoras" };
  if (t.startsWith("atualizacao")) return { ignored: "Atualização de saldo" };
  return { ignored: `Tipo não suportado` };
}

export function mapMovements(movements: B3Movements): Mapped[] {
  const out: Mapped[] = [];
  const seen = new Map<string, number>();
  const id = (kind: string, m: object) => {
    const key = `${kind}|${JSON.stringify(m, Object.keys(m).sort())}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return movementId(kind, m, n);
  };

  const push = (
    kind: string,
    m: EquitiesMovement | FixedIncomeMovement | TreasuryBondsMovement,
    ticker: string,
    assetClass: AssetClass,
    rawQuantity: number | null | undefined,
  ) => {
    const externalId = id(kind, m);
    const c = classify(m.movementType, isCredit(m));
    if ("ignored" in c) {
      out.push({ kind: "ignored", reason: c.ignored, movementType: m.movementType });
      return;
    }
    const quantity = new Decimal(String(Math.abs(rawQuantity ?? 0)));
    if (quantity.isZero()) {
      out.push({ kind: "ignored", reason: "Movimentação sem quantidade", movementType: m.movementType });
      return;
    }
    out.push({
      kind: "trade",
      externalId,
      ticker: ticker.trim().toUpperCase().slice(0, 100),
      assetClass,
      institution: m.participantName?.trim() || "B3",
      tradeDate: m.referenceDate.slice(0, 10),
      type: c.type,
      quantity: quantity.toString(),
      unitPrice: c.type === "bonus" && m.unitPrice == null ? "0" : price(m, quantity).toString(),
      matchable: c.matchable,
      description: `${m.movementType} (${m.operationType})`,
    });
  };

  for (const m of movements.equities) push("equities", m, m.tickerSymbol, equitiesClass(m), m.equitiesQuantity);
  for (const m of movements.fixedIncome) {
    const ticker =
      m.tickerSymbol?.trim() ||
      [m.productTypeName, m.corporationName, m.expirationDate?.slice(0, 10)].filter(Boolean).join(" ");
    push("fixed-income", m, ticker, "fixed_income", m.fixedIncomeQuantity);
  }
  for (const m of movements.treasuryBonds) {
    // Same name myProfit uses ("Tesouro IPCA+ 2035"), so both sources land on one asset.
    push("treasury", m, m.assetDescription?.trim() || m.tickerSymbol, "treasury", m.treasuryBondsQuantity);
  }
  return out;
}
