import { z } from "zod";
import type { AssetClass, Currency } from "./enums";
import { isoDate } from "./schemas";

/** All decimal values are strings. Money is rounded to 2 places, prices to 6, quantities to 8. */
export interface Position {
  assetId: number;
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  quantity: string;
  averagePrice: string;
  /** Amount invested in the current position, fees included (quantity × average price). */
  totalCost: string;
  /** Profit or loss already realized by regular (swing trade) sales. */
  realizedPnl: string;
  /** Profit or loss realized by day trades. */
  dayTradePnl: string;
  firstTradeDate: string;
  lastTradeDate: string;
  warnings: string[];
}

export interface Sale {
  date: string;
  assetId: number;
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  institutionId: number | null;
  quantity: string;
  /** Sale value net of fees. */
  proceeds: string;
  /** Average cost of the quantity sold. */
  cost: string;
  pnl: string;
  dayTrade: boolean;
}

export interface ClassSummary {
  assetClass: AssetClass;
  currency: Currency;
  positions: number;
  totalCost: string;
  realizedPnl: string;
  dayTradePnl: string;
}

export const positionsQuery = z.object({
  asOf: isoDate.optional(),
  includeClosed: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const salesQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  assetId: z.coerce.number().int().positive().optional(),
});

export interface ImportResult {
  dryRun: boolean;
  rowsRead: number;
  tradesCreated: number;
  tradesSkipped: number;
  assetsCreated: number;
  institutionsCreated: number;
  errors: { row: number; message: string }[];
}

export const cashFlowQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  currency: z.enum(["BRL", "USD", "EUR"]).default("BRL"),
});

export interface CashFlowSummary {
  currency: Currency;
  totals: { in: string; out: string; net: string };
  /** One entry per month that has transactions, oldest first. `month` is YYYY-MM. */
  months: { month: string; in: string; out: string; net: string }[];
  /** Totals per category and direction, largest first. */
  categories: { categoryId: number | null; name: string; direction: "in" | "out"; total: string; count: number }[];
}

export interface B3ImportResult extends ImportResult {
  /** Buys and sales skipped because the same operation already exists from another source (e.g. myProfit). */
  matchedOtherSource: number;
  /** Movements that do not change positions (proventos, custody transfers...), grouped by reason. */
  ignored: { reason: string; movementType: string; count: number }[];
}

export const b3SyncInput = z
  .object({
    from: isoDate.refine((v) => v >= "2018-01-01", "B3 only has data from 2018 on"),
    to: isoDate,
    dryRun: z.boolean().default(false),
  })
  .refine((v) => v.from <= v.to, { message: "from must be before to", path: ["to"] });
