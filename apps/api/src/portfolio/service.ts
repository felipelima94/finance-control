import Decimal from "decimal.js";
import { eq, lte } from "drizzle-orm";
import type { ClassSummary } from "@fc/shared";
import type { Db } from "../db/client";
import { assets, trades } from "../db/schema";
import { computePortfolio, type EngineResult } from "./engine";

/** Loads trades (optionally up to a date) and runs the portfolio engine. */
export function loadPortfolio(db: Db, asOf?: string): EngineResult {
  const rows = db
    .select({
      id: trades.id,
      assetId: trades.assetId,
      ticker: assets.ticker,
      assetClass: assets.assetClass,
      currency: assets.currency,
      institutionId: trades.institutionId,
      tradeDate: trades.tradeDate,
      type: trades.type,
      quantity: trades.quantity,
      unitPrice: trades.unitPrice,
      fees: trades.fees,
      factor: trades.factor,
    })
    .from(trades)
    .innerJoin(assets, eq(trades.assetId, assets.id))
    .where(asOf ? lte(trades.tradeDate, asOf) : undefined)
    .all();
  return computePortfolio(rows);
}

export function summarize(result: EngineResult): ClassSummary[] {
  const map = new Map<string, { s: ClassSummary; cost: Decimal; realized: Decimal; dt: Decimal }>();
  for (const p of result.positions) {
    const key = `${p.assetClass}|${p.currency}`;
    const e = map.get(key) ?? {
      s: { assetClass: p.assetClass, currency: p.currency, positions: 0, totalCost: "0", realizedPnl: "0", dayTradePnl: "0" },
      cost: new Decimal(0),
      realized: new Decimal(0),
      dt: new Decimal(0),
    };
    if (!new Decimal(p.quantity).isZero()) e.s.positions++;
    e.cost = e.cost.plus(p.totalCost);
    e.realized = e.realized.plus(p.realizedPnl);
    e.dt = e.dt.plus(p.dayTradePnl);
    map.set(key, e);
  }
  return [...map.values()]
    .map(({ s, cost, realized, dt }) => ({
      ...s,
      totalCost: cost.toFixed(2),
      realizedPnl: realized.toFixed(2),
      dayTradePnl: dt.toFixed(2),
    }))
    .sort((a, b) => (a.currency === b.currency ? Number(b.totalCost) - Number(a.totalCost) : a.currency < b.currency ? -1 : 1));
}
