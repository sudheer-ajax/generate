export type LoanRefKind = 'salesforce_id' | 'loan_name';

export interface LoanExistenceRow {
  /** 1-based line index in the input list (after comments stripped). */
  index: number;
  inputRef: string;
  inputKind: LoanRefKind;
  existsInOrg: boolean;
  loanId: string | null;
  loanName: string | null;
}

export interface LoanExistenceSummary {
  totalInput: number;
  foundCount: number;
  missingCount: number;
  queriedAt: string;
  loanIdsFile: string;
}

export interface LoanExistenceCheckResult {
  rows: LoanExistenceRow[];
  summary: LoanExistenceSummary;
  csvPath: string;
}
