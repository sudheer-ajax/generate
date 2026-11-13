export interface TruNarrativeRelationshipRow {
  /** Incremental row id in the CSV (1-based). */
  id: number;
  loanId: string;
  loanName: string | null;
  legalEntityId: string;
  accountId: string;
  accountName: string | null;
  borrowerType: string | null;
  /** Account.Type — UI label Relationship Type (e.g. Individual, Limited Liability Company). */
  relationshipType: string | null;
  /** Account.Relationship_ID__c */
  relationshipId: string | null;
  truNarrativeAccountReference: string | null;
  /** LLC_BI__Loan__c.LLC_BI__Index__c */
  loanIndex: string | null;
  currentLtvBasis: string | null;
  currentLtvBasis2: string | null;
  ltvBasis1: string | null;
  ltvBasis2: string | null;
  /** LLC_BI__Loan__c.LLC_BI__LeadSource__c */
  leadSource: string | null;
}
