export const institutionKinds = ["bank", "broker", "exchange", "other"] as const;
export type InstitutionKind = (typeof institutionKinds)[number];

export const categoryKinds = ["income", "expense"] as const;
export type CategoryKind = (typeof categoryKinds)[number];

export const cashDirections = ["in", "out"] as const;
export type CashDirection = (typeof cashDirections)[number];

export const currencies = ["BRL", "USD", "EUR"] as const;
export type Currency = (typeof currencies)[number];

/**
 * Asset classes. The comments show the matching "Grupo" in the myProfit export,
 * which the importer (step 2) will map from.
 */
export const assetClasses = [
  "stock_br", // Ações
  "fii", // Fundo Imobiliário
  "fiagro", // FI Agro
  "bdr", // BDR
  "etf_br",
  "stock_us", // Ações EUA
  "etf_us", // ETF USA
  "reit", // REIT
  "fixed_income", // CDB, LCI, LCA, debêntures...
  "treasury", // Tesouro Direto
  "crypto",
  "fund",
  "subscription_right", // Direito de subscrição
  "other",
] as const;
export type AssetClass = (typeof assetClasses)[number];

/**
 * Investment operation types.
 * - buy / sell: quantity and unitPrice are required.
 * - split / reverse_split: `factor` is required (e.g. 2 means 1 share became 2;
 *   for a reverse split, 10 means 10 shares became 1). Quantity and price are ignored.
 * - bonus: shares received for free or with an assigned cost (bonificação);
 *   quantity required, unitPrice is the cost per share assigned by the company (may be 0).
 * - transfer_in / transfer_out: custody transfers between institutions; quantity required,
 *   unitPrice carries the average cost being moved.
 * - subscription: exercise of a subscription right; behaves like a buy.
 */
export const tradeTypes = [
  "buy",
  "sell",
  "split",
  "reverse_split",
  "bonus",
  "subscription",
  "transfer_in",
  "transfer_out",
] as const;
export type TradeType = (typeof tradeTypes)[number];

/** Where a record came from. `externalId` is unique per source, which is how imports avoid duplicates. */
export const dataSources = ["manual", "myprofit", "b3"] as const;
export type DataSource = (typeof dataSources)[number];
