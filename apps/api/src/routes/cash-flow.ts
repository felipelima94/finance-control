import Decimal from "decimal.js";
import { and, eq, gte, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { cashFlowQuery, type CashFlowSummary } from "@fc/shared";
import type { Db } from "../db/client";
import { cashTransactions, categories } from "../db/schema";

/** Totals of money in and out per month and per category, for one currency. */
export function cashFlowSummary(db: Db, q: { from?: string; to?: string; currency: string }): CashFlowSummary {
  const rows = db
    .select({
      date: cashTransactions.date,
      amount: cashTransactions.amount,
      direction: cashTransactions.direction,
      categoryId: cashTransactions.categoryId,
      categoryName: categories.name,
      parentId: categories.parentId,
    })
    .from(cashTransactions)
    .leftJoin(categories, eq(cashTransactions.categoryId, categories.id))
    .where(
      and(
        eq(cashTransactions.currency, q.currency as "BRL"),
        q.from ? gte(cashTransactions.date, q.from) : undefined,
        q.to ? lte(cashTransactions.date, q.to) : undefined,
      ),
    )
    .all();

  const months = new Map<string, { in: Decimal; out: Decimal }>();
  const cats = new Map<string, { categoryId: number | null; name: string; direction: "in" | "out"; total: Decimal; count: number }>();
  let totalIn = new Decimal(0);
  let totalOut = new Decimal(0);

  for (const r of rows) {
    const amount = new Decimal(r.amount);
    const month = r.date.slice(0, 7);
    const m = months.get(month) ?? { in: new Decimal(0), out: new Decimal(0) };
    m[r.direction] = m[r.direction].plus(amount);
    months.set(month, m);
    if (r.direction === "in") totalIn = totalIn.plus(amount);
    else totalOut = totalOut.plus(amount);

    const key = `${r.direction}|${r.categoryId ?? "none"}`;
    const c = cats.get(key) ?? {
      categoryId: r.categoryId,
      name: r.categoryName ?? "Sem categoria",
      direction: r.direction,
      total: new Decimal(0),
      count: 0,
    };
    c.total = c.total.plus(amount);
    c.count++;
    cats.set(key, c);
  }

  return {
    currency: q.currency as CashFlowSummary["currency"],
    totals: { in: totalIn.toFixed(2), out: totalOut.toFixed(2), net: totalIn.minus(totalOut).toFixed(2) },
    months: [...months.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, v]) => ({ month, in: v.in.toFixed(2), out: v.out.toFixed(2), net: v.in.minus(v.out).toFixed(2) })),
    categories: [...cats.values()]
      .sort((a, b) => b.total.comparedTo(a.total))
      .map((c) => ({ ...c, total: c.total.toFixed(2) })),
  };
}

export function registerCashFlowRoutes(app: FastifyInstance, db: Db) {
  app.get("/cash-flow/summary", async (req) => cashFlowSummary(db, cashFlowQuery.parse(req.query)));
}
