import type { BoeFieldRow } from './boe.js';

export interface MambuFilterCriterion {
  field: string;
  operator: string;
  value: string | number | boolean;
}

export interface MambuSearchCriteria {
  filterCriteria?: MambuFilterCriterion[];
  sortingCriteria?: unknown;
}

export interface MambuPagination {
  offset?: number;
  limit?: number;
  detailsLevel?: 'BASIC' | 'FULL';
}

export interface MambuScheduleSettings {
  gracePeriod?: number;
  repaymentInstallments?: number;
  repaymentPeriodCount?: number;
  repaymentPeriodUnit?: string;
  repaymentScheduleMethod?: string;
  interestOnlyPeriod?: number;
}

export interface MambuInterestSettings {
  interestRate?: number;
  interestSpread?: number;
  interestRateSource?: string;
  indexRateSource?: string;
  interestRateCeilingValue?: number;
  interestRateReviewCount?: number;
  interestRateReviewPeriodCount?: number;
  interestRateReviewUnit?: string;
}

export interface MambuInstallmentAmount {
  expected?: number;
}

export interface MambuInstallmentPart {
  amount?: MambuInstallmentAmount;
}

export interface MambuInstallment {
  dueDate?: string;
  state?: string;
  repaidDate?: string;
  principal?: MambuInstallmentPart;
  interest?: MambuInstallmentPart;
}

export interface MambuLoanSchedule {
  installments?: MambuInstallment[];
}

export interface MambuLoanBalances {
  principalBalance?: number;
  drawnBalance?: number;
}

export interface MambuLoan {
  id?: string;
  encodedKey?: string;
  maturityDate?: string;
  lastModifiedDate?: string;
  loanAmount?: number;
  closedDate?: string;
  accountState?: string;
  accountSubState?: string;
  lastSetToArrearsDate?: string;
  scheduleSettings?: MambuScheduleSettings;
  interestSettings?: MambuInterestSettings;
  balances?: MambuLoanBalances;
  currency?: { currencyCode?: string };
  product?: { currency?: { code?: string } };
  _customFields?: MambuCustomFieldEntry[];
  customFieldSets?: MambuCustomFieldEntry[];
  customFields?: Record<string, unknown> | MambuCustomFieldEntry[];
  [key: string]: unknown;
}

export interface MambuCustomFieldEntry {
  id?: string;
  customFieldID?: string;
  fieldSetId?: string;
  value?: string;
  customFieldValue?: string;
}

export interface MambuSearchResponse {
  data?: MambuLoan[];
}

export class MambuApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'MambuApiError';
    this.status = status;
    this.body = body;
  }
}

export type MambuBoeFields = BoeFieldRow;
