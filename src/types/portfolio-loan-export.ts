export interface PortfolioFeeFields {
  brokerFee: string | null;
  thirdPartyReportFee: string | null;
  valuationFee: string | null;
  otherFee: string | null;
  productFee: string | null;
  loanExitFee: string | null;
  arrangementFee: string | null;
  fundsTransferFee: string | null;
  quantitySurveyorFee: string | null;
  tiiFee: string | null;
  coordinationAndStructuringFee: string | null;
  adminFee: string | null;
  earlyRepaymentChargeFee: string | null;
  myFee: string | null;
  enhancedDiligenceFee: string | null;
  legalFee: string | null;
}

export interface PortfolioLoanRow extends PortfolioFeeFields {
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
  /** Mambu loan_transactions (CLOSED loans only): Penalty Interest Fee line items on FEE_APPLIED. */
  penaltyInterestFee: string | null;
  /** Mambu loan_transactions (CLOSED loans only): Miscellaneous Lending Fee on FEE_APPLIED. */
  miscellaneousFees: string | null;
  /** Mambu loan_transactions (CLOSED loans only): sum of WRITE_OFF transaction amounts. */
  writeOff: string | null;
  inputRef: string;
  mambuLoanId: string | null;
}

export interface PortfolioLoanBatchResult {
  csvPath: string;
  missingMambuCsvPath: string;
  rowCount: number;
  missingMambuCount: number;
  rows: PortfolioLoanRow[];
}