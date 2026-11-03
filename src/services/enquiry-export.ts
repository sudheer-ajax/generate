import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { connectNcino, query } from '../clients/ncino.js';
import { config } from '../config/env.js';
import type { LoanBatchInfo } from '../types/export.js';
import type { EnquiryExportRow } from '../types/enquiry-export.js';
import { batchLabel } from './loan-id-batches.js';
import { resolveLoanRef } from './loan-documents.js';

/** nCino / nRE Enquiry object (UI label: Enquiry). */
export const ENQUIRY_OBJECT = 'nRE__Referral__c';
export const ENQUIRY_SOURCE_CHANNEL_FIELD = 'nRE__Referral_Source__c';
export const ENQUIRY_LOAN_FIELD = 'Loan__c';

const SOQL_IN_CHUNK = 200;
const SF_ID = /^[a-zA-Z0-9]{15,18}$/;

interface EnquiryQueryRow {
  Id: string;
  Name?: string;
  nRE__Referral_Source__c?: string;
  Loan__c?: string;
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

function rowsToCsv(rows: EnquiryExportRow[]): string {
  const header = [
    'Id',
    'enquiryId',
    'enquiryNumber',
    'enquirySourceChannel',
    'loanId',
    'loanName',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        String(r.id),
        escapeCsv(r.enquiryId),
        escapeCsv(r.enquiryNumber),
        escapeCsv(r.enquirySourceChannel),
        escapeCsv(r.loanId),
        escapeCsv(r.loanName),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function fetchEnquiriesByIds(ids: string[]): Promise<Map<string, EnquiryQueryRow>> {
  const map = new Map<string, EnquiryQueryRow>();
  for (let i = 0; i < ids.length; i += SOQL_IN_CHUNK) {
    const chunk = ids.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((id) => `'${escapeSoqlLiteral(id)}'`).join(',');
    const rows = await query<EnquiryQueryRow>(`
      SELECT Id, Name, ${ENQUIRY_SOURCE_CHANNEL_FIELD}, ${ENQUIRY_LOAN_FIELD}
      FROM ${ENQUIRY_OBJECT}
      WHERE Id IN (${inList})
    `.replace(/\s+/g, ' '));
    for (const row of rows) map.set(row.Id, row);
  }
  return map;
}

async function fetchEnquiriesByNumbers(numbers: string[]): Promise<Map<string, EnquiryQueryRow>> {
  const map = new Map<string, EnquiryQueryRow>();
  for (let i = 0; i < numbers.length; i += SOQL_IN_CHUNK) {
    const chunk = numbers.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((n) => `'${escapeSoqlLiteral(n)}'`).join(',');
    const rows = await query<EnquiryQueryRow>(`
      SELECT Id, Name, ${ENQUIRY_SOURCE_CHANNEL_FIELD}, ${ENQUIRY_LOAN_FIELD}
      FROM ${ENQUIRY_OBJECT}
      WHERE Name IN (${inList})
    `.replace(/\s+/g, ' '));
    for (const row of rows) {
      if (row.Name) map.set(row.Name, row);
    }
  }
  return map;
}

/** Match input loan Ids (LLC_BI__Loan__c) via Enquiry.Loan__c; newest enquiry wins per loan. */
async function fetchEnquiriesByLoanIds(loanIds: string[]): Promise<Map<string, EnquiryQueryRow>> {
  const map = new Map<string, EnquiryQueryRow>();
  for (let i = 0; i < loanIds.length; i += SOQL_IN_CHUNK) {
    const chunk = loanIds.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((id) => `'${escapeSoqlLiteral(id)}'`).join(',');
    const rows = await query<EnquiryQueryRow>(`
      SELECT Id, Name, ${ENQUIRY_SOURCE_CHANNEL_FIELD}, ${ENQUIRY_LOAN_FIELD}
      FROM ${ENQUIRY_OBJECT}
      WHERE ${ENQUIRY_LOAN_FIELD} IN (${inList})
      ORDER BY ${ENQUIRY_LOAN_FIELD}, CreatedDate DESC
    `.replace(/\s+/g, ' '));
    for (const row of rows) {
      const loanId = row.Loan__c;
      if (loanId && !map.has(loanId)) map.set(loanId, row);
    }
  }
  return map;
}

export async function exportEnquiriesForRefs(
  enquiryRefs: string[],
): Promise<{ rows: EnquiryExportRow[]; missing: string[] }> {
  await connectNcino();

  const ids: string[] = [];
  const numbers: string[] = [];
  const ordered: { ref: string; kind: 'id' | 'number' }[] = [];

  for (const ref of enquiryRefs) {
    if (SF_ID.test(ref)) {
      ids.push(ref);
      ordered.push({ ref, kind: 'id' });
    } else {
      numbers.push(ref);
      ordered.push({ ref, kind: 'number' });
    }
  }

  const [byId, byNumber, byLoanId] = await Promise.all([
    ids.length ? fetchEnquiriesByIds(ids) : Promise.resolve(new Map()),
    numbers.length ? fetchEnquiriesByNumbers(numbers) : Promise.resolve(new Map()),
    ids.length ? fetchEnquiriesByLoanIds(ids) : Promise.resolve(new Map()),
  ]);

  const loanNameCache = new Map<string, string | null>();
  async function loanNameFor(loanId: string | null | undefined): Promise<string | null> {
    if (!loanId) return null;
    if (loanNameCache.has(loanId)) return loanNameCache.get(loanId) ?? null;
    try {
      const { name } = await resolveLoanRef(loanId);
      loanNameCache.set(loanId, name);
      return name;
    } catch {
      loanNameCache.set(loanId, null);
      return null;
    }
  }

  const rows: EnquiryExportRow[] = [];
  const missing: string[] = [];
  let nextId = 1;

  for (const { ref, kind } of ordered) {
    const found =
      kind === 'number'
        ? byNumber.get(ref)
        : (byId.get(ref) ?? byLoanId.get(ref));
    if (!found) {
      missing.push(ref);
      continue;
    }
    const loanId = found.Loan__c ?? null;
    rows.push({
      id: nextId++,
      enquiryId: found.Id,
      enquiryNumber: found.Name ?? null,
      enquirySourceChannel: found.nRE__Referral_Source__c ?? null,
      loanId,
      loanName: await loanNameFor(loanId),
    });
  }

  return { rows, missing };
}

export interface EnquiryBatchExportResult {
  batch: LoanBatchInfo;
  csvPath: string;
  rowCount: number;
  missing: string[];
  rows: EnquiryExportRow[];
}

export async function exportEnquiryBatch(
  batch: LoanBatchInfo,
  outputRoot?: string,
): Promise<EnquiryBatchExportResult> {
  const root = outputRoot ?? join(config.export.localDir, '..', 'enquiry');
  const outDir = join(root, batch.batchLabel);
  mkdirSync(outDir, { recursive: true });

  const { rows, missing } = await exportEnquiriesForRefs(batch.loanRefs);
  const csvPath = join(outDir, `enquiry-${batch.batchLabel}.csv`);
  writeFileSync(csvPath, rowsToCsv(rows), 'utf8');

  return {
    batch,
    csvPath,
    rowCount: rows.length,
    missing,
    rows,
  };
}

export { batchLabel };
