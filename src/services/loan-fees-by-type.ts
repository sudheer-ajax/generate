import { query } from '../clients/ncino.js';
import type { PortfolioFeeFields } from '../types/portfolio-loan-export.js';

export const FEE_OBJECT = 'LLC_BI__Fee__c';
export const FEE_LOAN_FIELD = 'LLC_BI__Loan__c';
export const FEE_TYPE_FIELD = 'LLC_BI__Fee_Type__c';
export const FEE_AMOUNT_FIELD = 'LLC_BI__Amount__c';

const SOQL_IN_CHUNK = 200;

/** Portfolio CSV fee columns ↔ `LLC_BI__Fee_Type__c` picklist (Legal falls back to Attorney in org). */
export const PORTFOLIO_FEE_TYPE_COLUMNS = [
  { columnKey: 'brokerFee', label: 'Broker Fee', feeTypes: ['Broker Fee'] },
  { columnKey: 'thirdPartyReportFee', label: 'Third Party Report Fee', feeTypes: ['Third Party Report Fee'] },
  { columnKey: 'valuationFee', label: 'Valuation Fee', feeTypes: ['Valuation Fee'] },
  { columnKey: 'otherFee', label: 'Other Fee', feeTypes: ['Other Fee'] },
  { columnKey: 'productFee', label: 'Product Fee', feeTypes: ['Product Fee'] },
  { columnKey: 'loanExitFee', label: 'Loan Exit', feeTypes: ['Loan Exit'] },
  { columnKey: 'arrangementFee', label: 'Arrangement', feeTypes: ['Arrangement'] },
  { columnKey: 'fundsTransferFee', label: 'Funds Transfer', feeTypes: ['Funds Transfer'] },
  { columnKey: 'quantitySurveyorFee', label: 'Quantity Surveyor', feeTypes: ['Quantity Surveyor'] },
  { columnKey: 'tiiFee', label: 'TII', feeTypes: ['TII'] },
  {
    columnKey: 'coordinationAndStructuringFee',
    label: 'Coordination and Structuring',
    feeTypes: ['Coordination and Structuring'],
  },
  { columnKey: 'adminFee', label: 'Admin', feeTypes: ['Admin'] },
  { columnKey: 'earlyRepaymentChargeFee', label: 'Early Repayment Charge', feeTypes: ['Early Repayment Charge'] },
  { columnKey: 'myFee', label: 'My Fee', feeTypes: ['My Fee'] },
  { columnKey: 'enhancedDiligenceFee', label: 'Enhanced Diligence Fee', feeTypes: ['Enhanced Diligence Fee'] },
  { columnKey: 'legalFee', label: 'Legal', feeTypes: ['Legal', 'Attorney'] },
] as const;

export type PortfolioFeeColumnKey = keyof PortfolioFeeFields;

export type LoanFeeAmountsByType = Map<string, Map<string, number>>;

interface FeeQueryRow {
  LLC_BI__Loan__c: string;
  LLC_BI__Fee_Type__c?: string;
  LLC_BI__Amount__c?: number | null;
  [key: string]: unknown;
}

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function addAmount(map: Map<string, number>, feeType: string, amount: number): void {
  map.set(feeType, (map.get(feeType) ?? 0) + amount);
}

/**
 * Child fees on `LLC_BI__Fee__c` linked by `LLC_BI__Loan__c` → loan Id.
 * Sums `LLC_BI__Amount__c` per loan per fee type (skips null amounts).
 */
export async function fetchLoanFeesByType(loanIds: string[]): Promise<LoanFeeAmountsByType> {
  const byLoan = new Map<string, Map<string, number>>();
  if (!loanIds.length) return byLoan;

  for (let i = 0; i < loanIds.length; i += SOQL_IN_CHUNK) {
    const chunk = loanIds.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((id) => `'${escapeSoqlLiteral(id)}'`).join(',');
    const rows = await query<FeeQueryRow>(
      `SELECT ${FEE_LOAN_FIELD}, ${FEE_TYPE_FIELD}, ${FEE_AMOUNT_FIELD}
       FROM ${FEE_OBJECT}
       WHERE ${FEE_LOAN_FIELD} IN (${inList})`.replace(/\s+/g, ' '),
    );

    for (const row of rows) {
      const loanId = row.LLC_BI__Loan__c;
      const feeType = row.LLC_BI__Fee_Type__c?.trim();
      const amount = row.LLC_BI__Amount__c;
      if (!loanId || !feeType || amount == null) continue;

      let perType = byLoan.get(loanId);
      if (!perType) {
        perType = new Map();
        byLoan.set(loanId, perType);
        if (loanId.length === 18) byLoan.set(loanId.slice(0, 15), perType);
      }
      addAmount(perType, feeType, Number(amount));
    }
  }

  return byLoan;
}

export function feeAmountForLoan(
  byLoan: LoanFeeAmountsByType,
  loanId: string | null | undefined,
  feeTypes: readonly string[],
): number | null {
  if (!loanId) return null;
  const perType = byLoan.get(loanId) ?? byLoan.get(loanId.slice(0, 15));
  if (!perType) return null;
  let total = 0;
  let found = false;
  for (const ft of feeTypes) {
    const v = perType.get(ft);
    if (v != null) {
      total += v;
      found = true;
    }
  }
  return found ? total : null;
}

export function formatFeeAmount(value: number | null): string | null {
  if (value === null) return null;
  return String(value);
}

export function portfolioFeeFieldsForLoan(
  byLoan: LoanFeeAmountsByType,
  loanId: string | null | undefined,
): Record<PortfolioFeeColumnKey, string | null> {
  const out = {} as Record<PortfolioFeeColumnKey, string | null>;
  for (const col of PORTFOLIO_FEE_TYPE_COLUMNS) {
    out[col.columnKey] = formatFeeAmount(feeAmountForLoan(byLoan, loanId, col.feeTypes));
  }
  return out;
}