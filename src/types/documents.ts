export type DocumentLevel = 'loan' | 'borrower';

export interface LoanDocumentSummary {
  level: 'loan';
  /** LLC_BI__LLC_LoanDocument__c Id */
  id: string;
  /** LLC_BI__LLC_LoanDocument__c.Name (placeholder title), not NDOC__fileName__c */
  name: string;
  loanId: string;
  fileName: string | null;
  /** nCino placeholder version (LLC_BI__version__c) */
  version: number | null;
  hasFile: boolean;
  documentStoreId: string | null;
  contentVersions: ContentVersionSummary[];
}

export interface BorrowerDocumentSummary {
  level: 'borrower';
  /** LLC_BI__AccountDocument__c Id */
  id: string;
  /** LLC_BI__AccountDocument__c.Name (placeholder title), not NDOC__fileName__c */
  name: string;
  loanId: string;
  accountId: string;
  /** LLC_BI__Legal_Entities__c Id for this account on the loan (relationship). */
  legalEntityId: string | null;
  accountName: string | null;
  borrowerType: string | null;
  fileName: string | null;
  version: number | null;
  hasFile: boolean;
  documentStoreId: string | null;
  contentVersions: ContentVersionSummary[];
}

export type DocumentSummary = LoanDocumentSummary | BorrowerDocumentSummary;

export interface ContentVersionSummary {
  contentVersionId: string;
  contentDocumentId: string;
  title: string;
  fileExtension: string | null;
  contentSize: number | null;
  /** Salesforce ContentVersion.VersionNumber */
  versionNumber: number | null;
}

export interface DocumentDownloadResult {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  contentVersionId: string;
}
