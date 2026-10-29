import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { connectNcino, query } from '../clients/ncino.js';
import { config } from '../config/env.js';
import type { LoanBatchInfo } from '../types/export.js';
import type { TruNarrativeRelationshipRow } from '../types/trunarrative.js';
import { resolveLoanRef } from './loan-documents.js';
import { batchLabel } from './loan-id-batches.js';

/** Account custom field (UI: TruNarrative Account Reference). */
export const TRU_NARRATIVE_ACCOUNT_FIELD = 'TruNarrative_Account_Reference__c';

interface LegalEntityWithAccountRow {
  Id: string;
  LLC_BI__Loan__c: string;
  LLC_BI__Account__c?: string;
  LLC_BI__Borrower_Type__c?: string;
  LLC_BI__Account__r?: {
    Id?: string;
    Name?: string;
    TruNarrative_Account_Reference__c?: string;
  };
  [key: string]: unknown;
}

function escapeCsv(value: string | null | undefined): string {
  const s = value ?? '';
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: TruNarrativeRelationshipRow[]): string {
  const header = [
    'Id',
    'loanId',
    'loanName',
    'legalEntityId',
    'accountId',
    'accountName',
    'borrowerType',
    'truNarrativeAccountReference',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        String(r.id),
        escapeCsv(r.loanId),
        escapeCsv(r.loanName),
        escapeCsv(r.legalEntityId),
        escapeCsv(r.accountId),
        escapeCsv(r.accountName),
        escapeCsv(r.borrowerType),
        escapeCsv(r.truNarrativeAccountReference),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function fetchRelationshipsForLoanIds(
  loanIdToName: Map<string, string | null>,
): Promise<TruNarrativeRelationshipRow[]> {
  const loanIds = [...loanIdToName.keys()];
  if (!loanIds.length) return [];

  const idList = loanIds.map((id) => `'${id}'`).join(',');
  const soql = `
    SELECT Id, LLC_BI__Loan__c, LLC_BI__Account__c, LLC_BI__Borrower_Type__c,
           LLC_BI__Account__r.Id, LLC_BI__Account__r.Name,
           LLC_BI__Account__r.${TRU_NARRATIVE_ACCOUNT_FIELD}
    FROM LLC_BI__Legal_Entities__c
    WHERE LLC_BI__Loan__c IN (${idList})
    ORDER BY LLC_BI__Loan__c, LLC_BI__Borrower_Type__c, Id
  `
    .replace(/\s+/g, ' ')
    .trim();

  const entities = await query<LegalEntityWithAccountRow>(soql);
  const rows: TruNarrativeRelationshipRow[] = [];
  let nextId = 1;

  for (const e of entities) {
    const accountId = e.LLC_BI__Account__c ?? e.LLC_BI__Account__r?.Id;
    if (!accountId) continue;
    rows.push({
      id: nextId++,
      loanId: e.LLC_BI__Loan__c,
      loanName: loanIdToName.get(e.LLC_BI__Loan__c) ?? null,
      legalEntityId: e.Id,
      accountId,
      accountName: e.LLC_BI__Account__r?.Name ?? null,
      borrowerType: e.LLC_BI__Borrower_Type__c ?? null,
      truNarrativeAccountReference:
        (e.LLC_BI__Account__r?.TruNarrative_Account_Reference__c as string | undefined) ?? null,
    });
  }
  return rows;
}

export interface TruNarrativeBatchExportResult {
  batch: LoanBatchInfo;
  csvPath: string;
  rowCount: number;
  rows: TruNarrativeRelationshipRow[];
}

export async function exportTruNarrativeBatch(
  batch: LoanBatchInfo,
  outputRoot?: string,
): Promise<TruNarrativeBatchExportResult> {
  await connectNcino();
  const root = outputRoot ?? join(config.export.localDir, '..', 'trunarrative');
  const outDir = join(root, batch.batchLabel);
  mkdirSync(outDir, { recursive: true });

  const loanIdToName = new Map<string, string | null>();
  for (const loanRef of batch.loanRefs) {
    try {
      const { id, name } = await resolveLoanRef(loanRef);
      loanIdToName.set(id, name);
    } catch {
      // Still attempt if ref is already a valid id in file
      if (/^[a-zA-Z0-9]{15,18}$/.test(loanRef)) {
        loanIdToName.set(loanRef, null);
      }
    }
  }

  const rows = await fetchRelationshipsForLoanIds(loanIdToName);
  const csvPath = join(outDir, `trunarrative-${batch.batchLabel}.csv`);
  writeFileSync(csvPath, rowsToCsv(rows), 'utf8');

  return { batch, csvPath, rowCount: rows.length, rows };
}

export { batchLabel };
