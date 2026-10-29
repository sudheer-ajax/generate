import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { connectNcino, query } from '../clients/ncino.js';
import type {
  LoanExistenceCheckResult,
  LoanExistenceRow,
  LoanRefKind,
} from '../types/loan-existence.js';

const LOAN_OBJECT = 'LLC_BI__Loan__c';
const SOQL_IN_CHUNK = 200;

const SF_ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;

interface LoanRow {
  Id: string;
  Name: string;
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

function classifyRef(ref: string): LoanRefKind {
  return SF_ID_PATTERN.test(ref) ? 'salesforce_id' : 'loan_name';
}

async function fetchLoansByIds(ids: string[]): Promise<Map<string, LoanRow>> {
  const map = new Map<string, LoanRow>();
  for (let i = 0; i < ids.length; i += SOQL_IN_CHUNK) {
    const chunk = ids.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((id) => `'${escapeSoqlLiteral(id)}'`).join(',');
    const rows = await query<LoanRow>(
      `SELECT Id, Name FROM ${LOAN_OBJECT} WHERE Id IN (${inList})`,
    );
    for (const row of rows) {
      map.set(row.Id, row);
      if (row.Id.length === 18) {
        map.set(row.Id.slice(0, 15), row);
      }
    }
  }
  return map;
}

async function fetchLoansByNames(names: string[]): Promise<Map<string, LoanRow>> {
  const map = new Map<string, LoanRow>();
  for (let i = 0; i < names.length; i += SOQL_IN_CHUNK) {
    const chunk = names.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((n) => `'${escapeSoqlLiteral(n)}'`).join(',');
    const rows = await query<LoanRow>(
      `SELECT Id, Name FROM ${LOAN_OBJECT} WHERE Name IN (${inList})`,
    );
    for (const row of rows) {
      map.set(row.Name, row);
    }
  }
  return map;
}

function rowsToCsv(rows: LoanExistenceRow[]): string {
  const header = [
    'index',
    'inputRef',
    'inputKind',
    'existsInOrg',
    'loanId',
    'loanName',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        String(r.index),
        escapeCsv(r.inputRef),
        escapeCsv(r.inputKind),
        r.existsInOrg ? 'yes' : 'no',
        escapeCsv(r.loanId),
        escapeCsv(r.loanName),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export interface CheckLoanExistenceOptions {
  loanRefs: string[];
  /** Path to write CSV report. */
  csvPath: string;
  loanIdsFile: string;
}

/**
 * For each prod (or source) loan ref, check whether LLC_BI__Loan__c exists in the
 * connected Salesforce org (e.g. backup sandbox). Uses batched SOQL by Id or Name.
 */
export async function checkLoanExistence(
  options: CheckLoanExistenceOptions,
): Promise<LoanExistenceCheckResult> {
  await connectNcino();

  const ids: string[] = [];
  const names: string[] = [];
  const classified: { ref: string; kind: LoanRefKind }[] = [];

  for (const ref of options.loanRefs) {
    const kind = classifyRef(ref);
    classified.push({ ref, kind });
    if (kind === 'salesforce_id') ids.push(ref);
    else names.push(ref);
  }

  const uniqueIds = [...new Set(ids)];
  const uniqueNames = [...new Set(names)];

  const [byId, byName] = await Promise.all([
    uniqueIds.length ? fetchLoansByIds(uniqueIds) : Promise.resolve(new Map<string, LoanRow>()),
    uniqueNames.length ? fetchLoansByNames(uniqueNames) : Promise.resolve(new Map<string, LoanRow>()),
  ]);

  const rows: LoanExistenceRow[] = classified.map(({ ref, kind }, i) => {
    let found: LoanRow | undefined;
    if (kind === 'salesforce_id') {
      found = byId.get(ref) ?? byId.get(ref.slice(0, 15));
    } else {
      found = byName.get(ref);
    }
    return {
      index: i + 1,
      inputRef: ref,
      inputKind: kind,
      existsInOrg: Boolean(found),
      loanId: found?.Id ?? null,
      loanName: found?.Name ?? null,
    };
  });

  const foundCount = rows.filter((r) => r.existsInOrg).length;
  const summary = {
    totalInput: rows.length,
    foundCount,
    missingCount: rows.length - foundCount,
    queriedAt: new Date().toISOString(),
    loanIdsFile: options.loanIdsFile,
  };

  mkdirSync(dirname(options.csvPath), { recursive: true });
  writeFileSync(options.csvPath, rowsToCsv(rows), 'utf8');

  return {
    rows,
    summary,
    csvPath: options.csvPath,
  };
}

export function defaultLoanExistenceCsvPath(baseDir = 'output/loan-existence'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(baseDir, `loan-existence-${stamp}.csv`);
}
