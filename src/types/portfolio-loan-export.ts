export interface PortfolioLoanRow {
  rowNumber: number;
  loanReference: string | null;
  accountId: string | null;
  loanBorrowerName: string | null;
  counterpartyId: string | null;
  loanCategory: string | null;
  currency: string;
  accountingBalance: string | null;
  grossLoanAmount: string | null;
  undrawnBalance: string;
  applicationDate: string | null;
  startDate: string | null;
  loanTermMonths: string | null;
  fixedRateTermMonths: string | null;
  subsequentVariableRateTermMonths: string | null;
  maturityDate: string | null;
  timeToMaturityMonths: string | null;
  paymentFrequencyCode: string | null;
  repaymentTypeCode: string | null;
  interestRateType: string | null;
  interestRate: string | null;
  baseRateSwaps: string | null;
  securityValue: string | null;
  loanToValueRatio: string | null;
  securityChargePriority: string;
  regulatoryRealEstateExposureFlag: string;
  realEstateCategory: string | null;
  loanStatus: string | null;
  arrearsBalance: string | null;
  provisions: string | null;
  arrangementFees: string | null;
  csFees: string | null;
  /** Input ref from loan-ids.txt */
  inputRef: string;
  /** Mambu loan account id when JSON matched */
  mambuLoanId: string | null;
}

export interface PortfolioLoanBatchResult {
  csvPath: string;
  missingMambuCsvPath: string;
  rowCount: number;
  missingMambuCount: number;
  rows: PortfolioLoanRow[];
}