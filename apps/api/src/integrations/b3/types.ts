/**
 * Types for the "B3 Investidor - Movimentação" API v2 (swagger 2.0.2-rc8).
 * Only the endpoints that affect positions are modeled: equities, fixed income
 * and treasury bonds. Securities lending and derivatives are not imported.
 */

export interface B3Links {
  self: string;
  first?: string;
  prev?: string;
  next?: string;
  last?: string;
}

interface Period<T> {
  documentNumber: string;
  referenceStartDate: string;
  referenceEndDate: string;
  movements: T[];
}

interface BaseMovement {
  referenceDate: string;
  productCategoryName: string;
  productTypeName: string;
  /** e.g. "Compra", "Venda", "Transferência - Liquidação", "Desdobro", "Bonificação em Ativos", "Rendimento". */
  movementType: string;
  /** "Crédito" or "Débito". */
  operationType: string;
  tickerSymbol: string;
  participantName: string;
  participantDocumentNumber: string;
  unitPrice?: number | null;
  operationValue?: number | null;
}

export interface EquitiesMovement extends BaseMovement {
  corporationName?: string | null;
  equitiesQuantity: number;
  transferOwnershipDescription?: string | null;
  isinCode?: string | null;
  baseIsinCode?: string | null;
  movementTypeDetailCode?: number | null;
  processNumber?: number | null;
}

export interface FixedIncomeMovement extends BaseMovement {
  corporationName: string;
  expirationDate?: string | null;
  fixedIncomeQuantity?: number | null;
  assetDescription?: string | null;
  updatedUnitPriceMTM?: number | null;
  updateValueMTM?: number | null;
}

export interface TreasuryBondsMovement extends BaseMovement {
  assetDescription: string;
  treasuryBondsQuantity: number;
  isinCode?: string | null;
}

export interface EquitiesMovementRsp {
  data?: { equitiesPeriods?: Omit<Period<never>, "movements"> & { equitiesMovements?: EquitiesMovement[] } };
  Links: B3Links;
}

export interface FixedIncomeMovementRsp {
  data?: { fixedIncomes?: Omit<Period<never>, "movements"> & { fixedIncomeMovements?: FixedIncomeMovement[] } };
  Links: B3Links;
}

export interface TreasuryBondsMovementRsp {
  data?: { treasuryBondsPeriods?: Omit<Period<never>, "movements"> & { treasuryBondsMovements?: TreasuryBondsMovement[] } };
  Links: B3Links;
}

/** Everything fetched for one period, already flattened across pages. */
export interface B3Movements {
  equities: EquitiesMovement[];
  fixedIncome: FixedIncomeMovement[];
  treasuryBonds: TreasuryBondsMovement[];
}

export const emptyMovements = (): B3Movements => ({ equities: [], fixedIncome: [], treasuryBonds: [] });

export function movementsFromResponses(pages: {
  equities?: EquitiesMovementRsp[];
  fixedIncome?: FixedIncomeMovementRsp[];
  treasuryBonds?: TreasuryBondsMovementRsp[];
}): B3Movements {
  return {
    equities: (pages.equities ?? []).flatMap((p) => p.data?.equitiesPeriods?.equitiesMovements ?? []),
    fixedIncome: (pages.fixedIncome ?? []).flatMap((p) => p.data?.fixedIncomes?.fixedIncomeMovements ?? []),
    treasuryBonds: (pages.treasuryBonds ?? []).flatMap((p) => p.data?.treasuryBondsPeriods?.treasuryBondsMovements ?? []),
  };
}
