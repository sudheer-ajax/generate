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
/** Account custom field (UI: Relationship ID). */
export const RELATIONSHIP_ID_FIELD = 'Relationship_ID__c';

interface LegalEntityWithAccountRow {
  Id: string;
  LLC_BI__Loan__c: string;
  LLC_BI__Loan__r?: {
    LLC_BI__Index__c?: string;
    Current_LTV_Basis__c?: string | number;
    Current_LTV_Basis_2__c?: string | number;
    LTV_Basis_1__c?: string | number;
    LTV_Basis_2__c?: string | number;
    LLC_BI__LeadSource__c?: string;
  };
  LLC_BI__Account__c?: string;
  LLC_BI__Borrower_Type__c?: string;
  LLC_BI__Account__r?: {
    Id?: string;
    Name?: string;
    Type?: string;
    TruNarrative_Account_Reference__c?: string;
    Relationship_ID__c?: string;
  };
  [key: string]: unknown;
}

function escapeCsv(value: string | null | undefined): string {
  const s = value ?? '';
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function loanScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return String(value);
  const s = String(value).trim();
  return s === '' ? null : s;
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
    'relationshipType',
    'relationshipId',
    'truNarrativeAccountReference',
    'loanIndex',
    'currentLtvBasis',
    'currentLtvBasis2',
    'ltvBasis1',
    'ltvBasis2',
    'leadSource',
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
        escapeCsv(r.relationshipType),
        escapeCsv(r.relationshipId),
        escapeCsv(r.truNarrativeAccountReference),
        escapeCsv(r.loanIndex),
        escapeCsv(r.currentLtvBasis),
        escapeCsv(r.currentLtvBasis2),
        escapeCsv(r.ltvBasis1),
        escapeCsv(r.ltvBasis2),
        escapeCsv(r.leadSource),
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
           LLC_BI__Loan__r.LLC_BI__Index__c,
           LLC_BI__Loan__r.Current_LTV_Basis__c,
           LLC_BI__Loan__r.Current_LTV_Basis_2__c,
           LLC_BI__Loan__r.LTV_Basis_1__c,
           LLC_BI__Loan__r.LTV_Basis_2__c,
           LLC_BI__Loan__r.LLC_BI__LeadSource__c,
           LLC_BI__Account__r.Id, LLC_BI__Account__r.Name, LLC_BI__Account__r.Type,
           LLC_BI__Account__r.${TRU_NARRATIVE_ACCOUNT_FIELD},
           LLC_BI__Account__r.${RELATIONSHIP_ID_FIELD}
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
    const loan = e.LLC_BI__Loan__r;
    rows.push({
      id: nextId++,
      loanId: e.LLC_BI__Loan__c,
      loanName: loanIdToName.get(e.LLC_BI__Loan__c) ?? null,
      legalEntityId: e.Id,
      accountId,
      accountName: e.LLC_BI__Account__r?.Name ?? null,
      borrowerType: e.LLC_BI__Borrower_Type__c ?? null,
      relationshipType: e.LLC_BI__Account__r?.Type ?? null,
      relationshipId:
        (e.LLC_BI__Account__r?.Relationship_ID__c as string | undefined) ?? null,
      truNarrativeAccountReference:
        (e.LLC_BI__Account__r?.TruNarrative_Account_Reference__c as string | undefined) ?? null,
      loanIndex: loanScalar(loan?.LLC_BI__Index__c),
      currentLtvBasis: loanScalar(loan?.Current_LTV_Basis__c),
      currentLtvBasis2: loanScalar(loan?.Current_LTV_Basis_2__c),
      ltvBasis1: loanScalar(loan?.LTV_Basis_1__c),
      ltvBasis2: loanScalar(loan?.LTV_Basis_2__c),
      leadSource: loanScalar(loan?.LLC_BI__LeadSource__c),
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
