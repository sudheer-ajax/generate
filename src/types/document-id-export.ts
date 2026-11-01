export interface DocumentDownloadRef {
  /** Line number in input file (1-based, after comments). */
  lineIndex: number;
  documentId: string;
  /** Optional — resolved from nCino when omitted for loan documents. */
  loanIdOrName: string | null;
  contentVersionId: string | null;
}

export interface DocumentIdBatchInfo {
  batchNumber: number;
  batchLabel: string;
  items: DocumentDownloadRef[];
  startIndex: number;
  endIndex: number;
  totalItems: number;
  totalBatches: number;
}

export interface DocumentIdDownloadFileRecord {
  lineIndex: number;
  documentId: string;
  loanId: string | null;
  loanName: string | null;
  contentVersionId: string;
  fileName: string;
  localPath: string;
  s3Key: string | null;
  bytes: number;
}

export interface DocumentIdDownloadErrorRecord {
  lineIndex: number;
  documentId: string;
  loanIdOrName: string | null;
  message: string;
}

export interface DocumentIdBatchManifest {
  batchNumber: number;
  batchLabel: string;
  exportedAt: string;
  sourceFile: string;
  files: DocumentIdDownloadFileRecord[];
  errors: DocumentIdDownloadErrorRecord[];
  s3Enabled: boolean;
  s3Bucket: string | null;
}
