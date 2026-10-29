import { resolve } from 'path';
import { assertSalesforceAuthConfig, config } from '../config/env.js';
import {
  checkLoanExistence,
  defaultLoanExistenceCsvPath,
} from '../services/loan-existence-check.js';
import { loadLoanIdsFromFile } from '../services/loan-id-batches.js';

function usage(): never {
  console.error(`
Usage:
  npm run loans:existence
  npm run loans:existence -- --out=output/loan-existence/report.csv

Reads loan refs from ${config.export.loanIdsFile} (prod Ids or Names, one per line).
Connects using current .env (point at backup / sandbox org).
Writes CSV: index, inputRef, inputKind, existsInOrg, loanId, loanName
`);
  process.exit(1);
}

function parseOutArg(argv: string[]): string | null {
  for (const a of argv) {
    if (a.startsWith('--out=')) return a.slice('--out='.length);
    if (a === '--help' || a === '-h') usage();
  }
  return null;
}

async function main(): Promise<void> {
  assertSalesforceAuthConfig();
  const outArg = parseOutArg(process.argv.slice(2));
  const loanIdsFile = config.export.loanIdsFile;
  const loanRefs = loadLoanIdsFromFile(loanIdsFile);
  if (!loanRefs.length) {
    throw new Error(`No loan ids in ${loanIdsFile}`);
  }

  const csvPath = resolve(outArg ?? defaultLoanExistenceCsvPath());
  console.log(`Checking ${loanRefs.length} loan ref(s) against connected org…`);
  console.log(`Input: ${loanIdsFile}`);
  console.log(`Auth mode: ${config.salesforce.authMode}`);

  const result = await checkLoanExistence({
    loanRefs,
    csvPath,
    loanIdsFile,
  });

  const { summary } = result;
  console.log('');
  console.log(`Found in org:    ${summary.foundCount} / ${summary.totalInput}`);
  console.log(`Missing in org:  ${summary.missingCount} / ${summary.totalInput}`);
  console.log(`CSV: ${result.csvPath}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
