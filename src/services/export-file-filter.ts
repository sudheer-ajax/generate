import type { ContentVersionSummary, DocumentSummary } from '../types/documents.js';
import type { ExportConfig } from '../types/export.js';

export function contentVersionExtension(cv: ContentVersionSummary): string {
  const ext = cv.fileExtension?.toLowerCase().replace(/^\./, '') ?? '';
  if (ext) return ext;
  const fromTitle = cv.title.match(/\.([^.]+)$/);
  return fromTitle ? fromTitle[1]!.toLowerCase() : '';
}

export function allowedExtensions(cfg: ExportConfig): string[] {
  return (cfg.allowedFileExtensions ?? []).map((e) => e.toLowerCase().replace(/^\./, ''));
}

export function isContentVersionAllowed(
  cv: ContentVersionSummary,
  cfg: ExportConfig,
): boolean {
  const allowed = allowedExtensions(cfg);
  if (!allowed.length) return true;
  const ext = contentVersionExtension(cv);
  return ext !== '' && allowed.includes(ext);
}

export function allowedContentVersions(
  doc: DocumentSummary,
  cfg: ExportConfig,
): ContentVersionSummary[] {
  return doc.contentVersions.filter((cv) => isContentVersionAllowed(cv, cfg));
}

export function documentHasAllowedFile(doc: DocumentSummary, cfg: ExportConfig): boolean {
  return allowedContentVersions(doc, cfg).length > 0;
}
