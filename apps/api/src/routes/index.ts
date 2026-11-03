import { and, asc, desc, eq, gte, isNull, lte, ne, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  assetInput,
  cashTransactionInput,
  cashTransactionQuery,
  categoryInput,
  institutionInput,
  tradeInput,
  tradeQuery,
} from "@fc/shared";
import type { Db } from "../db/client";
import { assets, cashTransactions, categories, institutions, trades } from "../db/schema";
import { ConflictError } from "../errors";
import { registerCrud } from "./crud";
import { registerCashFlowRoutes } from "./cash-flow";
import { registerPortfolioRoutes } from "./portfolio";

const all = (conds: (SQL | undefined)[]) => {
  const list = conds.filter((c): c is SQL => c !== undefined);
  return list.length ? and(...list) : undefined;
};

export function registerRoutes(app: FastifyInstance, db: Db) {
  app.get("/health", async () => ({ status: "ok" }));
  registerPortfolioRoutes(app, db);
  registerCashFlowRoutes(app, db);

  registerCrud(app, db, {
    path: "/institutions",
    name: "Institution",
    table: institutions,
    input: institutionInput,
    orderBy: [asc(institutions.name)],
  });

  registerCrud(app, db, {
    path: "/categories",
    name: "Category",
    table: categories,
    input: categoryInput,
    orderBy: [asc(categories.kind), asc(categories.name)],
    validate: (data, id) => {
      if (data.parentId != null) return; // covered by the unique index
      const dup = db
        .select({ id: categories.id })
        .from(categories)
        .where(
          all([
            eq(categories.name, data.name as string),
            eq(categories.kind, data.kind as "income" | "expense"),
            isNull(categories.parentId),
            id ? ne(categories.id, id) : undefined,
          ]),
        )
        .get();
      if (dup) throw new ConflictError("A top-level category with this name already exists");
    },
  });

  registerCrud(app, db, {
    path: "/cash-transactions",
    name: "Cash transaction",
    table: cashTransactions,
    input: cashTransactionInput,
    orderBy: [desc(cashTransactions.date), desc(cashTransactions.id)],
    listFilter: (query) => {
      const q = cashTransactionQuery.parse(query);
      return all([
        q.from ? gte(cashTransactions.date, q.from) : undefined,
        q.to ? lte(cashTransactions.date, q.to) : undefined,
        q.categoryId ? eq(cashTransactions.categoryId, q.categoryId) : undefined,
        q.direction ? eq(cashTransactions.direction, q.direction) : undefined,
      ]);
    },
  });

  registerCrud(app, db, {
    path: "/assets",
    name: "Asset",
    table: assets,
    input: assetInput,
    orderBy: [asc(assets.ticker)],
  });

  registerCrud(app, db, {
    path: "/trades",
    name: "Trade",
    table: trades,
    input: tradeInput,
    orderBy: [asc(trades.tradeDate), asc(trades.id)],
    listFilter: (query) => {
      const q = tradeQuery.parse(query);
      return all([
        q.assetId ? eq(trades.assetId, q.assetId) : undefined,
        q.institutionId ? eq(trades.institutionId, q.institutionId) : undefined,
        q.from ? gte(trades.tradeDate, q.from) : undefined,
        q.to ? lte(trades.tradeDate, q.to) : undefined,
      ]);
    },
  });
}
