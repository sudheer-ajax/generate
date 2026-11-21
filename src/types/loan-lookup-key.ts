export interface LoanLookupKeyRow {
  /** 1-based row number in the CSV / batch. */
  id: number;
  /** Input value from the list file (LLC_BI__lookupKey__c). */
  lookupKey: string;
  loanId: string | null;
  loanName: string | null;
}

export interface LoanLookupKeyExportResult {
  rows: LoanLookupKeyRow[];
  missing: string[];
  csvPath: string;
  rowCount: number;
}