import { resolve } from 'path';
import { assertSalesforceAuthConfig, config } from '../config/env.js';
import {
  defaultPortfolioCombinedCsvPath,
  defaultPortfolioCombinedMissingPath,
  exportPortfolioLoanBatch,
  exportPortfolioLoanCombined,
} from '../services/portfolio-loan-export.js';
import { loadExportConfig } from '../services/load-export-config.js';
import {
  describeBatches,
  getBatch,
  loadLoanIdsFromFile,
} from '../services/loan-id-batches.js';

function usage(): never {
  console.error(`
Usage:
  npm run portfolio:batch -- --list
  npm run portfolio:batch -- <batchNumber>
  npm run portfolio:batch -- all
  npm run portfolio:batch -- all --single
  npm run portfolio:batch -- all --single --out=output/portfolio/register.csv

Reads loan refs from ${config.export.loanIdsFile}.
Mambu JSONL: ${config.export.mambuLoanAccountsFile}

Per batch: output/portfolio/batch-NNN/portfolio-batch-NNN.csv
All + --single: one file (default ${defaultPortfolioCombinedCsvPath()})
`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  list: boolean;
  batchNumber: number | null;
  all: boolean;
  single: boolean;
  outPath: string | null;
} {
  const args = argv.slice(2);
  let list = false;
  let batchNumber: number | null = null;
  let all = false;
  let single = false;
  let outPath: string | null = null;
  for (const a of args) {
    if (a === '--list') list = true;
    else if (a === 'all') all = true;
    else if (a === '--single') single = true;
    else if (a.startsWith('--out=')) outPath = a.slice('--out='.length);
    else if (a.startsWith('--batch=')) batchNumber = Number(a.slice('--batch='.length));
    else if (/^\d+$/.test(a)) batchNumber = Number(a);
    else if (a.startsWith('-')) usage();
    else usage();
  }
  return { list, batchNumber, all, single, outPath };
}

function logPortfolioResult(
  result: Awaited<ReturnType<typeof exportPortfolioLoanBatch>>,
): void {
  console.log(`Rows: ${result.rowCount} | CSV: ${result.csvPath}`);
  if (result.missingMambuCount) {
    console.log(
      `No Mambu JSON match: ${result.missingMambuCount} | ${result.missingMambuCsvPath}`,
    );
  }
}

async function runBatch(batch: ReturnType<typeof getBatch>): Promise<void> {
  const result = await exportPortfolioLoanBatch(batch, config.export.mambuLoanAccountsFile);
  logPortfolioResult(result);
}

async function main(): Promise<void> {
  assertSalesforceAuthConfig();
  const { list, batchNumber, all, single, outPath } = parseArgs(process.argv);
  const exportConfig = loadExportConfig();
  const loanRefs = loadLoanIdsFromFile(config.export.loanIdsFile);
  if (!loanRefs.length) {
    throw new Error(`No loan refs in ${config.export.loanIdsFile}`);
  }

  const batches = describeBatches(loanRefs, exportConfig.batchSize);

  if (list) {
    console.log(
      `Portfolio export — loans: ${loanRefs.length} | batchSize: ${exportConfig.batchSize} | batches: ${batches.length}`,
    );
    for (const b of batches) {
      console.log(`Batch ${b.batchNumber} (${b.batchLabel}): ${b.loanRefs.join(', ')}`);
    }
    return;
  }

  if (all) {
    if (single) {
      const csvPath = resolve(outPath ?? defaultPortfolioCombinedCsvPath());
      const missingMambuCsvPath =
        outPath != null
          ? resolve(outPath.replace(/\.csv$/i, '-missing-mambu.csv'))
          : defaultPortfolioCombinedMissingPath();
      console.log(`Portfolio export (single file) — ${loanRefs.length} loans`);
      const result = await exportPortfolioLoanCombined(loanRefs, config.export.mambuLoanAccountsFile, {
        csvPath,
        missingMambuCsvPath,
      });
      logPortfolioResult(result);
      return;
    }
    for (const batch of batches) {
      console.log(`Portfolio export ${batch.batchLabel} (${batch.loanRefs.length} loans)`);
      await runBatch(batch);
    }
    return;
  }

  if (batchNumber == null || !Number.isFinite(batchNumber) || batchNumber < 1) {
    usage();
  }

  const batch = getBatch(loanRefs, exportConfig.batchSize, batchNumber);
  console.log(`Portfolio export ${batch.batchLabel} (${batch.loanRefs.length} loans)`);
  await runBatch(batch);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});