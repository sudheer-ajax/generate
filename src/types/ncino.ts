/** Salesforce / nCino records (partial shapes for SOQL results). */

export interface NcinoLoanRecord {
  Id: string;
  Name: string;
  LLC_BI__Account__c?: string;
  LLC_BI__Close_Date__c?: string;
  LLC_BI__Amount__c?: number;
  LLC_BI__Purpose__c?: string;
  LLC_BI__Origination_Channel__c?: string;
  [key: string]: unknown;
}

export interface NcinoCollateralRef {
  Id?: string;
  Name?: string;
  LLC_BI__Postal_Code__c?: string;
  LLC_BI__Value__c?: number;
}

export interface NcinoLoanCollateralRecord {
  Id?: string;
  LLC_BI__Loan__c: string;
  LLC_BI__Collateral__c?: string;
  LLC_BI__Collateral__r?: NcinoCollateralRef;
  LLC_BI__Lien_Position__c?: string;
  [key: string]: unknown;
}

export interface NcinoAccountRef {
  PersonBirthdate?: string;
}

export interface NcinoLegalEntityRecord {
  Id?: string;
  LLC_BI__Loan__c: string;
  LLC_BI__Account__c?: string;
  LLC_BI__Account__r?: NcinoAccountRef;
  LLC_BI__Borrower_Type__c?: string;
  [key: string]: unknown;
}

export interface NcinoAccountRecord {
  Id: string;
  Name?: string;
  PersonBirthdate?: string;
  [key: string]: unknown;
}

export interface FetchLoansOptions {
  limit?: number;
  whereExtra?: string;
}

export interface CalculateBoeContext {
  loan?: NcinoLoanRecord;
  collateralValue?: number | null;
  principalBalance?: number | null;
}
