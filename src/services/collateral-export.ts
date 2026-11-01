import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { connectNcino, query } from '../clients/ncino.js';
import { config } from '../config/env.js';
import type { LoanCollateralExportRow } from '../types/collateral-export.js';
import type { CollateralExportFilter, LoanBatchInfo } from '../types/export.js';
import { escapeCsv, rowsToCsv } from '../utils/csv.js';
import {
  collateralAddressFromFields,
  hasUsableCollateralAddress,
  isResidentialCollateralType,
  resolveCollateralExportFilter,
} from './collateral-filter.js';
import { loadExportConfig } from './load-export-config.js';
import { resolveLoanRef } from './loan-documents.js';

interface LoanCollateralQueryRow {
  Id: string;
  LLC_BI__Loan__c: string;
  LLC_BI__Collateral__c?: string;
  LLC_BI__Lien_Position__c?: string;
  LLC_BI__Collateral__r?: {
    Id?: string;
    Name?: string;
    LLC_BI__Collateral_Type__c?: string;
    LLC_BI__Collateral_Type__r?: { Name?: string };
    LLC_BI__Full_Address__c?: string;
    LLC_BI__Street_Address__c?: string;
    LLC_BI__City__c?: string;
    LLC_BI__Zip_Code__c?: string;
    Usage__c?: string;
  };
  [key: string]: unknown;
}

function collateralPostcode(col: LoanCollateralQueryRow['LLC_BI__Collateral__r']): string | null {
  const zip = col?.LLC_BI__Zip_Code__c?.trim();
  return zip || null;
}

async function fetchCollateralRowsForLoanIds(
  loanIdToName: Map<string, string | null>,
  filter: CollateralExportFilter,
): Promise<LoanCollateralExportRow[]> {
  const loanIds = [...loanIdToName.keys()];
  if (!loanIds.length) return [];

  const idList = loanIds.map((id) => `'${id}'`).join(',');
  const soql = `
    SELECT Id, LLC_BI__Loan__c, LLC_BI__Collateral__c, LLC_BI__Lien_Position__c,
           LLC_BI__Collateral__r.Id, LLC_BI__Collateral__r.Name,
           LLC_BI__Collateral__r.LLC_BI__Collateral_Type__c,
           LLC_BI__Collateral__r.LLC_BI__Collateral_Type__r.Name,
           LLC_BI__Collateral__r.LLC_BI__Full_Address__c,
           LLC_BI__Collateral__r.LLC_BI__Street_Address__c,
           LLC_BI__Collateral__r.LLC_BI__City__c,
           LLC_BI__Collateral__r.LLC_BI__Zip_Code__c,
           LLC_BI__Collateral__r.Usage__c
    FROM LLC_BI__Loan_Collateral2__c
    WHERE LLC_BI__Loan__c IN (${idList})
    ORDER BY LLC_BI__Loan__c, LLC_BI__Collateral__r.Name, Id
  `
    .replace(/\s+/g, ' ')
    .trim();

  const links = await query<LoanCollateralQueryRow>(soql);
  const rows: LoanCollateralExportRow[] = [];
  let nextId = 1;

  for (const link of links) {
    const col = link.LLC_BI__Collateral__r;
    const collateralId = link.LLC_BI__Collateral__c ?? col?.Id;
    if (!collateralId) continue;

    const typeName = col?.LLC_BI__Collateral_Type__r?.Name ?? null;
    if (!isResidentialCollateralType(typeName, filter)) continue;

    const collateralAddress = collateralAddressFromFields({
      fullAddress: col?.LLC_BI__Full_Address__c,
      streetAddress: col?.LLC_BI__Street_Address__c,
      city: col?.LLC_BI__City__c,
      zipCode: col?.LLC_BI__Zip_Code__c,
    });

    if (filter.requireAddress && !hasUsableCollateralAddress(collateralAddress)) continue;

    rows.push({
      id: nextId++,
      loanId: link.LLC_BI__Loan__c,
      loanName: loanIdToName.get(link.LLC_BI__Loan__c) ?? null,
      loanCollateralId: link.Id,
      collateralId,
      collateralName: col?.Name ?? null,
      collateralTypeId: col?.LLC_BI__Collateral_Type__c ?? null,
      collateralTypeName: typeName,
      lienPosition: link.LLC_BI__Lien_Position__c ?? null,
      collateralAddress,
      usage: col?.Usage__c ?? null,
      postcode: collateralPostcode(col),
    });
  }

  return rows;
}

function collateralRowsToCsv(rows: LoanCollateralExportRow[]): string {
  const headers = [
    'Id',
    'loanId',
    'loanName',
    'loanCollateralId',
    'collateralId',
    'collateralName',
    'collateralTypeId',
    'collateralTypeName',
    'collateralAddress',
    'postcode',
    'usage',
    'lienPosition',
  ];
  const data = rows.map((r) => [
    String(r.id),
    escapeCsv(r.loanId),
    escapeCsv(r.loanName),
    escapeCsv(r.loanCollateralId),
    escapeCsv(r.collateralId),
    escapeCsv(r.collateralName),
    escapeCsv(r.collateralTypeId),
    escapeCsv(r.collateralTypeName),
    escapeCsv(r.collateralAddress),
    escapeCsv(r.postcode),
    escapeCsv(r.usage),
    escapeCsv(r.lienPosition),
  ]);
  return rowsToCsv(headers, data);
}

export interface CollateralBatchExportResult {
  batch: LoanBatchInfo;
  csvPath: string;
  rowCount: number;
  rows: LoanCollateralExportRow[];
}

export async function exportCollateralBatch(
  batch: LoanBatchInfo,
  outputRoot?: string,
): Promise<CollateralBatchExportResult> {
  await connectNcino();
  const exportConfig = loadExportConfig();
  const filter = resolveCollateralExportFilter(exportConfig.collateralExport);

  const root = outputRoot ?? join(config.export.localDir, '..', 'collateral');
  const outDir = join(root, batch.batchLabel);
  mkdirSync(outDir, { recursive: true });

  const loanIdToName = new Map<string, string | null>();
  for (const loanRef of batch.loanRefs) {
    try {
      const { id, name } = await resolveLoanRef(loanRef);
      loanIdToName.set(id, name);
    } catch {
      if (/^[a-zA-Z0-9]{15,18}$/.test(loanRef)) {
        loanIdToName.set(loanRef, null);
      }
    }
  }

  const rows = await fetchCollateralRowsForLoanIds(loanIdToName, filter);
  const csvPath = join(outDir, `collateral-${batch.batchLabel}.csv`);
  writeFileSync(csvPath, collateralRowsToCsv(rows), 'utf8');

  return { batch, csvPath, rowCount: rows.length, rows };
}
