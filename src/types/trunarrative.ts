export interface TruNarrativeRelationshipRow {
  /** Incremental row id in the CSV (1-based). */
  id: number;
  loanId: string;
  loanName: string | null;
  legalEntityId: string;
  accountId: string;
  accountName: string | null;
  borrowerType: string | null;
  truNarrativeAccountReference: string | null;
}
