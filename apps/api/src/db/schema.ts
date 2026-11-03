import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  assetClasses,
  cashDirections,
  categoryKinds,
  currencies,
  dataSources,
  institutionKinds,
  tradeTypes,
} from "@fc/shared";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};

/**
 * Decimal values (money, quantities, rates) are stored as TEXT so they keep
 * their exact value. Arithmetic happens in application code with decimal.js.
 */
const decimal = (name: string) => text(name);

export const institutions = sqliteTable("institutions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  kind: text("kind", { enum: institutionKinds }).notNull().default("broker"),
  documentNumber: text("document_number"),
  ...timestamps,
});

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    kind: text("kind", { enum: categoryKinds }).notNull(),
    parentId: integer("parent_id").references((): AnySQLiteColumn => categories.id, { onDelete: "set null" }),
    color: text("color"),
    ...timestamps,
  },
  // Note: SQLite treats NULLs as distinct, so this only prevents duplicate subcategories.
  // Duplicate top-level names are blocked in the route (see routes/index.ts).
  (t) => [uniqueIndex("categories_name_kind_parent").on(t.name, t.kind, t.parentId)],
);

export const cashTransactions = sqliteTable(
  "cash_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    description: text("description").notNull(),
    amount: decimal("amount").notNull(),
    direction: text("direction", { enum: cashDirections }).notNull(),
    currency: text("currency", { enum: currencies }).notNull().default("BRL"),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    institutionId: integer("institution_id").references(() => institutions.id, { onDelete: "set null" }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("cash_transactions_date").on(t.date), index("cash_transactions_category").on(t.categoryId)],
);

export const assets = sqliteTable("assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull().unique(),
  name: text("name"),
  assetClass: text("asset_class", { enum: assetClasses }).notNull(),
  currency: text("currency", { enum: currencies }).notNull().default("BRL"),
  isin: text("isin"),
  ...timestamps,
});

export const trades = sqliteTable(
  "trades",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    institutionId: integer("institution_id").references(() => institutions.id, { onDelete: "set null" }),
    tradeDate: text("trade_date").notNull(),
    type: text("type", { enum: tradeTypes }).notNull(),
    quantity: decimal("quantity"),
    unitPrice: decimal("unit_price"),
    fees: decimal("fees").notNull().default("0"),
    factor: decimal("factor"),
    currency: text("currency", { enum: currencies }).notNull().default("BRL"),
    fxRate: decimal("fx_rate"),
    isDayTrade: integer("is_day_trade", { mode: "boolean" }).notNull().default(false),
    source: text("source", { enum: dataSources }).notNull().default("manual"),
    externalId: text("external_id"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("trades_asset_date").on(t.assetId, t.tradeDate),
    // Imports from the same source never create the same record twice.
    uniqueIndex("trades_source_external_id").on(t.source, t.externalId),
  ],
);

export type Institution = typeof institutions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type CashTransaction = typeof cashTransactions.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Trade = typeof trades.$inferSelect;
