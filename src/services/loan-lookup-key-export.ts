import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { connectNcino, query } from '../clients/ncino.js';
import { config } from '../config/env.js';
import type { LoanBatchInfo } from '../types/export.js';
import type {
  LoanLookupKeyExportResult,
  LoanLookupKeyResolveMethod,
  LoanLookupKeyRow,
} from '../types/loan-lookup-key.js';
import { batchLabel } from './loan-id-batches.js';

export const LOAN_LOOKUP_KEY_FIELD = 'LLC_BI__lookupKey__c';
export const ACCOUNT_ID_FIELD = 'Account_ID__c';
/** Org API name (capital I in Integrations). */
export const MAMBU_LOAN_FIELD = 'Mambu_Loan_for_Integrations__c';

const LOAN_OBJECT = 'LLC_BI__Loan__c';
const SOQL_IN_CHUNK = 200;
const MAMBU_LIKE_CHUNK = 25;

const LOAN_SELECT = `Id, Name, ${LOAN_LOOKUP_KEY_FIELD}, ${ACCOUNT_ID_FIELD}, ${MAMBU_LOAN_FIELD}`;

interface LoanQueryRow {
  Id: string;
  Name: string;
  LLC_BI__lookupKey__c?: string | number;
  Account_ID__c?: string | number;
  Mambu_Loan_for_Integrations__c?: string;
  [key: string]: unknown;
}

interface LoanIndexes {
  byLookupKey: Map<string, LoanQueryRow>;
  byAccountId: Map<string, LoanQueryRow>;
  byMambuExact: Map<string, LoanQueryRow>;
  /** First segment of `lookupKey:accountId` in Mambu field. */
  byMambuLookupSegment: Map<string, LoanQueryRow>;
  /** Second segment of `lookupKey:accountId` in Mambu field. */
  byMambuAccountSegment: Map<string, LoanQueryRow>;
}

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeCsv(value: string | null | undefined): string {
  const s = value ?? '';
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function normalizeKey(value: string): string {
  return value.trim();
}

function stripLeadingZeros(value: string): string {
  const t = value.replace(/^0+/, '');
  return t === '' ? '0' : t;
}

function parseMambuColon(value: string | null | undefined): { lookupKey: string; accountId: string } | null {
  if (!value) return null;
  const idx = value.indexOf(':');
  if (idx < 1 || idx >= value.length - 1) return null;
  const lookupKey = value.slice(0, idx).trim();
  const accountId = value.slice(idx + 1).trim();
  if (!lookupKey || !accountId) return null;
  return { lookupKey, accountId };
}

function indexLoan(map: Map<string, LoanQueryRow>, key: string, row: LoanQueryRow): void {
  const k = normalizeKey(key);
  if (k && !map.has(k)) map.set(k, row);
  const stripped = stripLeadingZeros(k);
  if (stripped !== k && !map.has(stripped)) map.set(stripped, row);
}

function registerLoan(indexes: LoanIndexes, row: LoanQueryRow): void {
  const lookupKey = scalar(row.LLC_BI__lookupKey__c);
  if (lookupKey) indexLoan(indexes.byLookupKey, lookupKey, row);

  const accountId = scalar(row.Account_ID__c);
  if (accountId) indexLoan(indexes.byAccountId, accountId, row);

  const mambu = scalar(row.Mambu_Loan_for_Integrations__c);
  if (mambu) {
    indexLoan(indexes.byMambuExact, mambu, row);
    const parsed = parseMambuColon(mambu);
    if (parsed) {
      indexLoan(indexes.byMambuLookupSegment, parsed.lookupKey, row);
      indexLoan(indexes.byMambuAccountSegment, parsed.accountId, row);
    }
  }
}

async function queryLoans(whereClause: string): Promise<LoanQueryRow[]> {
  return query<LoanQueryRow>(
    `SELECT ${LOAN_SELECT} FROM ${LOAN_OBJECT} WHERE ${whereClause}`.replace(/\s+/g, ' '),
  );
}

async function fetchLoansWhereIn(field: string, values: string[]): Promise<LoanQueryRow[]> {
  const out: LoanQueryRow[] = [];
  for (let i = 0; i < values.length; i += SOQL_IN_CHUNK) {
    const chunk = values.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((v) => `'${escapeSoqlLiteral(v)}'`).join(',');
    out.push(...(await queryLoans(`${field} IN (${inList})`)));
  }
  return out;
}

async function fetchLoansByMambuLikePatterns(keys: string[]): Promise<LoanQueryRow[]> {
  const out: LoanQueryRow[] = [];
  for (let i = 0; i < keys.length; i += MAMBU_LIKE_CHUNK) {
    const chunk = keys.slice(i, i + MAMBU_LIKE_CHUNK);
    const orParts = chunk.flatMap((k) => {
      const esc = escapeSoqlLiteral(k);
      return [
        `${MAMBU_LOAN_FIELD} LIKE '${esc}:%'`,
        `${MAMBU_LOAN_FIELD} LIKE '%:${esc}'`,
      ];
    });
    if (!orParts.length) continue;
    out.push(...(await queryLoans(`(${orParts.join(' OR ')})`)));
  }
  return out;
}

async function buildIndexesForInputs(inputs: string[]): Promise<LoanIndexes> {
  const indexes: LoanIndexes = {
    byLookupKey: new Map(),
    byAccountId: new Map(),
    byMambuExact: new Map(),
    byMambuLookupSegment: new Map(),
    byMambuAccountSegment: new Map(),
  };

  const unique = [...new Set(inputs.map((k) => k.trim()).filter(Boolean))];
  if (!unique.length) return indexes;

  const rows = await fetchLoansWhereIn(LOAN_LOOKUP_KEY_FIELD, unique);
  for (const row of rows) registerLoan(indexes, row);

  const stillNeeding = unique.filter((input) => !resolveInput(input, indexes));
  if (stillNeeding.length) {
    for (const row of await fetchLoansWhereIn(ACCOUNT_ID_FIELD, stillNeeding)) {
      registerLoan(indexes, row);
    }
  }

  const stillNeeding2 = unique.filter((input) => !resolveInput(input, indexes));
  if (stillNeeding2.length) {
    for (const row of await fetchLoansWhereIn(MAMBU_LOAN_FIELD, stillNeeding2)) {
      registerLoan(indexes, row);
    }
    for (const row of await fetchLoansByMambuLikePatterns(stillNeeding2)) {
      registerLoan(indexes, row);
    }
  }

  return indexes;
}

function getFromMap(map: Map<string, LoanQueryRow>, input: string): LoanQueryRow | undefined {
  const k = normalizeKey(input);
  return map.get(k) ?? map.get(stripLeadingZeros(k));
}

function resolveInput(
  input: string,
  indexes: LoanIndexes,
): { row: LoanQueryRow; method: LoanLookupKeyResolveMethod } | null {
  const k = normalizeKey(input);
  let row = getFromMap(indexes.byLookupKey, k);
  if (row) return { row, method: 'lookupKey' };

  row = getFromMap(indexes.byAccountId, k);
  if (row) return { row, method: 'accountId' };

  row = getFromMap(indexes.byMambuExact, k);
  if (row) return { row, method: 'mambu' };

  row = getFromMap(indexes.byMambuLookupSegment, k);
  if (row) return { row, method: 'mambuColonLookup' };

  row = getFromMap(indexes.byMambuAccountSegment, k);
  if (row) return { row, method: 'mambuColonAccount' };

  return null;
}

function rowFromLoan(
  id: number,
  inputRef: string,
  resolved: { row: LoanQueryRow; method: LoanLookupKeyResolveMethod } | null,
): LoanLookupKeyRow {
  if (!resolved) {
    return {
      id,
      inputRef,
      lookupKey: null,
      accountId: null,
      mambuLoanForIntegrations: null,
      loanId: null,
      loanName: null,
      resolvedVia: null,
    };
  }
  const { row, method } = resolved;
  let lookupKey = scalar(row.LLC_BI__lookupKey__c);
  let accountId = scalar(row.Account_ID__c);
  const mambu = scalar(row.Mambu_Loan_for_Integrations__c);
  const parsed = parseMambuColon(mambu);
  if (parsed) {
    if (!lookupKey) lookupKey = parsed.lookupKey;
    if (!accountId) accountId = parsed.accountId;
  }
  return {
    id,
    inputRef,
    lookupKey,
    accountId,
    mambuLoanForIntegrations: mambu,
    loanId: row.Id,
    loanName: row.Name ?? null,
    resolvedVia: method,
  };
}

const MAIN_HEADERS = [
  'Id',
  'inputRef',
  'lookupKey',
  'accountId',
  'mambuLoanForIntegrations',
  'loanId',
  'loanName',
  'resolvedVia',
] as const;

const MISSING_HEADERS = [
  'Id',
  'inputRef',
  'lookupKey',
  'accountId',
  'mambuLoanForIntegrations',
] as const;

function mainRowsToCsv(rows: LoanLookupKeyRow[]): string {
  const lines = [MAIN_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        String(r.id),
        escapeCsv(r.inputRef),
        escapeCsv(r.lookupKey),
        escapeCsv(r.accountId),
        escapeCsv(r.mambuLoanForIntegrations),
        escapeCsv(r.loanId),
        escapeCsv(r.loanName),
        escapeCsv(r.resolvedVia),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function missingRowsToCsv(rows: LoanLookupKeyRow[]): string {
  const lines = [MISSING_HEADERS.join(',')];
  let mid = 1;
  for (const r of rows) {
    if (r.loanId) continue;
    lines.push(
      [
        String(mid++),
        escapeCsv(r.inputRef),
        escapeCsv(r.lookupKey),
        escapeCsv(r.accountId),
        escapeCsv(r.mambuLoanForIntegrations),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function exportLoansByLookupKeys(
  lookupKeys: string[],
): Promise<{ rows: LoanLookupKeyRow[]; missing: string[] }> {
  await connectNcino();
  const indexes = await buildIndexesForInputs(lookupKeys);

  const rows: LoanLookupKeyRow[] = [];
  const missing: string[] = [];
  let nextId = 1;

  for (const ref of lookupKeys) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    const resolved = resolveInput(trimmed, indexes);
    const row = rowFromLoan(nextId++, trimmed, resolved);
    rows.push(row);
    if (!row.loanId) missing.push(trimmed);
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
  const missingCsvPath = join(outDir, `loan-lookup-key-${batch.batchLabel}-missing.csv`);
  writeFileSync(csvPath, mainRowsToCsv(rows), 'utf8');
  writeFileSync(missingCsvPath, missingRowsToCsv(rows), 'utf8');

  return {
    rows,
    missing,
    csvPath,
    missingCsvPath,
    rowCount: rows.length,
    missingCount: missing.length,
  };
}

export { batchLabel };