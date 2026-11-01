import type { DocumentSummary } from '../types/documents.js';
import type { ExportConfig, ExportTarget, SkippedDocumentRecord } from '../types/export.js';
import { documentHasAllowedFile } from './export-file-filter.js';

/** All export name / pattern matching is case-insensitive. */
function normalizeDocumentName(name: string): string {
  return name.trim();
}

function patternMatches(docName: string, pattern: string): boolean {
  const haystack = normalizeDocumentName(docName);
  const needle = pattern.trim();
  if (!needle) return false;
  try {
    return new RegExp(needle, 'i').test(haystack);
  } catch {
    return haystack.toLowerCase().includes(needle.toLowerCase());
  }
}

function exactNameMatches(docName: string, configuredName: string): boolean {
  return (
    normalizeDocumentName(docName).toLowerCase() ===
    configuredName.trim().toLowerCase()
  );
}

/** nCino document record Name (LLC_BI__LLC_LoanDocument__c.Name / AccountDocument Name). */
export function documentRecordName(doc: DocumentSummary): string {
  return doc.name.trim();
}

export function resolveExportTargets(cfg: ExportConfig): ExportTarget[] {
  if (cfg.exportTargets?.length) return cfg.exportTargets;
  const legacy = cfg.includeDocumentNames ?? [];
  return legacy.map((label) => ({ label, matchNames: [label] }));
}

export function matchExportTarget(
  documentName: string,
  cfg: ExportConfig,
): ExportTarget | null {
  const name = normalizeDocumentName(documentName);
  for (const ex of cfg.excludeNamePatterns) {
    if (patternMatches(name, ex)) return null;
  }

  for (const target of resolveExportTargets(cfg)) {
    const names = target.matchNames ?? [];
    if (names.some((n) => exactNameMatches(name, n))) {
      return target;
    }
    for (const p of target.matchPatterns ?? []) {
      if (patternMatches(name, p)) return target;
    }
  }
  return null;
}

export function documentMatchesExportConfig(doc: DocumentSummary, cfg: ExportConfig): boolean {
  return matchExportTarget(documentRecordName(doc), cfg) != null;
}

export function exportLabelForDocument(doc: DocumentSummary, cfg: ExportConfig): string {
  const target = matchExportTarget(documentRecordName(doc), cfg);
  return target?.label ?? sanitizeExportLabel(documentRecordName(doc));
}

function sanitizeExportLabel(name: string): string {
  return name.replace(/\s+/g, '_');
}

/** Per loan: which configured labels have no matching placeholder or no file. */
export function computeSkippedForLoan(
  loanRef: string,
  loanId: string,
  loanName: string,
  documents: DocumentSummary[],
  cfg: ExportConfig,
): SkippedDocumentRecord[] {
  const skipped: SkippedDocumentRecord[] = [];
  const targets = resolveExportTargets(cfg);

  for (const target of targets) {
    const matching = documents.filter(
      (d) => matchExportTarget(documentRecordName(d), cfg)?.label === target.label,
    );
    if (!matching.length) {
      skipped.push({
        loanRef,
        loanId,
        loanName,
        exportLabel: target.label,
        reason: 'no_placeholder',
      });
      continue;
    }
    const withAnyFile = matching.filter((d) => d.contentVersions.length > 0);
    if (!withAnyFile.length) {
      const first = matching[0]!;
      skipped.push({
        loanRef,
        loanId,
        loanName,
        exportLabel: target.label,
        reason: 'no_file',
        placeholderName: matching.map((d) => documentRecordName(d)).join('; '),
        documentId: first.id,
      });
      continue;
    }
    const withAllowedFile = matching.filter((d) => documentHasAllowedFile(d, cfg));
    if (!withAllowedFile.length) {
      const first = withAnyFile[0]!;
      skipped.push({
        loanRef,
        loanId,
        loanName,
        exportLabel: target.label,
        reason: 'no_allowed_file_type',
        placeholderName: matching.map((d) => documentRecordName(d)).join('; '),
        documentId: first.id,
      });
    }
  }
  return skipped;
}
