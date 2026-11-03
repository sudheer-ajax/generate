export interface EnquiryExportRow {
  /** 1-based row number in the CSV batch. */
  id: number;
  /** Salesforce Id (nRE__Referral__c). */
  enquiryId: string;
  /** Enquiry Number (Name). */
  enquiryNumber: string | null;
  /** UI: Enquiry Source Channel. */
  enquirySourceChannel: string | null;
  /** LLC_BI__Loan__c Id from Loan__c lookup. */
  loanId: string | null;
  loanName: string | null;
}
