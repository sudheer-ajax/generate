import type { ContentVersionSummary, DocumentSummary } from '../types/documents.js';

/** Safe token for file/folder names: spaces → underscores, strip illegal chars. */
export function sanitizeFileToken(value: string): string {
  return (
    value
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .trim() || 'unknown'
  );
}

export function loanFolderName(loanName: string, loanId: string): string {
  return `${sanitizeFileToken(loanName)}_${loanId}`;
}

/** loan | borrower | guarantor | director (from nCino legal entity role). */
export function partyRoleForDocument(doc: DocumentSummary): string {
  if (doc.level === 'loan') return 'loan';
  const raw = (doc.borrowerType ?? 'borrower').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('guarantor')) return 'guarantor';
  if (lower.includes('borrower')) return 'borrower';
  if (lower.includes('director')) return 'director';
  return sanitizeFileToken(raw.toLowerCase());
}

/** LLC_BI__Legal_Entities__c Id for borrower/guarantor docs; falls back to Account Id. */
export function relationshipIdForDocument(doc: DocumentSummary): string | null {
  if (doc.level === 'loan') return null;
  return doc.legalEntityId ?? doc.accountId;
}

export function extensionFromContent(
  cv: ContentVersionSummary,
  downloadedFileName?: string,
): string {
  if (cv.fileExtension) {
    return cv.fileExtension.toLowerCase().replace(/^\./, '');
  }
  if (downloadedFileName) {
    const match = downloadedFileName.match(/\.([^.]+)$/);
    if (match) return match[1]!.toLowerCase();
  }
  return 'bin';
}

export function versionToken(doc: DocumentSummary, cv: ContentVersionSummary): string {
  if (doc.version != null && Number.isFinite(doc.version)) {
    return `v${doc.version}`;
  }
  if (cv.versionNumber != null && Number.isFinite(cv.versionNumber)) {
    return `v${cv.versionNumber}`;
  }
  return 'v1';
}

/**
 * Loan:  {loanId}_loan_doc_{docId}_{docName}_{version}.{ext}
 * Party: {loanId}_{party}_{relationshipId}_doc_{docId}_{docName}_{version}.{ext}
 */
export function buildExportFileName(
  loanId: string,
  doc: DocumentSummary,
  cv: ContentVersionSummary,
  ext: string,
  exportLabel: string,
  uniquenessSuffix?: string,
): string {
  const party = partyRoleForDocument(doc);
  const docId = doc.id;
  const docName = sanitizeFileToken(exportLabel);
  const version = versionToken(doc, cv);
  const suffix = uniquenessSuffix ? `_${uniquenessSuffix}` : '';
  const relationshipId = relationshipIdForDocument(doc);

  if (doc.level === 'loan' || !relationshipId) {
    return `${loanId}_loan_doc_${docId}_${docName}_${version}${suffix}.${ext}`;
  }

  return `${loanId}_${party}_${relationshipId}_doc_${docId}_${docName}_${version}${suffix}.${ext}`;
}
