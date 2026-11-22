import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { connectNcino, query } from '../clients/ncino.js';
import { config } from '../config/env.js';
import type { LoanBatchInfo } from '../types/export.js';
import type { PortfolioLoanBatchResult, PortfolioLoanRow } from '../types/portfolio-loan-export.js';
import {
  findMambuRecord,
  loadMambuLoanAccountsFile,
  type MambuLoanAccountRecord,
} from './mambu-loan-accounts-file.js';
import {
  closedLoanMambuFees,
  loadMambuLoanTransactionsFile,
  type MambuLoanTransactionsIndex,
} from './mambu-loan-transactions.js';
import {
  borrowerRelationshipIdForLoan,
  fetchBorrowerRelationshipIdByLoanId,
} from './borrower-counterparty.js';
import {
  fetchLoanFeesByType,
  PORTFOLIO_FEE_TYPE_COLUMNS,
  portfolioFeeFieldsForLoan,
} from './loan-fees-by-type.js';
import { resolveLoanRef } from './loan-documents.js';

const LOAN_OBJECT = 'LLC_BI__Loan__c';
const SOQL_IN_CHUNK = 100;

const NCINO_FIELDS = [
  'Id',
  'Name',
  'LLC_BI__lookupKey__c',
  'LLC_BI__Product_Type__c',
  'LLC_BI__Amount__c',
  'Application_Date__c',
  'LLC_BI__Booked_Date__c',
  'LLC_BI__Term_Months__c',
  'Loan_Revert_Month_Months__c',
  'Loan_Maturity_Date__c',
  'LLC_BI__Payment_Schedule__c',
  'LLC_BI__Payment_Type__c',
  'LLC_BI__Pricing_Basis__c',
  'LLC_BI__Current_Interest_Rate__c',
  'LLC_BI__Spread__c',
  'Value_Basis_1__c',
  'Current_LTV_Basis__c',
  'LLC_BI__Product__c',
] as const;

interface NcinoLoanRow {
  Id: string;
  Name?: string;
  LLC_BI__lookupKey__c?: string | number;
  LLC_BI__Product_Type__c?: string;
  LLC_BI__Amount__c?: number;
  Application_Date__c?: string;
  LLC_BI__Booked_Date__c?: string;
  LLC_BI__Term_Months__c?: number;
  Loan_Revert_Month_Months__c?: number;
  Loan_Maturity_Date__c?: string;
  LLC_BI__Payment_Schedule__c?: string;
  LLC_BI__Payment_Type__c?: string;
  LLC_BI__Pricing_Basis__c?: string;
  LLC_BI__Current_Interest_Rate__c?: number;
  LLC_BI__Spread__c?: number;
  Value_Basis_1__c?: number;
  Current_LTV_Basis__c?: number;
  LLC_BI__Product__c?: string;
  [key: string]: unknown;
}

const CSV_HEADERS: (keyof PortfolioLoanRow)[] = [
  'rowNumber',
  'loanReference',
  'accountId',
  'loanBorrowerName',
  'counterpartyId',
  'loanCategory',
  'currency',
  'accountingBalance',
  'grossLoanAmount',
  'undrawnBalance',
  'applicationDate',
  'startDate',
  'loanTermMonths',
  'fixedRateTermMonths',
  'subsequentVariableRateTermMonths',
  'maturityDate',
  'timeToMaturityMonths',
  'paymentFrequencyCode',
  'repaymentTypeCode',
  'interestRateType',
  'interestRate',
  'baseRateSwaps',
  'securityValue',
  'loanToValueRatio',
  'securityChargePriority',
  'regulatoryRealEstateExposureFlag',
  'realEstateCategory',
  'loanStatus',
  'arrearsBalance',
  'provisions',
  ...PORTFOLIO_FEE_TYPE_COLUMNS.map((c) => c.columnKey),
  'arrangementFees',
  'csFees',
  'penaltyInterestFee',
  'miscellaneousFees',
  'inputRef',
  'mambuLoanId',
];

const HEADER_LABELS: Record<keyof PortfolioLoanRow, string> = {
  rowNumber: 'Row Number',
  loanReference: 'Loan Reference (nCino / Mambu)',
  accountId: 'Account ID (Mapping ID)',
  loanBorrowerName: 'Loan / Borrower Name',
  counterpartyId: 'Counterparty ID',
  loanCategory: 'Loan Category',
  currency: 'Currency',
  accountingBalance: 'Accounting Balance',
  grossLoanAmount: 'Gross Loan Amount (nCino)',
  undrawnBalance: 'Undrawn Balance',
  applicationDate: 'Application Date',
  startDate: 'Start Date',
  loanTermMonths: 'Loan Term (Months)',
  fixedRateTermMonths: 'Fixed-Rate Term (Months)',
  subsequentVariableRateTermMonths: 'Subsequent Variable-Rate Term (Months)',
  maturityDate: 'Maturity Date',
  timeToMaturityMonths: 'Time to Maturity (Months)',
  paymentFrequencyCode: 'Payment Frequency Code',
  repaymentTypeCode: 'Repayment Type Code',
  interestRateType: 'Interest Rate Type (Fixed / Variable)',
  interestRate: 'Interest Rate',
  baseRateSwaps: 'Base Rate (Swaps)',
  securityValue: 'Security Value',
  loanToValueRatio: 'Loan-to-Value Ratio (LTV)',
  securityChargePriority: 'Security Charge Priority',
  regulatoryRealEstateExposureFlag: 'Regulatory Real Estate Exposure Flag',
  realEstateCategory: 'Real Estate Category',
  loanStatus: 'Loan Status',
  arrearsBalance: 'Arrears Balance',
  provisions: 'Provisions',
  brokerFee: 'Broker Fee',
  thirdPartyReportFee: 'Third Party Report Fee',
  valuationFee: 'Valuation Fee',
  otherFee: 'Other Fee',
  productFee: 'Product Fee',
  loanExitFee: 'Loan Exit',
  arrangementFee: 'Arrangement',
  fundsTransferFee: 'Funds Transfer',
  quantitySurveyorFee: 'Quantity Surveyor',
  tiiFee: 'TII',
  coordinationAndStructuringFee: 'Coordination and Structuring',
  adminFee: 'Admin',
  earlyRepaymentChargeFee: 'Early Repayment Charge',
  myFee: 'My Fee',
  enhancedDiligenceFee: 'Enhanced Diligence Fee',
  legalFee: 'Legal',
  arrangementFees: 'Arrangement Fees',
  csFees: 'C&S Fees',
  penaltyInterestFee: 'Penalty Interest Fee',
  miscellaneousFees: 'Miscellaneous Fees',
  inputRef: 'inputRef',
  mambuLoanId: 'mambuLoanId',
} satisfies Record<keyof PortfolioLoanRow, string>;

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeCsv(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatAmount(value: unknown): string | null {
  const n = parseNumber(value);
  if (n === null) return scalar(value);
  return String(n);
}

function parseDateOnly(value: unknown): Date | null {
  const s = scalar(value);
  if (!s) return null;
  const d = new Date(s.length <= 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value: unknown): string | null {
  const d = parseDateOnly(value);
  if (!d) return scalar(value);
  return d.toISOString().slice(0, 10);
}

function monthsBetween(from: Date, to: Date): number | null {
  if (to < from) return 0;
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12;
  months += to.getUTCMonth() - from.getUTCMonth();
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function asOfDate(): Date {
  const cutoff = config.boe.cutoffDate?.trim();
  if (cutoff) {
    const d = parseDateOnly(cutoff);
    if (d) return d;
  }
  return new Date();
}

async function fetchLoansByIds(ids: string[]): Promise<Map<string, NcinoLoanRow>> {
  const map = new Map<string, NcinoLoanRow>();
  const fieldList = NCINO_FIELDS.join(', ');
  for (let i = 0; i < ids.length; i += SOQL_IN_CHUNK) {
    const chunk = ids.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((id) => `'${escapeSoqlLiteral(id)}'`).join(',');
    const rows = await query<NcinoLoanRow>(
      `SELECT ${fieldList} FROM ${LOAN_OBJECT} WHERE Id IN (${inList})`.replace(/\s+/g, ' '),
    );
    for (const row of rows) {
      map.set(row.Id, row);
      if (row.Id.length === 18) map.set(row.Id.slice(0, 15), row);
    }
  }
  return map;
}

function mapLoanStatus(mambu: MambuLoanAccountRecord | undefined, maturityDate: Date | null): string | null {
  if (!mambu) return null;
  const state = scalar(mambu.record.account_state);
  if (!state) return null;
  const today = asOfDate();
  if (state === 'ACTIVE' && maturityDate && maturityDate < today) {
    return 'ACTIVE_PAST_MATURITY';
  }
  return state;
}

function arrearsBalance(mambu: MambuLoanAccountRecord | undefined): string | null {
  if (!mambu) return null;
  const state = scalar(mambu.record.account_state);
  if (state !== 'ACTIVE_IN_ARREARS') return null;

  const balances = mambu.record.balances as Record<string, unknown> | undefined;
  const interestDue = parseNumber(balances?.interest_due) ?? 0;
  const principalDue = parseNumber(balances?.principal_due) ?? 0;

  const interestSettings = mambu.record.interest_settings as Record<string, unknown> | undefined;
  const source = scalar(interestSettings?.interest_rate_source);
  if (source === 'FIXED_INTEREST_RATE') return String(interestDue);
  return String(interestDue + principalDue);
}

function disbursementDate(mambu: MambuLoanAccountRecord | undefined): string | null {
  if (!mambu) return null;
  const details = mambu.record.disbursement_details as Record<string, unknown> | undefined;
  return formatDate(details?.disbursement_date);
}

function buildRow(
  rowNumber: number,
  inputRef: string,
  loan: NcinoLoanRow | null,
  mambu: MambuLoanAccountRecord | undefined,
  counterpartyId: string | null,
  feeFields: ReturnType<typeof portfolioFeeFieldsForLoan>,
  mambuTxFees: ReturnType<typeof closedLoanMambuFees>,
): PortfolioLoanRow {
  const termNcino = parseNumber(loan?.LLC_BI__Term_Months__c);
  const termMambu = parseNumber(mambu?.loanMaturity.loan_term_months);
  const loanTerm = termMambu ?? termNcino;

  const revertMonths = parseNumber(loan?.Loan_Revert_Month_Months__c);
  const fixedTerm = revertMonths ?? termNcino;
  let subsequentTerm: number | null = null;
  if (termNcino != null && revertMonths != null) {
    subsequentTerm = termNcino - revertMonths;
    if (subsequentTerm < 0) subsequentTerm = null;
  }

  const maturityNcino = loan?.Loan_Maturity_Date__c;
  const maturityMambu = mambu?.loanMaturity.loan_maturity_dt;
  const maturityDate = formatDate(maturityNcino ?? maturityMambu);

  const startDate = formatDate(loan?.LLC_BI__Booked_Date__c ?? disbursementDate(mambu));
  const maturityParsed = parseDateOnly(maturityNcino ?? maturityMambu);

  const remaining =
    maturityParsed != null ? monthsBetween(asOfDate(), maturityParsed) : null;

  const grossMambu = mambu?.loancreation.original__loan__amount;
  const grossLoanAmount = formatAmount(grossMambu ?? loan?.LLC_BI__Amount__c);

  const interestRate = parseNumber(loan?.LLC_BI__Current_Interest_Rate__c);
  const spread = parseNumber(loan?.LLC_BI__Spread__c);
  let baseRate: string | null = null;
  if (interestRate != null && spread != null) {
    baseRate = String(Number((interestRate - spread).toFixed(8)));
  }

  return {
    rowNumber,
    loanReference: loan?.Id ?? null,
    accountId: scalar(loan?.LLC_BI__lookupKey__c),
    loanBorrowerName: loan?.Name ?? scalar(mambu?.loancreation.loan_name),
    counterpartyId,
    loanCategory: loan?.LLC_BI__Product_Type__c ?? null,
    currency: 'GBP',
    accountingBalance: null,
    grossLoanAmount,
    undrawnBalance: '0',
    applicationDate: formatDate(loan?.Application_Date__c ?? mambu?.record.creation_date),
    startDate,
    loanTermMonths: loanTerm != null ? String(loanTerm) : null,
    fixedRateTermMonths: fixedTerm != null ? String(fixedTerm) : null,
    subsequentVariableRateTermMonths:
      subsequentTerm != null ? String(subsequentTerm) : null,
    maturityDate,
    timeToMaturityMonths: remaining != null ? String(remaining) : null,
    paymentFrequencyCode: loan?.LLC_BI__Payment_Schedule__c ?? null,
    repaymentTypeCode: loan?.LLC_BI__Payment_Type__c ?? null,
    interestRateType: loan?.LLC_BI__Pricing_Basis__c ?? null,
    interestRate: interestRate != null ? String(interestRate) : null,
    baseRateSwaps: baseRate,
    securityValue:
      loan?.Value_Basis_1__c != null ? String(loan.Value_Basis_1__c) : null,
    loanToValueRatio:
      loan?.Current_LTV_Basis__c != null ? String(loan.Current_LTV_Basis__c) : null,
    securityChargePriority: 'First',
    regulatoryRealEstateExposureFlag: 'YES',
    realEstateCategory: loan?.LLC_BI__Product__c ?? null,
    loanStatus: mapLoanStatus(mambu, maturityParsed),
    arrearsBalance: arrearsBalance(mambu),
    provisions: null,
    ...feeFields,
    arrangementFees: feeFields.arrangementFee,
    csFees: feeFields.coordinationAndStructuringFee,
    penaltyInterestFee: mambuTxFees.penaltyInterestFee,
    miscellaneousFees: mambuTxFees.miscellaneousFees,
    inputRef,
    mambuLoanId: mambu?.mambuAccountId ?? null,
  };
}

export function portfolioRowsToCsv(rows: PortfolioLoanRow[]): string {
  const header = CSV_HEADERS.map((k) => HEADER_LABELS[k]);
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(CSV_HEADERS.map((k) => escapeCsv(r[k])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function portfolioMissingMambuRowsToCsv(
  rows: PortfolioLoanRow[],
): string {
  const header = ['Row Number', 'inputRef', 'loanReference', 'loanBorrowerName'];
  const lines = [header.join(',')];
  let n = 1;
  for (const r of rows) {
    if (r.mambuLoanId) continue;
    lines.push(
      [
        String(n++),
        escapeCsv(r.inputRef),
        escapeCsv(r.loanReference),
        escapeCsv(r.loanBorrowerName),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function resolveLoanRefs(
  loanRefs: string[],
): Promise<{ inputRef: string; id: string | null }[]> {
  const resolved: { inputRef: string; id: string | null }[] = [];
  for (const ref of loanRefs) {
    try {
      const { id } = await resolveLoanRef(ref);
      resolved.push({ inputRef: ref, id });
    } catch {
      if (/^[a-zA-Z0-9]{15,18}$/.test(ref)) {
        resolved.push({ inputRef: ref, id: ref });
      } else {
        resolved.push({ inputRef: ref, id: null });
      }
    }
  }
  return resolved;
}

/** Build portfolio rows for one or many loans (single nCino + Mambu index pass). */
export async function buildPortfolioRows(
  loanRefs: string[],
  mambuFilePath: string,
  mambuTransactionsFilePath?: string,
): Promise<PortfolioLoanRow[]> {
  await connectNcino();
  const mambuIndex = loadMambuLoanAccountsFile(mambuFilePath);
  const txIndex: MambuLoanTransactionsIndex = loadMambuLoanTransactionsFile(
    mambuTransactionsFilePath ?? config.export.mambuLoanTransactionsFile,
  );
  const resolved = await resolveLoanRefs(loanRefs);

  const ids = [...new Set(resolved.map((r) => r.id).filter(Boolean) as string[])];
  const [loansById, counterpartyByLoan, feesByLoan] = await Promise.all([
    ids.length ? fetchLoansByIds(ids) : Promise.resolve(new Map<string, NcinoLoanRow>()),
    ids.length ? fetchBorrowerRelationshipIdByLoanId(ids) : Promise.resolve(new Map<string, string>()),
    ids.length ? fetchLoanFeesByType(ids) : Promise.resolve(new Map()),
  ]);

  const rows: PortfolioLoanRow[] = [];
  let rowNumber = 1;
  for (const { inputRef, id } of resolved) {
    const loan = id ? (loansById.get(id) ?? loansById.get(id.slice(0, 15))) : null;
    const mambu = id ? findMambuRecord(mambuIndex, id) : undefined;
    const counterpartyId = borrowerRelationshipIdForLoan(counterpartyByLoan, id);
    const feeFields = portfolioFeeFieldsForLoan(feesByLoan, id);
    const encodedKey = mambu?.record.encoded_key != null ? String(mambu.record.encoded_key) : undefined;
    const accountState = mambu?.record.account_state != null ? String(mambu.record.account_state) : null;
    const mambuTxFees = closedLoanMambuFees(txIndex, encodedKey, accountState);
    rows.push(
      buildRow(rowNumber++, inputRef, loan ?? null, mambu, counterpartyId, feeFields, mambuTxFees),
    );
  }
  return rows;
}

function writePortfolioResultFiles(
  rows: PortfolioLoanRow[],
  csvPath: string,
  missingMambuCsvPath: string,
): PortfolioLoanBatchResult {
  mkdirSync(dirname(csvPath), { recursive: true });
  writeFileSync(csvPath, portfolioRowsToCsv(rows), 'utf8');
  writeFileSync(missingMambuCsvPath, portfolioMissingMambuRowsToCsv(rows), 'utf8');
  const missingMambuCount = rows.filter((r) => !r.mambuLoanId).length;
  return {
    csvPath,
    missingMambuCsvPath,
    rowCount: rows.length,
    missingMambuCount,
    rows,
  };
}

export function defaultPortfolioCombinedCsvPath(outputRoot?: string): string {
  const root = outputRoot ?? join(config.export.localDir, '..', 'portfolio');
  return join(root, 'portfolio-all.csv');
}

export function defaultPortfolioCombinedMissingPath(outputRoot?: string): string {
  const root = outputRoot ?? join(config.export.localDir, '..', 'portfolio');
  return join(root, 'portfolio-all-missing-mambu.csv');
}

/** All loans in loan-ids.txt → one CSV (and one missing-mambu CSV). */
export async function exportPortfolioLoanCombined(
  loanRefs: string[],
  mambuFilePath: string,
  options?: { csvPath?: string; missingMambuCsvPath?: string },
): Promise<PortfolioLoanBatchResult> {
  const rows = await buildPortfolioRows(loanRefs, mambuFilePath);
  const csvPath = options?.csvPath ?? defaultPortfolioCombinedCsvPath();
  const missingMambuCsvPath =
    options?.missingMambuCsvPath ?? defaultPortfolioCombinedMissingPath();
  return writePortfolioResultFiles(rows, csvPath, missingMambuCsvPath);
}

export async function exportPortfolioLoanBatch(
  batch: LoanBatchInfo,
  mambuFilePath: string,
  outputRoot?: string,
): Promise<PortfolioLoanBatchResult> {
  const rows = await buildPortfolioRows(batch.loanRefs, mambuFilePath);
  const root = outputRoot ?? join(config.export.localDir, '..', 'portfolio');
  const outDir = join(root, batch.batchLabel);
  const csvPath = join(outDir, `portfolio-${batch.batchLabel}.csv`);
  const missingMambuCsvPath = join(outDir, `portfolio-${batch.batchLabel}-missing-mambu.csv`);
  return writePortfolioResultFiles(rows, csvPath, missingMambuCsvPath);
}