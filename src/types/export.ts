import type { DocumentLevel } from './documents.js';

export interface ExportTarget {
  /** Token used in exported file names (e.g. CIF, SALIE). */
  label: string;
  /** Exact LLC_BI__*Document__c.Name values (case-insensitive). Not NDOC__fileName__c. */
  matchNames?: string[];
  /** Regex patterns against document record Name only. */
  matchPatterns?: string[];
}

export interface CollateralExportFilter {
  /** When true, only rows whose collateral type name includes collateralTypeIncludes (default Residential). */
  residentialOnly: boolean;
  /** Substring match on LLC_BI__Collateral_Type__r.Name (case-insensitive). */
  collateralTypeIncludes: string;
  /** When true, exclude collaterals with no usable address on LLC_BI__Collateral__c. */
  requireAddress: boolean;
}

export interface ExportConfig {
  batchSize: number;
  exportTargets: ExportTarget[];
  collateralExport?: Partial<CollateralExportFilter>;
  /** e.g. ["pdf"] — only download these ContentVersion extensions. Empty = all types. */
  allowedFileExtensions: string[];
  /** @deprecated use exportTargets */
  includeDocumentNames?: string[];
  /** @deprecated use exportTargets */
  includeNamePatterns?: string[];
  excludeNamePatterns: string[];
}

export interface LoanBatchInfo {
  batchNumber: number;
  batchLabel: string;
  loanRefs: string[];
  startIndex: number;
  endIndex: number;
  totalLoans: number;
  totalBatches: number;
}

export interface ExportedFileRecord {
  loanRef: string;
  loanId: string;
  loanName: string;
  documentId: string;
  documentName: string;
  exportLabel: string;
  level: DocumentLevel;
  partyRole: string;
  /** LLC_BI__Legal_Entities__c Id when borrower/guarantor document */
  relationshipId: string | null;
  contentVersionId: string;
  exportFileName: string;
  fileName: string;
  localPath: string;
  s3Key: string | null;
  bytes: number;
}

export interface SkippedDocumentRecord {
  loanRef: string;
  loanId: string;
  loanName: string;
  exportLabel: string;
  reason: 'no_placeholder' | 'no_file' | 'no_allowed_file_type';
  placeholderName?: string;
  documentId?: string;
}

export interface ExportErrorRecord {
  loanRef: string;
  documentId?: string;
  contentVersionId?: string;
  message: string;
}

export interface BatchExportManifest {
  batchNumber: number;
  batchLabel: string;
  exportedAt: string;
  loanRefs: string[];
  config: ExportConfig;
  files: ExportedFileRecord[];
  skipped: SkippedDocumentRecord[];
  errors: ExportErrorRecord[];
  s3Enabled: boolean;
  s3Bucket: string | null;
}
