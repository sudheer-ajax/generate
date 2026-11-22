import { readFileSync } from 'fs';
import { resolve } from 'path';

export const MAMBU_TX_STREAM = 'loan_transactions';
export const MAMBU_TX_FEE_APPLIED = 'FEE_APPLIED';
export const MAMBU_TX_FEE_ADJUSTMENT = 'FEE_ADJUSTMENT';
export const MAMBU_TX_WRITE_OFF = 'WRITE_OFF';
export const MAMBU_FEE_MISC_NAME = 'Miscellaneous Lending Fee';
export const MAMBU_FEE_PENALTY_NAME = 'Penalty Interest Fee';

interface FeeLineItem {
  name?: string;
  amount?: string | number;
}

interface TxRecord {
  parent_account_key?: string;
  type?: string;
  amount?: string | number;
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

function feeLinesForName(fees: unknown, feeName: string): FeeLineItem[] {
  if (!Array.isArray(fees)) return [];
  return fees.filter((f) => (f as FeeLineItem).name?.trim() === feeName) as FeeLineItem[];
}

/**
 * FEE_APPLIED fee lines for `feeName`, minus matching fee lines on FEE_ADJUSTMENT
 * when the transaction amount is negative.
 */
function netFeeTotalForName(transactions: TxRecord[], feeName: string): { total: number; found: boolean } {
  let total = 0;
  let found = false;

  for (const tx of transactions) {
    if (tx.type !== MAMBU_TX_FEE_APPLIED) continue;
    for (const fee of feeLinesForName(tx.fees, feeName)) {
      total += parseNumber(fee.amount);
      found = true;
    }
  }

  for (const tx of transactions) {
    if (tx.type !== MAMBU_TX_FEE_ADJUSTMENT) continue;
    if (parseNumber(tx.amount) >= 0) continue;
    for (const fee of feeLinesForName(tx.fees, feeName)) {
      total -= parseNumber(fee.amount);
      found = true;
    }
  }

  return { total, found };
}

function sumWriteOffAmounts(transactions: TxRecord[]): { total: number; found: boolean } {
  let total = 0;
  let found = false;
  for (const tx of transactions) {
    if (tx.type !== MAMBU_TX_WRITE_OFF) continue;
    total += parseNumber(tx.amount);
    found = true;
  }
  return { total, found };
}

function formatAmountResult(result: { total: number; found: boolean }): string | null {
  if (!result.found) return null;
  return String(result.total);
}

export interface ClosedLoanMambuFeeTotals {
  penaltyInterestFee: string | null;
  miscellaneousFees: string | null;
  writeOff: string | null;
}

/**
 * Mambu loan_transactions for CLOSED loans only (by parent_account_key = loan encoded_key).
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
    writeOff: null,
  };

  const state = (accountState ?? '').trim().toUpperCase();
  if (onlyWhenClosed && state !== 'CLOSED') return empty;
  if (!parentAccountEncodedKey) return empty;

  const txs = txIndex.get(parentAccountEncodedKey) ?? [];
  if (!txs.length) return empty;

  const penalty = netFeeTotalForName(txs, MAMBU_FEE_PENALTY_NAME);
  const misc = netFeeTotalForName(txs, MAMBU_FEE_MISC_NAME);
  const writeOff = sumWriteOffAmounts(txs);

  return {
    penaltyInterestFee: formatAmountResult(penalty),
    miscellaneousFees: formatAmountResult(misc),
    writeOff: formatAmountResult(writeOff),
  };
}