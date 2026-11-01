import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { DocumentDownloadRef, DocumentIdBatchInfo } from '../types/document-id-export.js';
import { batchLabel } from './loan-id-batches.js';

const SF_ID = /^[a-zA-Z0-9]{15,18}$/;

function parseLine(line: string, lineIndex: number): DocumentDownloadRef | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const parts = trimmed.split(/[\t,]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  if (parts.length === 1) {
    const documentId = parts[0]!;
    return {
      lineIndex,
      documentId,
      loanIdOrName: null,
      contentVersionId: null,
    };
  }

  if (parts.length === 2) {
    const a = parts[0]!;
    const b = parts[1]!;
    if (a.startsWith('068') && SF_ID.test(b)) {
      return {
        lineIndex,
        documentId: b,
        loanIdOrName: null,
        contentVersionId: a,
      };
    }
    return {
      lineIndex,
      loanIdOrName: a,
      documentId: b,
      contentVersionId: null,
    };
  }

  const loanIdOrName = parts[0]!;
  const documentId = parts[1]!;
  const contentVersionId = parts[2] ?? null;
  return {
    lineIndex,
    loanIdOrName,
    documentId,
    contentVersionId,
  };
}

export function loadDocumentDownloadRefsFromFile(filePath: string): DocumentDownloadRef[] {
  const abs = resolve(filePath);
  const text = readFileSync(abs, 'utf8');
  const refs: DocumentDownloadRef[] = [];
  let lineIndex = 0;
  for (const line of text.split(/\r?\n/)) {
    lineIndex += 1;
    const ref = parseLine(line, lineIndex);
    if (ref) refs.push(ref);
  }
  return refs;
}

function splitItemsIntoBatches<T>(items: T[], batchSize: number): T[][] {
  if (batchSize < 1) throw new Error('batchSize must be at least 1');
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

export function describeDocumentIdBatches(
  items: DocumentDownloadRef[],
  batchSize: number,
): DocumentIdBatchInfo[] {
  const batches = splitItemsIntoBatches(items, batchSize);
  return batches.map((batchItems, index) => {
    const batchNumber = index + 1;
    const startIndex = index * batchSize;
    return {
      batchNumber,
      batchLabel: batchLabel(batchNumber),
      items: batchItems,
      startIndex,
      endIndex: startIndex + batchItems.length - 1,
      totalItems: items.length,
      totalBatches: batches.length,
    };
  });
}

export function getDocumentIdBatch(
  items: DocumentDownloadRef[],
  batchSize: number,
  batchNumber: number,
): DocumentIdBatchInfo {
  const all = describeDocumentIdBatches(items, batchSize);
  const batch = all[batchNumber - 1];
  if (!batch) {
    throw new Error(
      `Batch ${batchNumber} not found (${all.length} batch(es) for ${items.length} document(s), size ${batchSize})`,
    );
  }
  return batch;
}
