import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildS3Key, isS3ExportEnabled, uploadToS3 } from '../clients/s3-storage.js';
import { config } from '../config/env.js';
import type {
  DocumentDownloadRef,
  DocumentIdBatchInfo,
  DocumentIdBatchManifest,
  DocumentIdDownloadErrorRecord,
  DocumentIdDownloadFileRecord,
} from '../types/document-id-export.js';
import {
  downloadDocumentRef,
  resolveDocumentDownloadContext,
  resolveLoanRef,
} from './loan-documents.js';
import { sanitizeFileToken } from './export-filename.js';

export interface DocumentIdBatchExportOptions {
  batch: DocumentIdBatchInfo;
  sourceFile: string;
  dryRun?: boolean;
  skipS3?: boolean;
  localRootDir?: string;
}

export interface DocumentIdBatchExportResult {
  manifest: DocumentIdBatchManifest;
  manifestPath: string;
}

function exportFileName(documentId: string, downloadedName: string): string {
  const base = sanitizeFileToken(downloadedName);
  return `${documentId}_${base}`;
}

export async function exportDocumentIdBatch(
  options: DocumentIdBatchExportOptions,
): Promise<DocumentIdBatchExportResult> {
  const { batch, sourceFile, dryRun = false, skipS3 = false } = options;
  const localRoot = options.localRootDir ?? join(config.export.localDir, '..', 'document-downloads');
  const batchDir = join(localRoot, batch.batchLabel);
  const s3Enabled = !skipS3 && isS3ExportEnabled();

  if (!dryRun) {
    mkdirSync(batchDir, { recursive: true });
  }

  const files: DocumentIdDownloadFileRecord[] = [];
  const errors: DocumentIdDownloadErrorRecord[] = [];
  const loanNameCache = new Map<string, string | null>();

  async function loanNameFor(loanIdOrName: string): Promise<string | null> {
    if (!loanIdOrName) return null;
    if (loanNameCache.has(loanIdOrName)) return loanNameCache.get(loanIdOrName) ?? null;
    try {
      const { id, name } = await resolveLoanRef(loanIdOrName);
      loanNameCache.set(loanIdOrName, name);
      loanNameCache.set(id, name);
      return name;
    } catch {
      loanNameCache.set(loanIdOrName, null);
      return null;
    }
  }

  for (const item of batch.items) {
    try {
      const resolved = item.documentId.startsWith('068')
        ? { loanIdOrName: item.loanIdOrName ?? '', documentId: item.documentId }
        : await resolveDocumentDownloadContext(item.documentId, item.loanIdOrName);

      const cvId = item.contentVersionId ?? undefined;
      if (dryRun) {
        console.log(
          `  [dry-run] line ${item.lineIndex}: ${item.documentId}` +
            (resolved.loanIdOrName ? ` (loan ${resolved.loanIdOrName})` : '') +
            (cvId ? ` cv=${cvId}` : ''),
        );
        continue;
      }

      const result = await downloadDocumentRef(
        item.documentId,
        item.loanIdOrName,
        item.contentVersionId,
      );
      const name = exportFileName(item.documentId, result.fileName);
      const localPath = join(batchDir, name);
      writeFileSync(localPath, result.buffer);

      let s3Key: string | null = null;
      if (s3Enabled) {
        s3Key = buildS3Key(`${batch.batchLabel}/${name}`);
        await uploadToS3(s3Key, result.buffer, result.contentType);
      }

      const loanId =
        resolved.loanIdOrName && /^[a-zA-Z0-9]{15,18}$/.test(resolved.loanIdOrName)
          ? resolved.loanIdOrName
          : null;
      const loanName = resolved.loanIdOrName ? await loanNameFor(resolved.loanIdOrName) : null;

      files.push({
        lineIndex: item.lineIndex,
        documentId: item.documentId,
        loanId,
        loanName,
        contentVersionId: result.contentVersionId,
        fileName: result.fileName,
        localPath,
        s3Key,
        bytes: result.buffer.length,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({
        lineIndex: item.lineIndex,
        documentId: item.documentId,
        loanIdOrName: item.loanIdOrName,
        message,
      });
    }
  }

  const manifest: DocumentIdBatchManifest = {
    batchNumber: batch.batchNumber,
    batchLabel: batch.batchLabel,
    exportedAt: new Date().toISOString(),
    sourceFile,
    files,
    errors,
    s3Enabled,
    s3Bucket: s3Enabled ? config.export.s3Bucket : null,
  };

  const manifestPath = join(batchDir, `manifest-${batch.batchLabel}.json`);
  if (!dryRun) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  return { manifest, manifestPath };
}
