import { resolve } from 'path';
import { assertSalesforceAuthConfig, config } from '../config/env.js';
import { exportLoansByAccountIds } from '../services/loan-lookup-key-export.js';
import { loadLoanIdsFromFile } from '../services/loan-id-batches.js';

function usage(): never {
  console.error(`
Usage:
  npm run loans:lookup-key
  npm run loans:lookup-key -- --out=output/loan-lookup-key/my.csv

Reads ${config.export.loanLookupKeysFile} (one Account_ID__c per line).
Writes a single CSV: output/loan-lookup-key/loans-by-account-id.csv
Columns: accountIdInput, accountId, loanId, loanName
`);
  process.exit(1);
}

function parseOutArg(argv: string[]): string | null {
  for (const a of argv.slice(2)) {
    if (a.startsWith('--out=')) return a.slice('--out='.length);
    if (a === '--help' || a === '-h') usage();
    if (a.startsWith('-')) usage();
  }
  return null;
}

async function main(): Promise<void> {
  assertSalesforceAuthConfig();
  const outArg = parseOutArg(process.argv);
  const accountIds = loadLoanIdsFromFile(config.export.loanLookupKeysFile);
  if (!accountIds.length) {
    throw new Error(`No account ids in ${config.export.loanLookupKeysFile}`);
  }

  const csvPath = outArg ? resolve(outArg) : undefined;
  console.log(`Resolving ${accountIds.length} Account_ID__c value(s)…`);
  const result = await exportLoansByAccountIds(accountIds, csvPath);
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