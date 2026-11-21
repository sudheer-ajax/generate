export type LoanLookupKeyResolveMethod =
  | 'lookupKey'
  | 'accountId'
  | 'mambu'
  | 'mambuColonLookup'
  | 'mambuColonAccount'
  | null;

export interface LoanLookupKeyRow {
  /** 1-based row number in the CSV / batch. */
  id: number;
  /** Input value from the list file. */
  inputRef: string;
  /** LLC_BI__lookupKey__c on the loan when found. */
  lookupKey: string | null;
  accountId: string | null;
  mambuLoanForIntegrations: string | null;
  loanId: string | null;
  loanName: string | null;
  resolvedVia: LoanLookupKeyResolveMethod;
}

export interface LoanLookupKeyExportResult {
  rows: LoanLookupKeyRow[];
  missing: string[];
  csvPath: string;
  missingCsvPath: string;
  rowCount: number;
  missingCount: number;
}