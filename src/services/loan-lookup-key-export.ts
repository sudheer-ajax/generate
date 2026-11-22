import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { connectNcino, query } from '../clients/ncino.js';
import { config } from '../config/env.js';
import type { LoanLookupKeyExportResult, LoanLookupKeyRow } from '../types/loan-lookup-key.js';

export const ACCOUNT_ID_FIELD = 'Account_ID__c';
const LOAN_OBJECT = 'LLC_BI__Loan__c';
const SOQL_IN_CHUNK = 200;

interface LoanByAccountIdRow {
  Id: string;
  Name?: string;
  Account_ID__c?: string | number;
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

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function normalizeAccountId(value: string): string {
  return value.trim();
}

function rowsToCsv(rows: LoanLookupKeyRow[]): string {
  const header = ['Id', 'accountIdInput', 'accountId', 'loanId', 'loanName'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        String(r.id),
        escapeCsv(r.accountIdInput),
        escapeCsv(r.accountId),
        escapeCsv(r.loanId),
        escapeCsv(r.loanName),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function fetchLoansByAccountIds(accountIds: string[]): Promise<Map<string, LoanByAccountIdRow>> {
  const map = new Map<string, LoanByAccountIdRow>();
  const unique = [...new Set(accountIds.map(normalizeAccountId).filter(Boolean))];

  for (let i = 0; i < unique.length; i += SOQL_IN_CHUNK) {
    const chunk = unique.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((id) => `'${escapeSoqlLiteral(id)}'`).join(',');
    const rows = await query<LoanByAccountIdRow>(
      `SELECT Id, Name, ${ACCOUNT_ID_FIELD}
       FROM ${LOAN_OBJECT}
       WHERE ${ACCOUNT_ID_FIELD} IN (${inList})
       ORDER BY ${ACCOUNT_ID_FIELD}, Id`.replace(/\s+/g, ' '),
    );
    for (const row of rows) {
      const key = scalar(row.Account_ID__c);
      if (!key || map.has(key)) continue;
      map.set(key, row);
    }
  }
  return map;
}

function findLoan(
  byAccountId: Map<string, LoanByAccountIdRow>,
  input: string,
): LoanByAccountIdRow | undefined {
  const key = normalizeAccountId(input);
  return byAccountId.get(key);
}

export function defaultLoanLookupCsvPath(): string {
  return join(config.export.localDir, '..', 'loan-lookup-key', 'loans-by-account-id.csv');
}

/**
 * Resolve LLC_BI__Loan__c by Account_ID__c (one value per line in the input file).
 */
export async function exportLoansByAccountIds(
  accountIdInputs: string[],
  csvPath?: string,
): Promise<LoanLookupKeyExportResult> {
  await connectNcino();

  const ordered = accountIdInputs.map(normalizeAccountId).filter(Boolean);
  const byAccountId = await fetchLoansByAccountIds(ordered);

  const rows: LoanLookupKeyRow[] = [];
  const missing: string[] = [];
  let nextId = 1;

  for (const accountIdInput of ordered) {
    const found = findLoan(byAccountId, accountIdInput);
    if (!found) {
      missing.push(accountIdInput);
      rows.push({
        id: nextId++,
        accountIdInput,
        accountId: null,
        loanId: null,
        loanName: null,
      });
      continue;
    }
    rows.push({
      id: nextId++,
      accountIdInput,
      accountId: scalar(found.Account_ID__c),
      loanId: found.Id,
      loanName: found.Name ?? null,
    });
  }

  const outPath = csvPath ?? defaultLoanLookupCsvPath();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rowsToCsv(rows), 'utf8');

  return {
    rows,
    missing,
    csvPath: outPath,
    rowCount: rows.length,
    missingCount: missing.length,
  };
}