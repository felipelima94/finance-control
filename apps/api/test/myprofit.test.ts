import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createDb, type Db } from "../src/db/client";
import { importMyProfit, parseMyProfit } from "../src/importers/myprofit";

const HEADER = [
  "Data de negociação",
  "Instituição",
  "Número",
  "Documento",
  "Moeda",
  "Total de Taxas",
  "Ativo",
  "Grupo",
  "Quantidade",
  "Operação",
  "Tipo",
  "Preço sem taxas",
  "Preço com taxas",
  "Total sem taxas",
  "Total com taxas",
  "Obs",
];

type Row = [Date, string, string | number, string | null, string, number, string, string, number, string, string, number, number, number, number, string];

/** Same layout as the myProfit export: title rows first, header on row 5. */
async function makeXlsx(rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Relatório");
  ws.addRow([]);
  ws.addRow(["Período: 01/01/2019 até 30/11/2026"]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow(HEADER);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const day = (s: string) => new Date(`${s}T00:00:00Z`);

const sample: Row[] = [
  [day("2020-01-15"), "RICO", "B3_RICO_15012020", null, "BRL", 0.3, "HGLG11", "Fundo Imobiliário", 5, "Débito", "Compra", 199.95, 200.01, -999.75, -1000.05, "Normal"],
  [day("2020-02-15"), "RICO", "B3_RICO_15022020", null, "BRL", 0.31, "HGLG11", "Fundo Imobiliário", -2, "Crédito", "Venda", 209, 208.845, 418, 417.69, "Normal"],
  [day("2023-09-11"), "Avenue", "Avenue_11092023", null, "USD", 0, "O", "REIT", 4.80503, "Débito", "Compra", 55.088, 55.088, -264.7, -264.7, "Normal"],
  // Two identical rows on the same day share "Número"; both must be kept.
  [day("2023-09-11"), "Avenue", "Avenue_11092023", null, "USD", 0, "O", "REIT", 1, "Débito", "Compra", 55, 55, -55, -55, "Normal"],
  [day("2023-09-11"), "Avenue", "Avenue_11092023", null, "USD", 0, "O", "REIT", 1, "Débito", "Compra", 55, 55, -55, -55, "Normal"],
  [day("2022-08-05"), "NuInvest", 938344025, "Aplicação", "BRL", 0, "CDB Pós 125% CDI 28/07/2025", "CDB", 1, "Débito", "Compra", 1000, 1000, -1000, -1000, "Normal"],
  // Full redemption: quantity 0, price 0, only the total.
  [day("2025-07-28"), "NuInvest", 938344538, "Resgate Total", "BRL", 0, "CDB Pós 125% CDI 28/07/2025", "CDB", 0, "Crédito", "Venda", 0, 0, 1350.5, 1350.5, "Normal"],
  [day("2026-01-28"), "(Automático)", "93834__Sobras", "Venda", "BRL", 0, "ITSA4", "Ações", 1, "Débito", "Compra", 10, 10, -10, -10, "Normal"],
];

describe("parseMyProfit", () => {
  it("finds the header and reads every row", async () => {
    const { rows, errors } = await parseMyProfit(await makeXlsx(sample));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(sample.length);
    expect(rows[1]).toMatchObject({
      date: "2020-02-15",
      institution: "RICO",
      ticker: "HGLG11",
      side: "sell",
      quantity: "2",
      unitPrice: "209",
      fees: "0.31",
      currency: "BRL",
    });
    expect(rows[2]).toMatchObject({ quantity: "4.80503", unitPrice: "55.088", currency: "USD" });
    expect(rows[7]!.institution).toBe("Automático");
  });

  it("reports rows it cannot read", async () => {
    const bad: Row = [...sample[0]!];
    bad[10] = "Bonificação";
    const { rows, errors } = await parseMyProfit(await makeXlsx([sample[0]!, bad]));
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 7, message: expect.stringContaining("Bonificação") });
  });

  it("fails clearly when the header is missing", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").addRow(["foo", "bar"]);
    const { errors } = await parseMyProfit(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(errors[0]!.message).toMatch(/Data de negociação/);
  });
});

describe("importMyProfit", () => {
  let db: Db;
  let close: () => void;
  beforeEach(() => ({ db, close } = createDb(":memory:")));
  afterEach(() => close());

  it("creates institutions, assets and trades, and skips them on re-import", async () => {
    const parsed = await parseMyProfit(await makeXlsx(sample));
    const first = importMyProfit(db, parsed);
    expect(first).toMatchObject({ tradesCreated: 8, tradesSkipped: 0, assetsCreated: 4, institutionsCreated: 4, errors: [] });
    const again = importMyProfit(db, parsed);
    expect(again).toMatchObject({ tradesCreated: 0, tradesSkipped: 8, assetsCreated: 0, institutionsCreated: 0 });
  });

  it("does not write anything on a dry run", async () => {
    const parsed = await parseMyProfit(await makeXlsx(sample));
    expect(importMyProfit(db, parsed, { dryRun: true }).tradesCreated).toBe(8);
    expect(importMyProfit(db, parsed).tradesCreated).toBe(8);
  });
});

describe("portfolio routes", () => {
  let app: FastifyInstance;
  let close: () => void;
  beforeEach(async () => {
    const conn = createDb(":memory:");
    close = conn.close;
    app = await buildApp(conn.db);
  });
  afterEach(async () => {
    await app.close();
    close();
  });

  const upload = async (rows: Row[], query = "") =>
    app.inject({
      method: "POST",
      url: `/imports/myprofit${query}`,
      headers: { "content-type": "application/octet-stream" },
      payload: await makeXlsx(rows),
    });

  it("imports an upload and computes positions, sales and the class summary", async () => {
    const res = await upload(sample);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tradesCreated: 8, errors: [] });

    const positions = (await app.inject({ method: "GET", url: "/portfolio/positions" })).json();
    const hglg = positions.find((p: { ticker: string }) => p.ticker === "HGLG11");
    // (999.75 + 0.30) / 5 = 200.01; 3 left.
    expect(hglg).toMatchObject({ quantity: "3", averagePrice: "200.01", totalCost: "600.03" });
    // The CDB was fully redeemed, so it is only listed with includeClosed.
    expect(positions.some((p: { assetClass: string }) => p.assetClass === "fixed_income")).toBe(false);

    const all = (await app.inject({ method: "GET", url: "/portfolio/positions?includeClosed=true" })).json();
    const cdb = all.find((p: { assetClass: string }) => p.assetClass === "fixed_income");
    expect(cdb).toMatchObject({ quantity: "0", realizedPnl: "350.50" });

    const sales = (await app.inject({ method: "GET", url: "/portfolio/sales?from=2020-01-01&to=2020-12-31" })).json();
    // 2 × 209 − 0.31 − 2 × 200.01 = 17.67
    expect(sales).toEqual([expect.objectContaining({ ticker: "HGLG11", pnl: "17.67", dayTrade: false })]);

    const summary = (await app.inject({ method: "GET", url: "/portfolio/summary" })).json();
    expect(summary.find((s: { assetClass: string }) => s.assetClass === "reit")).toMatchObject({
      currency: "USD",
      positions: 1,
      totalCost: "374.70",
    });
  });

  it("rejects a body that is not an xlsx file", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/imports/myprofit",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("not a spreadsheet"),
    });
    expect(res.statusCode).toBe(400);
  });
});
