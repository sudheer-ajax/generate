import { assertSalesforceAuthConfig, config } from '../config/env.js';
import { exportEnquiryBatch } from '../services/enquiry-export.js';
import { loadExportConfig } from '../services/load-export-config.js';
import {
  describeBatches,
  getBatch,
  loadLoanIdsFromFile,
} from '../services/loan-id-batches.js';

function usage(): never {
  console.error(`
Usage:
  npm run enquiry:batch -- --list
  npm run enquiry:batch -- <batchNumber>

Reads enquiry refs from ${config.export.loanIdsFile} (one per line).
Each line: Enquiry Id, Enquiry Number (Ref-…), or Loan Id (LLC_BI__Loan__c — resolves via Loan__c).

Writes CSV: output/enquiry/batch-NNN/enquiry-batch-NNN.csv
Columns: enquiryId, enquiryNumber, enquirySourceChannel, loanId, loanName
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
  const enquiryRefs = loadLoanIdsFromFile(config.export.loanIdsFile);
  if (!enquiryRefs.length) {
    throw new Error(`No enquiry refs in ${config.export.loanIdsFile}`);
  }

  const batches = describeBatches(enquiryRefs, exportConfig.batchSize);

  if (list) {
    console.log(
      `Enquiries: ${enquiryRefs.length} | Batch size: ${exportConfig.batchSize} | Batches: ${batches.length}`,
    );
    for (const b of batches) {
      console.log(`Batch ${b.batchNumber} (${b.batchLabel}): ${b.loanRefs.join(', ')}`);
    }
    return;
  }

  if (batchNumber == null || !Number.isFinite(batchNumber) || batchNumber < 1) {
    usage();
  }

  const batch = getBatch(enquiryRefs, exportConfig.batchSize, batchNumber);
  console.log(`Enquiry export ${batch.batchLabel} (${batch.loanRefs.length} refs)`);
  const result = await exportEnquiryBatch(batch);
  console.log(`Rows: ${result.rowCount}`);
  console.log(`CSV: ${result.csvPath}`);
  if (result.missing.length) {
    console.warn(`Not found (${result.missing.length}): ${result.missing.join(', ')}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
