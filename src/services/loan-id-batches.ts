import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { LoanBatchInfo } from '../types/export.js';

export function loadLoanIdsFromFile(filePath: string): string[] {
  const abs = resolve(filePath);
  const text = readFileSync(abs, 'utf8');
  const ids: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    ids.push(trimmed);
  }
  return ids;
}

export function splitIntoBatches(loanRefs: string[], batchSize: number): string[][] {
  if (batchSize < 1) throw new Error('batchSize must be at least 1');
  const batches: string[][] = [];
  for (let i = 0; i < loanRefs.length; i += batchSize) {
    batches.push(loanRefs.slice(i, i + batchSize));
  }
  return batches;
}

export function batchLabel(batchNumber: number): string {
  return `batch-${String(batchNumber).padStart(3, '0')}`;
}

export function describeBatches(loanRefs: string[], batchSize: number): LoanBatchInfo[] {
  const batches = splitIntoBatches(loanRefs, batchSize);
  const totalBatches = batches.length;
  return batches.map((loanRefsInBatch, index) => {
    const batchNumber = index + 1;
    const startIndex = index * batchSize;
    return {
      batchNumber,
      batchLabel: batchLabel(batchNumber),
      loanRefs: loanRefsInBatch,
      startIndex,
      endIndex: startIndex + loanRefsInBatch.length - 1,
      totalLoans: loanRefs.length,
      totalBatches,
    };
  });
}

/** 1-based batch number. */
export function getBatch(loanRefs: string[], batchSize: number, batchNumber: number): LoanBatchInfo {
  const all = describeBatches(loanRefs, batchSize);
  const batch = all[batchNumber - 1];
  if (!batch) {
    throw new Error(
      `Batch ${batchNumber} not found (${all.length} batch(es) for ${loanRefs.length} loans, size ${batchSize})`,
    );
  }
  return batch;
}
