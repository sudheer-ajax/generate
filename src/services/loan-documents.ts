import { config } from '../config/env.js';
import { connectNcino, getConnection, query } from '../clients/ncino.js';
import type {
  BorrowerDocumentSummary,
  ContentVersionSummary,
  DocumentDownloadResult,
  DocumentSummary,
  LoanDocumentSummary,
} from '../types/documents.js';

interface LoanDocumentRow {
  Id: string;
  Name: string;
  LLC_BI__Loan__c: string;
  LLC_BI__Has_File__c?: boolean;
  NDOC__fileName__c?: string;
  LLC_BI__Document_Store_Index__c?: string;
  LLC_BI__version__c?: number;
  [key: string]: unknown;
}

interface DocumentStoreIndexRow {
  Id: string;
  LLC_BI__Document_Store__c?: string;
  [key: string]: unknown;
}

interface ContentVersionRow {
  Id: string;
  Title: string;
  FileExtension?: string;
  ContentSize?: number;
  ContentDocumentId: string;
  VersionNumber?: number | string;
  [key: string]: unknown;
}

const LOAN_OBJECT = 'LLC_BI__Loan__c';
const LOAN_DOCUMENT_OBJECT = 'LLC_BI__LLC_LoanDocument__c';
const ACCOUNT_DOCUMENT_OBJECT = 'LLC_BI__AccountDocument__c';

interface AccountDocumentRow {
  Id: string;
  Name: string;
  LLC_BI__Account__c: string;
  LLC_BI__Has_File__c?: boolean;
  NDOC__fileName__c?: string;
  LLC_BI__Document_Store_Index__c?: string;
  LLC_BI__version__c?: number;
  [key: string]: unknown;
}

interface LegalEntityRow {
  Id: string;
  LLC_BI__Loan__c: string;
  LLC_BI__Account__c?: string;
  LLC_BI__Borrower_Type__c?: string;
  [key: string]: unknown;
}

function contentTypeForExtension(ext: string | null | undefined): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    txt: 'text/plain',
  };
  if (!ext) return 'application/octet-stream';
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'document';
}

function parseNcinoVersion(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseContentVersionNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Resolve Salesforce Loan Id from LLC_BI__Loan__c Id or Name. */
export async function resolveLoanId(loanIdOrName: string): Promise<string> {
  if (/^[a-zA-Z0-9]{15,18}$/.test(loanIdOrName)) {
    const byId = await query<{ Id: string; [key: string]: unknown }>(
      `SELECT Id FROM ${LOAN_OBJECT} WHERE Id = '${loanIdOrName}' LIMIT 1`,
    );
    if (byId[0]?.Id) return byId[0].Id;
  }
  const escaped = loanIdOrName.replace(/'/g, "\\'");
  const byName = await query<{ Id: string; [key: string]: unknown }>(
    `SELECT Id FROM ${LOAN_OBJECT} WHERE Name = '${escaped}' LIMIT 1`,
  );
  if (!byName[0]?.Id) {
    throw new Error(`Loan not found: ${loanIdOrName}`);
  }
  return byName[0].Id;
}

export interface LoanRef {
  id: string;
  name: string;
}

/** Resolve loan Id and nCino loan Name (reference). */
export async function resolveLoanRef(loanIdOrName: string): Promise<LoanRef> {
  await connectNcino();
  const id = await resolveLoanId(loanIdOrName);
  const rows = await query<{ Name: string; [key: string]: unknown }>(
    `SELECT Name FROM ${LOAN_OBJECT} WHERE Id = '${id}' LIMIT 1`,
  );
  return { id, name: rows[0]?.Name ?? id };
}

async function getDocumentStoreIdFromIndexId(indexId: string): Promise<string | null> {
  const indexes = await query<DocumentStoreIndexRow>(
    `SELECT Id, LLC_BI__Document_Store__c
     FROM LLC_BI__Document_Store_Index__c
     WHERE Id = '${indexId}' LIMIT 1`,
  );
  return indexes[0]?.LLC_BI__Document_Store__c ?? null;
}

async function getDocumentStoreIdForLoanDocument(
  loanDocumentId: string,
): Promise<string | null> {
  const docs = await query<LoanDocumentRow>(
    `SELECT Id, LLC_BI__Document_Store_Index__c
     FROM ${LOAN_DOCUMENT_OBJECT}
     WHERE Id = '${loanDocumentId}' LIMIT 1`,
  );
  const indexId = docs[0]?.LLC_BI__Document_Store_Index__c;
  if (!indexId) return null;
  return getDocumentStoreIdFromIndexId(indexId);
}

async function getDocumentStoreIdForAccountDocument(
  accountDocumentId: string,
): Promise<string | null> {
  const docs = await query<AccountDocumentRow>(
    `SELECT Id, LLC_BI__Document_Store_Index__c
     FROM ${ACCOUNT_DOCUMENT_OBJECT}
     WHERE Id = '${accountDocumentId}' LIMIT 1`,
  );
  const indexId = docs[0]?.LLC_BI__Document_Store_Index__c;
  if (!indexId) return null;
  return getDocumentStoreIdFromIndexId(indexId);
}

async function borrowerAccountIdsForLoan(loanId: string): Promise<string[]> {
  const entities = await query<LegalEntityRow>(
    `SELECT Id, LLC_BI__Account__c
     FROM LLC_BI__Legal_Entities__c
     WHERE LLC_BI__Loan__c = '${loanId}' AND LLC_BI__Account__c != null`,
  );
  return [...new Set(entities.map((e) => e.LLC_BI__Account__c!).filter(Boolean))];
}

async function summarizeStoredDocument(
  row: {
    Id: string;
    Name: string;
    LLC_BI__Has_File__c?: boolean;
    NDOC__fileName__c?: string;
    LLC_BI__Document_Store_Index__c?: string;
    LLC_BI__version__c?: number;
  },
  getStoreId: (id: string) => Promise<string | null>,
): Promise<{
  fileName: string | null;
  version: number | null;
  hasFile: boolean;
  documentStoreId: string | null;
  contentVersions: ContentVersionSummary[];
}> {
  let contentVersions: ContentVersionSummary[] = [];
  let documentStoreId: string | null = null;
  if (row.LLC_BI__Has_File__c && row.LLC_BI__Document_Store_Index__c) {
    documentStoreId = await getStoreId(row.Id);
    if (documentStoreId) {
      contentVersions = await listContentVersionsForDocumentStore(documentStoreId);
    }
  }
  return {
    fileName: row.NDOC__fileName__c ?? null,
    version: parseNcinoVersion(row.LLC_BI__version__c),
    hasFile: Boolean(row.LLC_BI__Has_File__c),
    documentStoreId,
    contentVersions,
  };
}

async function listContentVersionsForDocumentStore(
  documentStoreId: string,
): Promise<ContentVersionSummary[]> {
  const links = await query<{ ContentDocumentId: string; [key: string]: unknown }>(
    `SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '${documentStoreId}'`,
  );
  const versions: ContentVersionSummary[] = [];
  for (const link of links) {
    const cvRows = await query<ContentVersionRow>(
      `SELECT Id, Title, FileExtension, ContentSize, ContentDocumentId, VersionNumber
       FROM ContentVersion
       WHERE ContentDocumentId = '${link.ContentDocumentId}' AND IsLatest = true`,
    );
    const cv = cvRows[0];
    if (!cv) continue;
    versions.push({
      contentVersionId: cv.Id,
      contentDocumentId: cv.ContentDocumentId,
      title: cv.Title,
      fileExtension: cv.FileExtension ?? null,
      contentSize: cv.ContentSize ?? null,
      versionNumber: parseContentVersionNumber(cv.VersionNumber),
    });
  }
  return versions;
}

function pickContentVersion(
  versions: ContentVersionSummary[],
  preferredFileName: string | null,
): ContentVersionSummary | null {
  if (!versions.length) return null;
  if (!preferredFileName) return versions[0] ?? null;

  const norm = preferredFileName.toLowerCase().replace(/\.[^.]+$/, '');
  const exact = versions.find(
    (v) =>
      v.title.toLowerCase() === preferredFileName.toLowerCase() ||
      `${v.title}.${v.fileExtension ?? ''}`.toLowerCase() === preferredFileName.toLowerCase(),
  );
  if (exact) return exact;

  const partial = versions.find(
    (v) =>
      v.title.toLowerCase().includes(norm) || norm.includes(v.title.toLowerCase().replace(/\s/g, '_')),
  );
  return partial ?? versions[0] ?? null;
}

/** List nCino loan documents and linked Salesforce files for a loan. */
export async function listLoanDocuments(loanIdOrName: string): Promise<LoanDocumentSummary[]> {
  await connectNcino();
  const loanId = await resolveLoanId(loanIdOrName);

  const rows = await query<LoanDocumentRow>(
    `SELECT Id, Name, LLC_BI__Loan__c, LLC_BI__Has_File__c, NDOC__fileName__c, LLC_BI__Document_Store_Index__c, LLC_BI__version__c
     FROM ${LOAN_DOCUMENT_OBJECT}
     WHERE LLC_BI__Loan__c = '${loanId}'
     ORDER BY Name`,
  );

  const summaries: LoanDocumentSummary[] = [];
  for (const row of rows) {
    const stored = await summarizeStoredDocument(row, getDocumentStoreIdForLoanDocument);
    summaries.push({
      level: 'loan',
      id: row.Id,
      name: row.Name,
      loanId: row.LLC_BI__Loan__c,
      ...stored,
    });
  }
  return summaries;
}

/** nCino account (borrower) documents for all parties on the loan. */
export async function listBorrowerDocuments(loanIdOrName: string): Promise<BorrowerDocumentSummary[]> {
  await connectNcino();
  const loanId = await resolveLoanId(loanIdOrName);
  const accountIds = await borrowerAccountIdsForLoan(loanId);
  if (!accountIds.length) return [];

  const entities = await query<LegalEntityRow>(
    `SELECT Id, LLC_BI__Account__c, LLC_BI__Borrower_Type__c
     FROM LLC_BI__Legal_Entities__c
     WHERE LLC_BI__Loan__c = '${loanId}' AND LLC_BI__Account__c != null`,
  );
  const borrowerTypeByAccount = new Map<string, string | null>();
  const legalEntityIdByAccount = new Map<string, string>();
  for (const e of entities) {
    if (e.LLC_BI__Account__c) {
      borrowerTypeByAccount.set(e.LLC_BI__Account__c, e.LLC_BI__Borrower_Type__c ?? null);
      legalEntityIdByAccount.set(e.LLC_BI__Account__c, e.Id);
    }
  }

  const idList = accountIds.map((id) => `'${id}'`).join(',');
  const accountRows = await query<{ Id: string; Name: string; [key: string]: unknown }>(
    `SELECT Id, Name FROM Account WHERE Id IN (${idList})`,
  );
  const accountNameById = new Map(accountRows.map((a) => [a.Id, a.Name]));

  const rows = await query<AccountDocumentRow>(
    `SELECT Id, Name, LLC_BI__Account__c, LLC_BI__Has_File__c, NDOC__fileName__c, LLC_BI__Document_Store_Index__c, LLC_BI__version__c
     FROM ${ACCOUNT_DOCUMENT_OBJECT}
     WHERE LLC_BI__Account__c IN (${idList})
     ORDER BY Name`,
  );

  const summaries: BorrowerDocumentSummary[] = [];
  for (const row of rows) {
    const stored = await summarizeStoredDocument(row, getDocumentStoreIdForAccountDocument);
    summaries.push({
      level: 'borrower',
      id: row.Id,
      name: row.Name,
      loanId,
      accountId: row.LLC_BI__Account__c,
      legalEntityId: legalEntityIdByAccount.get(row.LLC_BI__Account__c) ?? null,
      accountName: accountNameById.get(row.LLC_BI__Account__c) ?? null,
      borrowerType: borrowerTypeByAccount.get(row.LLC_BI__Account__c) ?? null,
      ...stored,
    });
  }
  return summaries;
}

/** Loan checklist documents plus borrower account documents (e.g. CreditSafe). */
export async function listAllDocumentsForLoan(loanIdOrName: string): Promise<DocumentSummary[]> {
  const [loanDocs, borrowerDocs] = await Promise.all([
    listLoanDocuments(loanIdOrName),
    listBorrowerDocuments(loanIdOrName),
  ]);
  return [...loanDocs, ...borrowerDocs];
}

async function downloadContentVersion(contentVersionId: string): Promise<DocumentDownloadResult> {
  const conn = getConnection();
  const meta = await query<ContentVersionRow>(
    `SELECT Id, Title, FileExtension, ContentSize, ContentDocumentId
     FROM ContentVersion WHERE Id = '${contentVersionId}' LIMIT 1`,
  );
  const cv = meta[0];
  if (!cv) {
    throw new Error(`ContentVersion not found: ${contentVersionId}`);
  }

  const apiVersion = config.salesforce.apiVersion;
  const url = `${conn.instanceUrl}/services/data/v${apiVersion}/sobjects/ContentVersion/${contentVersionId}/VersionData`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${conn.accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to download file (${res.status}): ${text.slice(0, 200)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = cv.FileExtension ? `.${cv.FileExtension}` : '';
  const fileName = sanitizeFileName(
    cv.Title.toLowerCase().endsWith(ext.toLowerCase()) ? cv.Title : `${cv.Title}${ext}`,
  );

  return {
    buffer,
    fileName,
    contentType: contentTypeForExtension(cv.FileExtension),
    contentVersionId: cv.Id,
  };
}

/**
 * Download file for a loan document.
 * @param loanDocumentId LLC_BI__LLC_LoanDocument__c Id (or ContentVersion Id if 068…)
 * @param contentVersionId Optional — when multiple files exist on the document store
 */
async function downloadStoredDocument(
  label: string,
  documentId: string,
  preferredFileName: string | null,
  getStoreId: (id: string) => Promise<string | null>,
  contentVersionId?: string,
): Promise<DocumentDownloadResult> {
  if (contentVersionId) {
    return downloadContentVersion(contentVersionId);
  }

  const storeId = await getStoreId(documentId);
  if (!storeId) {
    throw new Error(`No document store linked for ${label}`);
  }

  const versions = await listContentVersionsForDocumentStore(storeId);
  const picked = pickContentVersion(versions, preferredFileName);
  if (!picked) {
    throw new Error(`No Salesforce file found for ${label}`);
  }

  return downloadContentVersion(picked.contentVersionId);
}

/**
 * Download file for a loan or borrower document on the loan.
 * @param documentId LLC_BI__LLC_LoanDocument__c, LLC_BI__AccountDocument__c, or ContentVersion Id (068…)
 */
export async function downloadLoanDocument(
  loanIdOrName: string,
  documentId: string,
  contentVersionId?: string,
): Promise<DocumentDownloadResult> {
  await connectNcino();
  const loanId = await resolveLoanId(loanIdOrName);

  if (documentId.startsWith('068')) {
    return downloadContentVersion(documentId);
  }

  const loanDocs = await query<LoanDocumentRow>(
    `SELECT Id, Name, LLC_BI__Loan__c, LLC_BI__Has_File__c, NDOC__fileName__c
     FROM ${LOAN_DOCUMENT_OBJECT}
     WHERE Id = '${documentId}' AND LLC_BI__Loan__c = '${loanId}' LIMIT 1`,
  );
  const loanDoc = loanDocs[0];
  if (loanDoc) {
    if (!loanDoc.LLC_BI__Has_File__c) {
      throw new Error(`Loan document "${loanDoc.Name}" has no file attached`);
    }
    return downloadStoredDocument(
      `loan document "${loanDoc.Name}"`,
      documentId,
      loanDoc.NDOC__fileName__c ?? null,
      getDocumentStoreIdForLoanDocument,
      contentVersionId,
    );
  }

  const accountIds = await borrowerAccountIdsForLoan(loanId);
  if (!accountIds.length) {
    throw new Error(`Document ${documentId} not found on loan ${loanId}`);
  }
  const idList = accountIds.map((id) => `'${id}'`).join(',');
  const accountDocs = await query<AccountDocumentRow>(
    `SELECT Id, Name, LLC_BI__Account__c, LLC_BI__Has_File__c, NDOC__fileName__c
     FROM ${ACCOUNT_DOCUMENT_OBJECT}
     WHERE Id = '${documentId}' AND LLC_BI__Account__c IN (${idList}) LIMIT 1`,
  );
  const accountDoc = accountDocs[0];
  if (!accountDoc) {
    throw new Error(`Document ${documentId} not found on loan ${loanId}`);
  }
  if (!accountDoc.LLC_BI__Has_File__c) {
    throw new Error(`Borrower document "${accountDoc.Name}" has no file attached`);
  }
  return downloadStoredDocument(
    `borrower document "${accountDoc.Name}"`,
    documentId,
    accountDoc.NDOC__fileName__c ?? null,
    getDocumentStoreIdForAccountDocument,
    contentVersionId,
  );
}
