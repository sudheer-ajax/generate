import { readFileSync } from 'fs';
import { resolve } from 'path';

export const MAMBU_TX_STREAM = 'loan_transactions';
export const MAMBU_TX_FEE_APPLIED = 'FEE_APPLIED';
export const MAMBU_FEE_MISC_NAME = 'Miscellaneous Lending Fee';
export const MAMBU_FEE_PENALTY_NAME = 'Penalty Interest Fee';

interface FeeLineItem {
  name?: string;
  amount?: string | number;
}

interface TxRecord {
  parent_account_key?: string;
  type?: string;
  fees?: FeeLineItem[];
}

/** parent_account_key (loan encoded_key) → list of transaction records */
export type MambuLoanTransactionsIndex = Map<string, TxRecord[]>;

function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function loadMambuLoanTransactionsFile(filePath: string): MambuLoanTransactionsIndex {
  const abs = resolve(filePath);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return new Map();
  }

  const index: MambuLoanTransactionsIndex = new Map();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: { type?: string; stream?: string; record?: TxRecord };
    try {
      parsed = JSON.parse(trimmed) as typeof parsed;
    } catch {
      continue;
    }
    if (parsed.type !== 'RECORD' || parsed.stream !== MAMBU_TX_STREAM || !parsed.record) continue;

    const parentKey = parsed.record.parent_account_key?.trim();
    if (!parentKey) continue;

    const list = index.get(parentKey) ?? [];
    list.push(parsed.record);
    index.set(parentKey, list);
  }

  return index;
}

function sumFeeAmounts(
  transactions: TxRecord[],
  transactionType: string,
  feeName: string,
): { total: number; found: boolean } {
  let total = 0;
  let found = false;
  for (const tx of transactions) {
    if (tx.type !== transactionType) continue;
    const fees = tx.fees;
    if (!Array.isArray(fees)) continue;
    for (const fee of fees) {
      if ((fee.name ?? '').trim() !== feeName) continue;
      total += parseNumber(fee.amount);
      found = true;
    }
  }
  return { total, found };
}

export interface ClosedLoanMambuFeeTotals {
  penaltyInterestFee: string | null;
  miscellaneousFees: string | null;
}

/**
 * Sum fee line items on FEE_APPLIED transactions for a loan account (encoded_key).
 * Returns null columns when loan is not CLOSED or no parent key / no matching fees.
 */
export function closedLoanMambuFees(
  txIndex: MambuLoanTransactionsIndex,
  parentAccountEncodedKey: string | undefined,
  accountState: string | null | undefined,
  onlyWhenClosed = true,
): ClosedLoanMambuFeeTotals {
  const empty: ClosedLoanMambuFeeTotals = {
    penaltyInterestFee: null,
    miscellaneousFees: null,
  };

  const state = (accountState ?? '').trim().toUpperCase();
  if (onlyWhenClosed && state !== 'CLOSED') return empty;
  if (!parentAccountEncodedKey) return empty;

  const txs = txIndex.get(parentAccountEncodedKey) ?? [];
  if (!txs.length) return empty;

  const penalty = sumFeeAmounts(txs, MAMBU_TX_FEE_APPLIED, MAMBU_FEE_PENALTY_NAME);
  const misc = sumFeeAmounts(txs, MAMBU_TX_FEE_APPLIED, MAMBU_FEE_MISC_NAME);

  return {
    penaltyInterestFee: penalty.found ? String(penalty.total) : null,
    miscellaneousFees: misc.found ? String(misc.total) : null,
  };
}