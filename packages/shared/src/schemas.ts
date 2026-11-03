import { z } from "zod";
import {
  assetClasses,
  cashDirections,
  categoryKinds,
  currencies,
  dataSources,
  institutionKinds,
  tradeTypes,
} from "./enums";

/**
 * Money and quantities travel as decimal strings ("1044.69") so no precision is
 * lost to floating point. Calculations use decimal.js on the server.
 */
export const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v.trim()))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { message: "Expected a decimal number, e.g. 1044.69" });

export const nonNegativeDecimal = decimalString.refine((v) => !v.startsWith("-"), {
  message: "Must be zero or positive",
});

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD");

export const idParam = z.object({ id: z.coerce.number().int().positive() });

// Institutions ---------------------------------------------------------------
export const institutionInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(institutionKinds).default("broker"),
  documentNumber: z.string().trim().max(14).nullish(),
});
export type InstitutionInput = z.input<typeof institutionInput>;

// Categories -----------------------------------------------------------------
export const categoryInput = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(categoryKinds),
  parentId: z.number().int().positive().nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
});
export type CategoryInput = z.input<typeof categoryInput>;

// Cash transactions (money in / money out) -----------------------------------
export const cashTransactionInput = z.object({
  date: isoDate,
  description: z.string().trim().min(1).max(200),
  amount: nonNegativeDecimal,
  direction: z.enum(cashDirections),
  currency: z.enum(currencies).default("BRL"),
  categoryId: z.number().int().positive().nullish(),
  institutionId: z.number().int().positive().nullish(),
  notes: z.string().max(1000).nullish(),
});
export type CashTransactionInput = z.input<typeof cashTransactionInput>;

export const cashTransactionQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  direction: z.enum(cashDirections).optional(),
});

// Assets ---------------------------------------------------------------------
export const assetInput = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(35)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().max(200).nullish(),
  assetClass: z.enum(assetClasses),
  currency: z.enum(currencies).default("BRL"),
  isin: z.string().trim().max(12).nullish(),
});
export type AssetInput = z.input<typeof assetInput>;

// Trades (investment operations) ---------------------------------------------
export const tradeInput = z
  .object({
    assetId: z.number().int().positive(),
    institutionId: z.number().int().positive().nullish(),
    tradeDate: isoDate,
    type: z.enum(tradeTypes),
    quantity: nonNegativeDecimal.nullish(),
    unitPrice: nonNegativeDecimal.nullish(),
    fees: nonNegativeDecimal.default("0"),
    factor: nonNegativeDecimal.nullish(),
    currency: z.enum(currencies).default("BRL"),
    /** BRL per 1 unit of `currency` on the trade date, for foreign assets. */
    fxRate: nonNegativeDecimal.nullish(),
    isDayTrade: z.boolean().default(false),
    source: z.enum(dataSources).default("manual"),
    externalId: z.string().trim().max(120).nullish(),
    notes: z.string().max(1000).nullish(),
  })
  .superRefine((t, ctx) => {
    const needsQty = ["buy", "sell", "bonus", "subscription", "transfer_in", "transfer_out"];
    if (needsQty.includes(t.type)) {
      if (t.quantity == null || Number(t.quantity) <= 0) {
        ctx.addIssue({ code: "custom", path: ["quantity"], message: `quantity > 0 is required for ${t.type}` });
      }
      if (t.unitPrice == null) {
        ctx.addIssue({ code: "custom", path: ["unitPrice"], message: `unitPrice is required for ${t.type}` });
      }
    }
    if ((t.type === "split" || t.type === "reverse_split") && (t.factor == null || Number(t.factor) <= 0)) {
      ctx.addIssue({ code: "custom", path: ["factor"], message: `factor > 0 is required for ${t.type}` });
    }
  });
export type TradeInput = z.input<typeof tradeInput>;

export const tradeQuery = z.object({
  assetId: z.coerce.number().int().positive().optional(),
  institutionId: z.coerce.number().int().positive().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
