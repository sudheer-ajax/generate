import { assertSalesforceAuthConfig, config } from '../config/env.js';
import { isS3ExportEnabled } from '../clients/s3-storage.js';
import { exportDocumentBatch } from '../services/document-batch-export.js';
import { loadExportConfig } from '../services/load-export-config.js';
import {
  describeBatches,
  getBatch,
  loadLoanIdsFromFile,
} from '../services/loan-id-batches.js';

function usage(): never {
  console.error(`
Usage:
  npm run docs:batch -- --list
  npm run docs:batch -- <batchNumber>
  npm run docs:batch -- --batch=2 [--dry-run] [--local-only]

Options:
  --list         Show batches (20 loans per batch by default, from data/export.config.json)
  --dry-run      List files that would be downloaded without saving
  --local-only   Skip S3 upload even if AWS_S3_BUCKET is set

Loan list file: ${config.export.loanIdsFile}
`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  list: boolean;
  batchNumber: number | null;
  dryRun: boolean;
  localOnly: boolean;
} {
  const args = argv.slice(2);
  let list = false;
  let batchNumber: number | null = null;
  let dryRun = false;
  let localOnly = false;

  for (const a of args) {
    if (a === '--list') list = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--local-only') localOnly = true;
    else if (a.startsWith('--batch=')) batchNumber = Number(a.slice('--batch='.length));
    else if (/^\d+$/.test(a)) batchNumber = Number(a);
    else if (a.startsWith('-')) usage();
    else usage();
  }

  return { list, batchNumber, dryRun, localOnly };
}

async function main(): Promise<void> {
  assertSalesforceAuthConfig();
  const { list, batchNumber, dryRun, localOnly } = parseArgs(process.argv);

  const exportConfig = loadExportConfig();
  const loanRefs = loadLoanIdsFromFile(config.export.loanIdsFile);

  if (!loanRefs.length) {
    throw new Error(`No loan ids in ${config.export.loanIdsFile}`);
  }

  const batches = describeBatches(loanRefs, exportConfig.batchSize);

  if (list) {
    console.log(`Loans: ${loanRefs.length} | Batch size: ${exportConfig.batchSize} | Batches: ${batches.length}`);
    console.log(`File: ${config.export.loanIdsFile}\n`);
    for (const b of batches) {
      console.log(`Batch ${b.batchNumber} (${b.batchLabel}): loans ${b.startIndex + 1}-${b.endIndex + 1}`);
      for (const ref of b.loanRefs) {
        console.log(`  - ${ref}`);
      }
      console.log('');
    }
    return;
  }

  if (batchNumber == null || !Number.isFinite(batchNumber) || batchNumber < 1) {
    usage();
  }

  const batch = getBatch(loanRefs, exportConfig.batchSize, batchNumber);
  console.log(
    `Export ${batch.batchLabel} (${batch.loanRefs.length} loans) → ${config.export.localDir}${dryRun ? ' [dry-run]' : ''}`,
  );
  if (!localOnly && isS3ExportEnabled()) {
    console.log(`S3: s3://${config.export.s3Bucket}/${config.export.s3Prefix}/`);
  } else if (!localOnly && !dryRun) {
    console.log('S3: disabled (set AWS_S3_BUCKET to enable)');
  }

  const { manifest, manifestPath } = await exportDocumentBatch({
    batch,
    exportConfig,
    dryRun,
    skipS3: localOnly,
  });

  console.log(`Files downloaded: ${manifest.files.length} | Errors: ${manifest.errors.length}`);
  if (manifest.skipped.length) {
    console.log('\nNot downloaded (see manifest skipped):');
    for (const s of manifest.skipped) {
      if (s.reason === 'no_placeholder') {
        console.log(`  ${s.loanName}: ${s.exportLabel} — no matching placeholder on loan`);
      } else if (s.reason === 'no_allowed_file_type') {
        console.log(
          `  ${s.loanName}: ${s.exportLabel} — file exists but not an allowed type (see allowedFileExtensions)`,
        );
      } else {
        console.log(
          `  ${s.loanName}: ${s.exportLabel} — placeholder "${s.placeholderName}" has no file in nCino`,
        );
      }
    }
  }
  if (!dryRun) console.log(`Manifest: ${manifestPath}`);
  if (manifest.errors.length) {
    console.error('\nErrors:');
    for (const e of manifest.errors) {
      console.error(`  ${e.loanRef}: ${e.message}`);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
