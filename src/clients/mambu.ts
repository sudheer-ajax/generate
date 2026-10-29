import { config } from '../config/env.js';
import type { BoeFieldRow } from '../types/boe.js';
import {
  MambuApiError,
  type MambuFilterCriterion,
  type MambuLoan,
  type MambuLoanSchedule,
  type MambuPagination,
  type MambuScheduleSettings,
  type MambuSearchCriteria,
  type MambuInterestSettings,
} from '../types/mambu.js';

const DEFAULT_HEADERS = {
  Accept: 'application/vnd.mambu.v2+json',
  'Content-Type': 'application/json',
} as const;

function apiKeyHeader(): Record<string, string> {
  return { apiKey: config.mambu.apiKey };
}

interface MambuRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

async function mambuRequest<T = unknown>(path: string, options: MambuRequestOptions = {}): Promise<T> {
  const base = config.mambu.baseUrl;
  if (!base) {
    throw new Error('MAMBU_BASE_URL is not set');
  }
  if (!config.mambu.apiKey) {
    throw new Error('MAMBU_API_KEY is not set');
  }

  const url = `${base}/api${path.startsWith('/') ? path : `/${path}`}`;
  const { body, headers: extraHeaders, ...rest } = options;

  const res = await fetch(url, {
    ...rest,
    headers: {
      ...DEFAULT_HEADERS,
      ...apiKeyHeader(),
      ...(extraHeaders as Record<string, string> | undefined),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new MambuApiError(
      `Mambu API ${res.status} ${res.statusText}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
      res.status,
      data,
    );
  }

  return data as T;
}

export async function searchLoans(
  criteria: MambuSearchCriteria = {},
  pagination: MambuPagination = {},
): Promise<MambuLoan[] | { data?: MambuLoan[] }> {
  const body = {
    filterCriteria: criteria.filterCriteria ?? [],
    sortingCriteria: criteria.sortingCriteria,
  };
  const params = new URLSearchParams();
  if (pagination.offset != null) params.set('offset', String(pagination.offset));
  if (pagination.limit != null) params.set('limit', String(pagination.limit));
  if (pagination.detailsLevel) params.set('detailsLevel', pagination.detailsLevel);

  const qs = params.toString();
  return mambuRequest(`/loans:search${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    body,
  });
}

export async function getLoan(loanId: string, detailsLevel: 'BASIC' | 'FULL' = 'FULL'): Promise<MambuLoan> {
  const params = new URLSearchParams({ detailsLevel });
  return mambuRequest(`/loans/${encodeURIComponent(loanId)}?${params}`);
}

export async function getLoanSchedule(loanId: string): Promise<MambuLoanSchedule> {
  return mambuRequest(`/loans/${encodeURIComponent(loanId)}/schedule`);
}

export async function getLoanInstallments(loanId: string): Promise<unknown> {
  return mambuRequest(`/loans/${encodeURIComponent(loanId)}/installments`);
}

export async function searchLoanTransactions(
  loanId: string,
  filterCriteria: MambuFilterCriterion[] = [],
  pagination: MambuPagination = {},
): Promise<unknown> {
  const params = new URLSearchParams();
  if (pagination.offset != null) params.set('offset', String(pagination.offset));
  if (pagination.limit != null) params.set('limit', String(pagination.limit));

  const qs = params.toString();
  return mambuRequest(
    `/loans/${encodeURIComponent(loanId)}/transactions:search${qs ? `?${qs}` : ''}`,
    {
      method: 'POST',
      body: { filterCriteria },
    },
  );
}

export async function getDeposit(depositId: string, detailsLevel: 'BASIC' | 'FULL' = 'FULL'): Promise<unknown> {
  const params = new URLSearchParams({ detailsLevel });
  return mambuRequest(`/deposits/${encodeURIComponent(depositId)}?${params}`);
}

export function getNcinoLoanNameFromMambuLoan(loan: MambuLoan): string | null {
  const fieldId = config.mambu.ncinoLoanNameField;
  const custom = loan._customFields ?? loan.customFieldSets ?? loan.customFields;
  if (!custom) return null;

  if (Array.isArray(custom)) {
    const hit = custom.find(
      (f) => f.id === fieldId || f.customFieldID === fieldId || f.fieldSetId === fieldId,
    );
    return hit?.value ?? hit?.customFieldValue ?? null;
  }

  if (typeof custom === 'object' && fieldId in custom) {
    const val = custom[fieldId];
    return val != null ? String(val) : null;
  }

  const topLevel = loan[fieldId];
  return topLevel != null ? String(topLevel) : null;
}

export function mapMambuLoanToBoeFields(loan: MambuLoan, schedule: MambuLoanSchedule | null): BoeFieldRow {
  const installments = schedule?.installments ?? [];
  const lastInstallment = installments[installments.length - 1];
  const nextDue = installments.find(
    (i) => i.state === 'PENDING' || i.state === 'LATE' || !i.repaidDate,
  );

  const principalExpected = nextDue?.principal?.amount?.expected ?? 0;
  const interestExpected = nextDue?.interest?.amount?.expected ?? 0;
  const paymentDue = principalExpected + interestExpected;

  return {
    AR3: loan.id ?? null,
    AR56: lastInstallment?.dueDate ?? loan.maturityDate ?? null,
    AR57: loan.lastModifiedDate ?? null,
    AR61: termMonthsFromLoan(loan),
    AR62: loan.scheduleSettings?.gracePeriod ?? null,
    AR65: mapCurrencyCode(loan.currency?.currencyCode ?? loan.product?.currency?.code),
    AR67: loan.balances?.principalBalance ?? null,
    AR69: mapRepaymentMethod(loan),
    AR70: mapPaymentFrequency(loan.scheduleSettings),
    AR71: paymentDue || null,
    AR87: loan.loanAmount ?? loan.balances?.drawnBalance ?? null,
    AR107: mapInterestRateType(loan.interestSettings),
    AR108: mapInterestIndex(loan.interestSettings),
    AR109: loan.interestSettings?.interestRate ?? null,
    AR110: loan.interestSettings?.interestSpread ?? loan.interestSettings?.interestRate ?? null,
    AR111: interestResetMonths(loan.interestSettings),
    AR112: loan.interestSettings?.interestRateCeilingValue ?? null,
    AR122:
      loan.accountSubState === 'RESCHEDULED' || loan.accountSubState === 'REFINANCED' ? 'Y' : 'N',
    AR166: mapAccountStatus(loan),
    AR168: loan.lastSetToArrearsDate ?? null,
    AR175: loan.accountState === 'CLOSED' ? (loan.closedDate ?? null) : null,
  };
}

function termMonthsFromLoan(loan: MambuLoan): number | null {
  const s = loan.scheduleSettings;
  if (!s) return null;
  const count = s.repaymentInstallments ?? s.repaymentPeriodCount;
  const unit = (s.repaymentPeriodUnit || 'MONTHS').toUpperCase();
  if (count == null) return null;
  if (unit === 'MONTHS') return count;
  if (unit === 'YEARS') return count * 12;
  if (unit === 'WEEKS') return Math.round((count * 7) / 30.4375);
  return count;
}

function mapCurrencyCode(code: string | undefined): string {
  if (!code) return 'ND';
  const c = code.toUpperCase();
  const map: Record<string, string> = { EUR: '1', GBP: '2', USD: '3' };
  return map[c] ?? c;
}

function mapRepaymentMethod(loan: MambuLoan): string {
  const method = loan.scheduleSettings?.repaymentScheduleMethod;
  const io = loan.scheduleSettings?.interestOnlyPeriod;
  if (io && io > 0) return '1';
  if (method === 'ANNUITY') return '2';
  return 'ND';
}

function mapPaymentFrequency(settings: MambuScheduleSettings | undefined): string {
  if (!settings) return 'ND';
  const count = settings.repaymentPeriodCount ?? 1;
  const unit = (settings.repaymentPeriodUnit || 'MONTHS').toUpperCase();
  if (unit === 'MONTHS' && count === 1) return '1';
  if (unit === 'MONTHS' && count === 3) return '2';
  if (unit === 'MONTHS' && count === 6) return '3';
  if (unit === 'MONTHS' && count === 12) return '4';
  return '6';
}

function mapInterestRateType(settings: MambuInterestSettings | undefined): string {
  if (!settings) return 'ND';
  const source = settings.interestRateSource;
  if (source === 'FIXED_INTEREST_RATE') return '3';
  if (source === 'INDEX_INTEREST_RATE') return '2';
  return 'ND';
}

function mapInterestIndex(settings: MambuInterestSettings | undefined): string {
  const idx = settings?.indexRateSource ?? settings?.interestRateSource;
  if (!idx) return 'ND';
  const u = String(idx).toUpperCase();
  if (u.includes('BOE') || u.includes('BANK') || u.includes('BASE')) return '9';
  return 'ND';
}

function interestResetMonths(settings: MambuInterestSettings | undefined): number | null {
  if (!settings) return null;
  const count = settings.interestRateReviewCount ?? settings.interestRateReviewPeriodCount;
  const unit = (settings.interestRateReviewUnit || 'MONTHS').toUpperCase();
  if (count == null) return null;
  if (unit === 'MONTHS') return count;
  if (unit === 'YEARS') return count * 12;
  return count;
}

function mapAccountStatus(loan: MambuLoan): string {
  const state = loan.accountState;
  const sub = loan.accountSubState;
  if (state === 'ACTIVE' && !sub) return '1';
  if (state === 'ACTIVE_IN_ARREARS' || sub === 'ARREARS') return '2';
  if (state === 'CLOSED' && sub === 'WRITTEN_OFF') return '3';
  if (state === 'CLOSED') return '4';
  return 'ND';
}
