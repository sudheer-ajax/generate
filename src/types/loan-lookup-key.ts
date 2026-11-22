export interface LoanLookupKeyRow {
  /** 1-based row number in the CSV. */
  id: number;
  /** Input from list file (Account_ID__c). */
  accountIdInput: string;
  /** Account_ID__c on the matched loan (if found). */
  accountId: string | null;
  loanId: string | null;
  loanName: string | null;
}

export interface LoanLookupKeyExportResult {
  rows: LoanLookupKeyRow[];
  missing: string[];
  csvPath: string;
  rowCount: number;
  missingCount: number;
}