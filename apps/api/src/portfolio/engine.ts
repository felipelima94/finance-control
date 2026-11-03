import Decimal from "decimal.js";
import type { AssetClass, Currency, Position, Sale, TradeType } from "@fc/shared";

/** A trade joined with its asset, as the engine needs it. Decimals are strings, like in the database. */
export interface EngineTrade {
  id: number;
  assetId: number;
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  institutionId: number | null;
  tradeDate: string;
  type: TradeType;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  factor: string | null;
}

export interface EngineResult {
  positions: Position[];
  sales: Sale[];
}

const ZERO = new Decimal(0);
/** Quantities smaller than this are treated as zero (rounding leftovers from fractional assets). */
const DUST = new Decimal("1e-8");

const d = (v: string | null | undefined) => (v == null || v === "" ? ZERO : new Decimal(v));
const money = (v: Decimal) => v.toDecimalPlaces(2).toFixed(2);
const price = (v: Decimal) => v.toDecimalPlaces(6).toString();
const qty = (v: Decimal) => v.toDecimalPlaces(8).toString();

interface State {
  quantity: Decimal;
  cost: Decimal;
  realized: Decimal;
  dayTrade: Decimal;
  first: string;
  last: string;
  warnings: string[];
}

/**
 * Computes positions and realized results using the Brazilian average cost method
 * (preço médio, as required by the Receita Federal):
 *
 * - Buys add quantity and cost (quantity × price + fees). The average price is cost / quantity.
 * - Sales remove quantity at the current average price. The average price does not change.
 *   Result = (quantity × price − fees) − quantity × average price.
 * - Splits multiply the quantity (the cost stays, so the average price drops). Reverse splits divide it.
 * - Bonus shares add quantity at the cost assigned by the company (often zero).
 * - Day trades (buy and sell of the same asset, same day, same institution) are netted first:
 *   the matched quantity is valued at that day's average buy and sell prices, reported
 *   separately, and does not affect the position's average price.
 *
 * Positions are aggregated per asset across institutions. On a given day, corporate events
 * are applied before trades, and buys before sales.
 */
export function computePortfolio(trades: EngineTrade[]): EngineResult {
  const sorted = [...trades].sort((a, b) =>
    a.assetId !== b.assetId
      ? a.assetId - b.assetId
      : a.tradeDate < b.tradeDate
        ? -1
        : a.tradeDate > b.tradeDate
          ? 1
          : a.id - b.id,
  );

  const positions: Position[] = [];
  const sales: Sale[] = [];

  let i = 0;
  while (i < sorted.length) {
    const assetId = sorted[i]!.assetId;
    const assetTrades: EngineTrade[] = [];
    while (i < sorted.length && sorted[i]!.assetId === assetId) assetTrades.push(sorted[i++]!);
    const info = assetTrades[0]!;

    const st: State = {
      quantity: ZERO,
      cost: ZERO,
      realized: ZERO,
      dayTrade: ZERO,
      first: info.tradeDate,
      last: info.tradeDate,
      warnings: [],
    };

    const sale = (t: { date: string; institutionId: number | null }, q: Decimal, proceeds: Decimal, cost: Decimal, dayTrade: boolean) => {
      const pnl = proceeds.minus(cost);
      if (dayTrade) st.dayTrade = st.dayTrade.plus(pnl);
      else st.realized = st.realized.plus(pnl);
      sales.push({
        date: t.date,
        assetId,
        ticker: info.ticker,
        assetClass: info.assetClass,
        currency: info.currency,
        institutionId: t.institutionId,
        quantity: qty(q),
        proceeds: money(proceeds),
        cost: money(cost),
        pnl: money(pnl),
        dayTrade,
      });
    };

    let j = 0;
    while (j < assetTrades.length) {
      const date = assetTrades[j]!.tradeDate;
      const day: EngineTrade[] = [];
      while (j < assetTrades.length && assetTrades[j]!.tradeDate === date) day.push(assetTrades[j++]!);
      st.last = date;
      applyDay(st, day, date, sale);
      if (st.quantity.abs().lt(DUST)) {
        st.quantity = ZERO;
        st.cost = ZERO;
      }
    }

    positions.push({
      assetId,
      ticker: info.ticker,
      assetClass: info.assetClass,
      currency: info.currency,
      quantity: qty(st.quantity),
      averagePrice: st.quantity.isZero() ? "0" : price(st.cost.div(st.quantity)),
      totalCost: money(st.cost),
      realizedPnl: money(st.realized),
      dayTradePnl: money(st.dayTrade),
      firstTradeDate: st.first,
      lastTradeDate: st.last,
      warnings: st.warnings,
    });
  }

  sales.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.assetId - b.assetId));
  return { positions, sales };
}

type SaleFn = (
  t: { date: string; institutionId: number | null },
  q: Decimal,
  proceeds: Decimal,
  cost: Decimal,
  dayTrade: boolean,
) => void;

function applyDay(st: State, day: EngineTrade[], date: string, sale: SaleFn) {
  // 1. Corporate events.
  for (const t of day) {
    if (t.type === "split") {
      st.quantity = st.quantity.times(d(t.factor));
    } else if (t.type === "reverse_split") {
      st.quantity = st.quantity.div(d(t.factor));
    } else if (t.type === "bonus") {
      const q = d(t.quantity);
      st.quantity = st.quantity.plus(q);
      st.cost = st.cost.plus(q.times(d(t.unitPrice)));
    }
  }

  // 2. Custody transfers. Moving shares between institutions does not change the aggregated
  //    average price; a transfer in from outside the app brings its own cost.
  for (const t of day) {
    if (t.type === "transfer_in") {
      const q = d(t.quantity);
      st.quantity = st.quantity.plus(q);
      st.cost = st.cost.plus(q.times(d(t.unitPrice)));
    } else if (t.type === "transfer_out") {
      const q = Decimal.min(d(t.quantity), st.quantity);
      if (!st.quantity.isZero()) st.cost = st.cost.minus(st.cost.div(st.quantity).times(q));
      st.quantity = st.quantity.minus(q);
    }
  }

  // 3. Buys and sales, netting day trades per institution.
  const byInstitution = new Map<number | null, { bq: Decimal; bc: Decimal; sq: Decimal; sp: Decimal }>();
  for (const t of day) {
    const isBuy = t.type === "buy" || t.type === "subscription";
    if (!isBuy && t.type !== "sell") continue;
    const g = byInstitution.get(t.institutionId) ?? { bq: ZERO, bc: ZERO, sq: ZERO, sp: ZERO };
    const q = d(t.quantity);
    const gross = q.times(d(t.unitPrice));
    if (isBuy) {
      g.bq = g.bq.plus(q);
      g.bc = g.bc.plus(gross).plus(d(t.fees));
    } else {
      g.sq = g.sq.plus(q);
      g.sp = g.sp.plus(gross).minus(d(t.fees));
    }
    byInstitution.set(t.institutionId, g);
  }

  const pendingSales: { institutionId: number | null; q: Decimal; proceeds: Decimal }[] = [];
  for (const [institutionId, g] of byInstitution) {
    let { bq, bc, sq, sp } = g;
    const dt = Decimal.min(bq, sq);
    if (dt.gt(0)) {
      const dtCost = bc.times(dt).div(bq);
      const dtProceeds = sp.times(dt).div(sq);
      sale({ date, institutionId }, dt, dtProceeds, dtCost, true);
      bq = bq.minus(dt);
      bc = bc.minus(dtCost);
      sq = sq.minus(dt);
      sp = sp.minus(dtProceeds);
    }
    if (bq.gt(0)) {
      st.quantity = st.quantity.plus(bq);
      st.cost = st.cost.plus(bc);
    }
    if (sq.gt(0)) pendingSales.push({ institutionId, q: sq, proceeds: sp });
  }

  for (const s of pendingSales) {
    let { q, proceeds } = s;
    if (q.minus(st.quantity).gt(DUST)) {
      st.warnings.push(
        `${date}: venda de ${qty(q)}, mas só havia ${qty(st.quantity)} em carteira; só a quantidade em carteira entrou no cálculo`,
      );
      if (st.quantity.lte(0)) continue;
      proceeds = proceeds.times(st.quantity).div(q);
      q = st.quantity;
    }
    const avg = st.quantity.isZero() ? ZERO : st.cost.div(st.quantity);
    const cost = Decimal.min(avg.times(q), st.cost);
    sale({ date, institutionId: s.institutionId }, q, proceeds, cost, false);
    st.quantity = st.quantity.minus(q);
    st.cost = st.cost.minus(cost);
  }
}
