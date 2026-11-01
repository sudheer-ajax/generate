export interface LoanCollateralExportRow {
  /** Incremental row id in the CSV (1-based). */
  id: number;
  loanId: string;
  loanName: string | null;
  /** LLC_BI__Loan_Collateral2__c Id (loan–collateral link). */
  loanCollateralId: string;
  collateralId: string;
  collateralName: string | null;
  /** LLC_BI__Collateral_Type__c lookup Id. */
  collateralTypeId: string | null;
  /** LLC_BI__Collateral_Type__r.Name */
  collateralTypeName: string | null;
  /** LLC_BI__Lien_Position__c on LLC_BI__Loan_Collateral2__c */
  lienPosition: string | null;
  /** LLC_BI__Full_Address__c or composed street/city/postcode */
  collateralAddress: string | null;
  /** LLC_BI__Collateral__c.Usage__c */
  usage: string | null;
  /** LLC_BI__Zip_Code__c (UI: Post Code) on collateral */
  postcode: string | null;
}
