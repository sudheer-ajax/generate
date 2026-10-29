import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildS3Key, isS3ExportEnabled, uploadToS3 } from '../clients/s3-storage.js';
import { config } from '../config/env.js';
import type { ContentVersionSummary, DocumentSummary } from '../types/documents.js';
import type {
  BatchExportManifest,
  ExportConfig,
  ExportErrorRecord,
  ExportedFileRecord,
  LoanBatchInfo,
  SkippedDocumentRecord,
} from '../types/export.js';
import { allowedContentVersions, documentHasAllowedFile } from './export-file-filter.js';
import {
  computeSkippedForLoan,
  documentMatchesExportConfig,
  exportLabelForDocument,
} from './export-targets.js';
import {
  buildExportFileName,
  extensionFromContent,
  loanFolderName,
  partyRoleForDocument,
  relationshipIdForDocument,
} from './export-filename.js';
import {
  downloadLoanDocument,
  listAllDocumentsForLoan,
  resolveLoanRef,
} from './loan-documents.js';
import { batchLabel } from './loan-id-batches.js';

export interface ExportBatchOptions {
  batch: LoanBatchInfo;
  exportConfig: ExportConfig;
  dryRun?: boolean;
  skipS3?: boolean;
  localRootDir?: string;
}

export interface ExportBatchResult {
  manifest: BatchExportManifest;
  manifestPath: string;
}

function relativeFilePath(batch: LoanBatchInfo, loanFolder: string, exportFileName: string): string {
  return join(batch.batchLabel, loanFolder, exportFileName);
}

function allocateExportFileName(
  loanId: string,
  doc: DocumentSummary,
  cv: ContentVersionSummary,
  ext: string,
  exportLabel: string,
  usedInLoanFolder: Set<string>,
): string {
  let name = buildExportFileName(loanId, doc, cv, ext, exportLabel);
  if (!usedInLoanFolder.has(name)) {
    usedInLoanFolder.add(name);
    return name;
  }
  const suffix = cv.contentVersionId.slice(-6);
  name = buildExportFileName(loanId, doc, cv, ext, exportLabel, suffix);
  usedInLoanFolder.add(name);
  return name;
}

function recordExportedFile(
  fields: Omit<ExportedFileRecord, 'partyRole' | 'relationshipId' | 'exportFileName' | 'exportLabel'> & {
    doc: DocumentSummary;
    exportFileName: string;
    exportLabel: string;
  },
): ExportedFileRecord {
  return {
    loanRef: fields.loanRef,
    loanId: fields.loanId,
    loanName: fields.loanName,
    documentId: fields.documentId,
    documentName: fields.documentName,
    exportLabel: fields.exportLabel,
    level: fields.level,
    partyRole: partyRoleForDocument(fields.doc),
    relationshipId: relationshipIdForDocument(fields.doc),
    contentVersionId: fields.contentVersionId,
    exportFileName: fields.exportFileName,
    fileName: fields.fileName,
    localPath: fields.localPath,
    s3Key: fields.s3Key,
    bytes: fields.bytes,
  };
}

export async function exportDocumentBatch(options: ExportBatchOptions): Promise<ExportBatchResult> {
  const { batch, exportConfig, dryRun = false, skipS3 = false } = options;
  const localRoot = options.localRootDir ?? config.export.localDir;
  const batchDir = join(localRoot, batch.batchLabel);
  const s3Enabled = !skipS3 && isS3ExportEnabled();

  const files: ExportedFileRecord[] = [];
  const skipped: SkippedDocumentRecord[] = [];
  const errors: ExportErrorRecord[] = [];

  if (!dryRun) {
    mkdirSync(batchDir, { recursive: true });
  }

  for (const loanRef of batch.loanRefs) {
    let loanId = loanRef;
    let loanName = loanRef;
    try {
      const resolved = await resolveLoanRef(loanRef);
      loanId = resolved.id;
      loanName = resolved.name;
    } catch (err: unknown) {
      errors.push({
        loanRef,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const loanFolder = loanFolderName(loanName, loanId);
    const usedNames = new Set<string>();

    let documents: DocumentSummary[] = [];
    try {
      documents = await listAllDocumentsForLoan(loanRef);
    } catch (err: unknown) {
      errors.push({
        loanRef,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    skipped.push(...computeSkippedForLoan(loanRef, loanId, loanName, documents, exportConfig));

    const toExport = documents.filter(
      (d) => documentMatchesExportConfig(d, exportConfig) && documentHasAllowedFile(d, exportConfig),
    );

    if (!dryRun && toExport.length) {
      mkdirSync(join(localRoot, batch.batchLabel, loanFolder), { recursive: true });
    }

    for (const doc of toExport) {
      const exportLabel = exportLabelForDocument(doc, exportConfig);
      for (const cv of allowedContentVersions(doc, exportConfig)) {
        if (dryRun) {
          const ext = extensionFromContent(cv);
          const exportFileName = allocateExportFileName(
            loanId,
            doc,
            cv,
            ext,
            exportLabel,
            usedNames,
          );
          const rel = relativeFilePath(batch, loanFolder, exportFileName);
          const localPath = join(localRoot, rel);
          files.push(
            recordExportedFile({
              loanRef,
              loanId,
              loanName,
              documentId: doc.id,
              documentName: doc.name,
              level: doc.level,
              doc,
              exportLabel,
              contentVersionId: cv.contentVersionId,
              exportFileName,
              fileName: exportFileName,
              localPath,
              s3Key: s3Enabled ? buildS3Key(rel) : null,
              bytes: cv.contentSize ?? 0,
            }),
          );
          continue;
        }

        try {
          const downloaded = await downloadLoanDocument(
            loanRef,
            doc.id,
            cv.contentVersionId,
          );
          const ext = extensionFromContent(cv, downloaded.fileName);
          const exportFileName = allocateExportFileName(
            loanId,
            doc,
            cv,
            ext,
            exportLabel,
            usedNames,
          );
          const rel = relativeFilePath(batch, loanFolder, exportFileName);
          const localPath = join(localRoot, rel);
          writeFileSync(localPath, downloaded.buffer);

          let s3Key: string | null = null;
          if (s3Enabled) {
            s3Key = buildS3Key(rel);
            await uploadToS3(s3Key, downloaded.buffer, downloaded.contentType);
          }

          files.push(
            recordExportedFile({
              loanRef,
              loanId,
              loanName,
              documentId: doc.id,
              documentName: doc.name,
              level: doc.level,
              doc,
              exportLabel,
              contentVersionId: cv.contentVersionId,
              exportFileName,
              fileName: downloaded.fileName,
              localPath,
              s3Key,
              bytes: downloaded.buffer.length,
            }),
          );
        } catch (err: unknown) {
          errors.push({
            loanRef,
            documentId: doc.id,
            contentVersionId: cv.contentVersionId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  const manifest: BatchExportManifest = {
    batchNumber: batch.batchNumber,
    batchLabel: batch.batchLabel,
    exportedAt: new Date().toISOString(),
    loanRefs: batch.loanRefs,
    config: exportConfig,
    files,
    skipped,
    errors,
    s3Enabled,
    s3Bucket: s3Enabled ? config.export.s3Bucket : null,
  };

  const manifestPath = join(batchDir, 'manifest.json');
  if (!dryRun) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  return { manifest, manifestPath: dryRun ? '(dry-run)' : manifestPath };
}

export { batchLabel };
