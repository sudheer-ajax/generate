import { assertSalesforceAuthConfig, config } from '../config/env.js';
import { exportLoanLookupKeyBatch } from '../services/loan-lookup-key-export.js';
import { loadExportConfig } from '../services/load-export-config.js';
import {
  describeBatches,
  getBatch,
  loadLoanIdsFromFile,
} from '../services/loan-id-batches.js';

function usage(): never {
  console.error(`
Usage:
  npm run loans:lookup-key -- --list
  npm run loans:lookup-key -- <batchNumber>
  npm run loans:lookup-key -- all

Reads ${config.export.loanLookupKeysFile} (one LLC_BI__lookupKey__c per line, e.g. 8075722).
Writes CSV: output/loan-lookup-key/batch-NNN/loan-lookup-key-batch-NNN.csv
Columns: inputRef, lookupKey, accountId, mambuLoanForIntegrations, loanId, loanName, resolvedVia
Also writes …-missing.csv for inputs that could not be resolved.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): { list: boolean; batchNumber: number | null; all: boolean } {
  const args = argv.slice(2);
  let list = false;
  let batchNumber: number | null = null;
  let all = false;
  for (const a of args) {
    if (a === '--list') list = true;
    else if (a === 'all') all = true;
    else if (a.startsWith('--batch=')) batchNumber = Number(a.slice('--batch='.length));
    else if (/^\d+$/.test(a)) batchNumber = Number(a);
    else if (a.startsWith('-')) usage();
    else usage();
  }
  return { list, batchNumber, all };
}

async function main(): Promise<void> {
  assertSalesforceAuthConfig();
  const { list, batchNumber, all } = parseArgs(process.argv);
  const exportConfig = loadExportConfig();
  const lookupKeys = loadLoanIdsFromFile(config.export.loanLookupKeysFile);
  if (!lookupKeys.length) {
    throw new Error(`No lookup keys in ${config.export.loanLookupKeysFile}`);
  }

  const batches = describeBatches(lookupKeys, exportConfig.batchSize);

  if (list) {
    console.log(
      `Lookup keys: ${lookupKeys.length} | Batch size: ${exportConfig.batchSize} | Batches: ${batches.length}`,
    );
    for (const b of batches) {
      console.log(`Batch ${b.batchNumber} (${b.batchLabel}): ${b.loanRefs.join(', ')}`);
    }
    return;
  }

  if (all) {
    let totalMissing = 0;
    for (const batch of batches) {
      console.log(`Loan lookup key export ${batch.batchLabel} (${batch.loanRefs.length} keys)`);
      const result = await exportLoanLookupKeyBatch(batch);
      console.log(`Rows: ${result.rowCount} | CSV: ${result.csvPath}`);
      if (result.missingCount) {
        console.log(`Missing CSV: ${result.missingCsvPath}`);
      }
      if (result.missing.length) {
        totalMissing += result.missing.length;
        console.warn(`Not found (${result.missing.length}): ${result.missing.join(', ')}`);
      }
    }
    if (totalMissing) {
      console.warn(`Total not found: ${totalMissing}`);
      console.warn(
        'Tip: lookup keys must match LLC_BI__lookupKey__c exactly in the connected org (check all digits on the loan record).',
      );
    }
    return;
  }

  if (batchNumber == null || !Number.isFinite(batchNumber) || batchNumber < 1) {
    usage();
  }

  const batch = getBatch(lookupKeys, exportConfig.batchSize, batchNumber);
  console.log(`Loan lookup key export ${batch.batchLabel} (${batch.loanRefs.length} keys)`);
  const result = await exportLoanLookupKeyBatch(batch);
  console.log(`Rows: ${result.rowCount}`);
  console.log(`CSV: ${result.csvPath}`);
  if (result.missingCount) {
    console.log(`Missing CSV: ${result.missingCsvPath} (${result.missingCount} unresolved)`);
  }
  if (result.missing.length) {
    console.warn(`Not found (${result.missing.length}): ${result.missing.join(', ')}`);
    console.warn(
      'Tip: lookup keys must match LLC_BI__lookupKey__c exactly in the connected org (check all digits on the loan record).',
    );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});