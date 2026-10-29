import { assertSalesforceAuthConfig, config } from '../config/env.js';
import { exportCollateralBatch } from '../services/collateral-export.js';
import { loadExportConfig } from '../services/load-export-config.js';
import {
  describeBatches,
  getBatch,
  loadLoanIdsFromFile,
} from '../services/loan-id-batches.js';

function usage(): never {
  console.error(`
Usage:
  npm run collateral:batch -- --list
  npm run collateral:batch -- <batchNumber>

Reads loan ids from ${config.export.loanIdsFile} (same batches as docs:batch).
Writes CSV: output/collateral/batch-NNN/collateral-batch-NNN.csv

Filtered by data/export.config.json collateralExport (default: residential type + has address).
Lien: LLC_BI__Loan_Collateral2__c.LLC_BI__Lien_Position__c
Address: LLC_BI__Collateral__c.LLC_BI__Full_Address__c
`);
  process.exit(1);
}

function parseArgs(argv: string[]): { list: boolean; batchNumber: number | null } {
  const args = argv.slice(2);
  let list = false;
  let batchNumber: number | null = null;
  for (const a of args) {
    if (a === '--list') list = true;
    else if (a.startsWith('--batch=')) batchNumber = Number(a.slice('--batch='.length));
    else if (/^\d+$/.test(a)) batchNumber = Number(a);
    else if (a.startsWith('-')) usage();
    else usage();
  }
  return { list, batchNumber };
}

async function main(): Promise<void> {
  assertSalesforceAuthConfig();
  const { list, batchNumber } = parseArgs(process.argv);
  const exportConfig = loadExportConfig();
  const loanRefs = loadLoanIdsFromFile(config.export.loanIdsFile);
  if (!loanRefs.length) {
    throw new Error(`No loan ids in ${config.export.loanIdsFile}`);
  }

  const batches = describeBatches(loanRefs, exportConfig.batchSize);

  if (list) {
    console.log(
      `Loans: ${loanRefs.length} | Batch size: ${exportConfig.batchSize} | Batches: ${batches.length}`,
    );
    for (const b of batches) {
      console.log(`Batch ${b.batchNumber} (${b.batchLabel}): ${b.loanRefs.join(', ')}`);
    }
    return;
  }

  if (batchNumber == null || !Number.isFinite(batchNumber) || batchNumber < 1) {
    usage();
  }

  const batch = getBatch(loanRefs, exportConfig.batchSize, batchNumber);
  console.log(`Collateral export ${batch.batchLabel} (${batch.loanRefs.length} loans)`);
  const result = await exportCollateralBatch(batch);
  console.log(`Rows: ${result.rowCount}`);
  console.log(`CSV: ${result.csvPath}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
