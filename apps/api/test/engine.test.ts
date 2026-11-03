import { describe, expect, it } from "vitest";
import { computePortfolio, type EngineTrade } from "../src/portfolio/engine";

let nextId = 1;
const t = (p: Partial<EngineTrade> & Pick<EngineTrade, "tradeDate" | "type">): EngineTrade => ({
  id: nextId++,
  assetId: 1,
  ticker: "ITSA4",
  assetClass: "stock_br",
  currency: "BRL",
  institutionId: 1,
  quantity: null,
  unitPrice: null,
  fees: "0",
  factor: null,
  ...p,
});

describe("average price", () => {
  it("includes fees in the cost and keeps the average on sales", () => {
    const { positions, sales } = computePortfolio([
      t({ tradeDate: "2024-01-02", type: "buy", quantity: "100", unitPrice: "10", fees: "1" }),
      t({ tradeDate: "2024-02-01", type: "buy", quantity: "100", unitPrice: "12", fees: "1" }),
      t({ tradeDate: "2024-03-01", type: "sell", quantity: "50", unitPrice: "15", fees: "0.5" }),
    ]);
    const p = positions[0]!;
    // (1000 + 1 + 1200 + 1) / 200 = 11.01
    expect(p.quantity).toBe("150");
    expect(p.averagePrice).toBe("11.01");
    expect(p.totalCost).toBe("1651.50");
    // 50 × 15 − 0.5 − 50 × 11.01 = 199
    expect(sales[0]).toMatchObject({ quantity: "50", proceeds: "749.50", cost: "550.50", pnl: "199.00", dayTrade: false });
    expect(p.realizedPnl).toBe("199.00");
  });

  it("resets the average after the position is closed", () => {
    const { positions } = computePortfolio([
      t({ tradeDate: "2024-01-02", type: "buy", quantity: "10", unitPrice: "10" }),
      t({ tradeDate: "2024-01-03", type: "sell", quantity: "10", unitPrice: "11" }),
      t({ tradeDate: "2024-01-04", type: "buy", quantity: "10", unitPrice: "20" }),
    ]);
    expect(positions[0]).toMatchObject({ quantity: "10", averagePrice: "20", realizedPnl: "10.00" });
  });

  it("handles fractional quantities without float errors", () => {
    const { positions } = computePortfolio([
      t({ tradeDate: "2023-09-11", type: "buy", quantity: "4.80503", unitPrice: "55.088", currency: "USD" }),
      t({ tradeDate: "2023-10-11", type: "buy", quantity: "0.1", unitPrice: "0.2", currency: "USD" }),
      t({ tradeDate: "2023-11-11", type: "sell", quantity: "4.90503", unitPrice: "60", currency: "USD" }),
    ]);
    expect(positions[0]).toMatchObject({ quantity: "0", averagePrice: "0", totalCost: "0.00" });
  });
});

describe("corporate events", () => {
  it("applies splits, reverse splits and bonus shares", () => {
    const { positions } = computePortfolio([
      t({ tradeDate: "2024-01-02", type: "buy", quantity: "100", unitPrice: "20" }),
      t({ tradeDate: "2024-04-16", type: "split", factor: "2" }),
      t({ tradeDate: "2024-05-01", type: "bonus", quantity: "20", unitPrice: "5" }),
      t({ tradeDate: "2024-06-01", type: "reverse_split", factor: "10" }),
    ]);
    // 100 × 2 = 200, + 20 bonus = 220, / 10 = 22. Cost 2000 + 100 = 2100.
    expect(positions[0]).toMatchObject({ quantity: "22", totalCost: "2100.00", averagePrice: "95.454545" });
  });

  it("applies an event before trades on the same day", () => {
    const { positions } = computePortfolio([
      t({ tradeDate: "2024-01-02", type: "buy", quantity: "10", unitPrice: "20" }),
      t({ tradeDate: "2024-04-16", type: "buy", quantity: "10", unitPrice: "10" }),
      t({ tradeDate: "2024-04-16", type: "split", factor: "2" }),
    ]);
    // Only the 10 shares held before the ex-date are split: 20 + 10 = 30.
    expect(positions[0]).toMatchObject({ quantity: "30", totalCost: "300.00" });
  });

  it("moves cost between assets with transfers (e.g. a ticker change)", () => {
    const { positions } = computePortfolio([
      t({ assetId: 1, ticker: "NUBR33", tradeDate: "2022-01-02", type: "buy", quantity: "10", unitPrice: "9" }),
      t({ assetId: 1, ticker: "NUBR33", tradeDate: "2023-01-02", type: "transfer_out", quantity: "10", unitPrice: "9" }),
      t({ assetId: 2, ticker: "ROXO34", tradeDate: "2023-01-02", type: "transfer_in", quantity: "10", unitPrice: "9" }),
    ]);
    expect(positions.find((p) => p.ticker === "NUBR33")).toMatchObject({ quantity: "0", realizedPnl: "0.00" });
    expect(positions.find((p) => p.ticker === "ROXO34")).toMatchObject({ quantity: "10", averagePrice: "9" });
  });
});

describe("day trade", () => {
  it("nets same-day buys and sales per institution and keeps the swing average", () => {
    const { positions, sales } = computePortfolio([
      t({ tradeDate: "2024-01-02", type: "buy", quantity: "100", unitPrice: "20" }),
      // Same day at the same broker: buy 10 and sell 36 → 10 are day trade, 26 come from the position.
      t({ tradeDate: "2024-02-01", type: "buy", quantity: "10", unitPrice: "20.67", fees: "0.06" }),
      t({ tradeDate: "2024-02-01", type: "sell", quantity: "20", unitPrice: "21", fees: "0.12" }),
      t({ tradeDate: "2024-02-01", type: "sell", quantity: "16", unitPrice: "21", fees: "0.10" }),
    ]);
    const dt = sales.find((s) => s.dayTrade)!;
    const swing = sales.find((s) => !s.dayTrade)!;
    expect(dt.quantity).toBe("10");
    expect(dt.cost).toBe("206.76");
    expect(swing.quantity).toBe("26");
    expect(swing.cost).toBe("520.00");
    expect(positions[0]).toMatchObject({ quantity: "74", averagePrice: "20" });
  });

  it("does not treat buys and sales at different institutions as day trade", () => {
    const { sales } = computePortfolio([
      t({ tradeDate: "2024-01-02", type: "buy", quantity: "10", unitPrice: "10", institutionId: 1 }),
      t({ tradeDate: "2024-02-01", type: "buy", quantity: "10", unitPrice: "12", institutionId: 2 }),
      t({ tradeDate: "2024-02-01", type: "sell", quantity: "10", unitPrice: "13", institutionId: 1 }),
    ]);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ dayTrade: false, cost: "110.00", pnl: "20.00" });
  });
});

describe("data gaps", () => {
  it("warns when selling more than is held and counts only the held quantity", () => {
    const { positions, sales } = computePortfolio([
      t({ tradeDate: "2024-01-02", type: "buy", quantity: "120", unitPrice: "10" }),
      t({ tradeDate: "2024-08-19", type: "sell", quantity: "210", unitPrice: "28" }),
    ]);
    expect(positions[0]!.warnings[0]).toMatch(/venda de 210, mas só havia 120/);
    expect(positions[0]!.quantity).toBe("0");
    expect(sales[0]).toMatchObject({ quantity: "120", proceeds: "3360.00", cost: "1200.00" });
  });
});
