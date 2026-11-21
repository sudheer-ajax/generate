import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { connectNcino, query } from '../clients/ncino.js';
import { config } from '../config/env.js';
import type { LoanBatchInfo } from '../types/export.js';
import type { LoanLookupKeyExportResult, LoanLookupKeyRow } from '../types/loan-lookup-key.js';
import { batchLabel } from './loan-id-batches.js';

export const LOAN_LOOKUP_KEY_FIELD = 'LLC_BI__lookupKey__c';
const LOAN_OBJECT = 'LLC_BI__Loan__c';
const SOQL_IN_CHUNK = 200;

interface LoanByLookupKeyRow {
  Id: string;
  Name: string;
  LLC_BI__lookupKey__c?: string | number;
  [key: string]: unknown;
}

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeCsv(value: string | null | undefined): string {
  const s = value ?? '';
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeLookupKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function rowsToCsv(rows: LoanLookupKeyRow[]): string {
  const header = ['Id', 'lookupKey', 'loanId', 'loanName'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [String(r.id), escapeCsv(r.lookupKey), escapeCsv(r.loanId), escapeCsv(r.loanName)].join(
        ',',
      ),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function fetchLoansByLookupKeys(
  lookupKeys: string[],
): Promise<Map<string, LoanByLookupKeyRow>> {
  const map = new Map<string, LoanByLookupKeyRow>();
  for (let i = 0; i < lookupKeys.length; i += SOQL_IN_CHUNK) {
    const chunk = lookupKeys.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((k) => `'${escapeSoqlLiteral(k)}'`).join(',');
    const rows = await query<LoanByLookupKeyRow>(
      `SELECT Id, Name, ${LOAN_LOOKUP_KEY_FIELD}
       FROM ${LOAN_OBJECT}
       WHERE ${LOAN_LOOKUP_KEY_FIELD} IN (${inList})`.replace(/\s+/g, ' '),
    );
    for (const row of rows) {
      const key = normalizeLookupKey(row.LLC_BI__lookupKey__c);
      if (!key) continue;
      if (!map.has(key)) map.set(key, row);
    }
  }
  return map;
}

function resolveFound(
  inputKey: string,
  byKey: Map<string, LoanByLookupKeyRow>,
): LoanByLookupKeyRow | undefined {
  if (byKey.has(inputKey)) return byKey.get(inputKey);
  const numeric = inputKey.replace(/^0+/, '') || inputKey;
  for (const [k, row] of byKey) {
    const kn = k.replace(/^0+/, '') || k;
    if (kn === numeric) return row;
  }
  return undefined;
}

export async function exportLoansByLookupKeys(
  lookupKeys: string[],
): Promise<{ rows: LoanLookupKeyRow[]; missing: string[] }> {
  await connectNcino();
  const unique = [...new Set(lookupKeys.map((k) => k.trim()).filter(Boolean))];
  const byKey = unique.length ? await fetchLoansByLookupKeys(unique) : new Map();

  const rows: LoanLookupKeyRow[] = [];
  const missing: string[] = [];
  let nextId = 1;

  for (const lookupKey of lookupKeys) {
    const trimmed = lookupKey.trim();
    if (!trimmed) continue;
    const found = resolveFound(trimmed, byKey);
    if (!found) {
      missing.push(trimmed);
      rows.push({
        id: nextId++,
        lookupKey: trimmed,
        loanId: null,
        loanName: null,
      });
      continue;
    }
    rows.push({
      id: nextId++,
      lookupKey: trimmed,
      loanId: found.Id,
      loanName: found.Name ?? null,
    });
  }

  return { rows, missing };
}

export async function exportLoanLookupKeyBatch(
  batch: LoanBatchInfo,
  outputRoot?: string,
): Promise<LoanLookupKeyExportResult> {
  const root = outputRoot ?? join(config.export.localDir, '..', 'loan-lookup-key');
  const outDir = join(root, batch.batchLabel);
  mkdirSync(outDir, { recursive: true });

  const { rows, missing } = await exportLoansByLookupKeys(batch.loanRefs);
  const csvPath = join(outDir, `loan-lookup-key-${batch.batchLabel}.csv`);
  writeFileSync(csvPath, rowsToCsv(rows), 'utf8');

  return {
    rows,
    missing,
    csvPath,
    rowCount: rows.length,
  };
}

export { batchLabel };