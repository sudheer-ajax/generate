import { assertSalesforceAuthConfig, config } from '../config/env.js';
import { isS3ExportEnabled } from '../clients/s3-storage.js';
import { exportDocumentIdBatch } from '../services/document-id-batch-export.js';
import { loadExportConfig } from '../services/load-export-config.js';
import {
  describeDocumentIdBatches,
  getDocumentIdBatch,
  loadDocumentDownloadRefsFromFile,
} from '../services/document-id-list.js';

const documentIdsFile =
  process.env.EXPORT_DOCUMENT_IDS_FILE?.trim() || 'data/document-ids.txt';

function usage(): never {
  console.error(`
Usage:
  npm run docs:batch-ids -- --list
  npm run docs:batch-ids -- <batchNumber>
  npm run docs:batch-ids -- --batch=2 [--dry-run] [--local-only]

Input file (one entry per line): ${documentIdsFile}
  documentId
  loanId,documentId
  loanId,documentId,contentVersionId
  contentVersionId,documentId   (optional column order for explicit CV)

Lines starting with # are ignored. Batch size from data/export.config.json (batchSize).

Output: output/document-downloads/batch-NNN/
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
  const items = loadDocumentDownloadRefsFromFile(documentIdsFile);
  if (!items.length) {
    throw new Error(`No document ids in ${documentIdsFile}`);
  }

  const batches = describeDocumentIdBatches(items, exportConfig.batchSize);

  if (list) {
    console.log(
      `Documents: ${items.length} | Batch size: ${exportConfig.batchSize} | Batches: ${batches.length}`,
    );
    console.log(`File: ${documentIdsFile}\n`);
    for (const b of batches) {
      console.log(`Batch ${b.batchNumber} (${b.batchLabel}): lines ${b.startIndex + 1}-${b.endIndex + 1}`);
      for (const item of b.items) {
        const loan = item.loanIdOrName ? `${item.loanIdOrName},` : '';
        const cv = item.contentVersionId ? `,${item.contentVersionId}` : '';
        console.log(`  line ${item.lineIndex}: ${loan}${item.documentId}${cv}`);
      }
      console.log('');
    }
    return;
  }

  if (batchNumber == null || !Number.isFinite(batchNumber) || batchNumber < 1) {
    usage();
  }

  const batch = getDocumentIdBatch(items, exportConfig.batchSize, batchNumber);
  console.log(
    `Document download ${batch.batchLabel} (${batch.items.length} items)${dryRun ? ' [dry-run]' : ''}`,
  );
  if (!localOnly && isS3ExportEnabled()) {
    console.log(`S3: s3://${config.export.s3Bucket}/${config.export.s3Prefix}/`);
  }

  const { manifest, manifestPath } = await exportDocumentIdBatch({
    batch,
    sourceFile: documentIdsFile,
    dryRun,
    skipS3: localOnly,
  });

  console.log(`Downloaded: ${manifest.files.length} | Errors: ${manifest.errors.length}`);
  if (!dryRun) console.log(`Manifest: ${manifestPath}`);
  if (manifest.errors.length) {
    console.error('\nErrors:');
    for (const e of manifest.errors) {
      console.error(`  line ${e.lineIndex} ${e.documentId}: ${e.message}`);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
