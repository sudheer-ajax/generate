import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { assertSalesforceAuthConfig } from '../config/env.js';
import {
  downloadLoanDocument,
  listAllDocumentsForLoan,
  resolveLoanId,
} from '../services/loan-documents.js';
import type { DocumentSummary } from '../types/documents.js';

function usage(): never {
  console.error(`
Usage:
  npm run docs:list -- <loanIdOrName> [--filter=text] [--all]
  npm run docs:download -- <loanIdOrName> <documentId> [--out=path] [--content-version=068...]

Examples:
  npm run docs:list -- a0i4K0000072cbaQAA
  npm run docs:list -- LN-000123 --filter=credit
  npm run docs:download -- a0i4K0000072cbaQAA a0b4K000005AqYvQAK
  npm run docs:download -- a0i4K0000072cbaQAA a074K0000089Cp4QAE --out=./CreditSafe.pdf
`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  includeWithoutFiles: boolean;
  filter: string | null;
  outPath: string | null;
  contentVersionId: string | null;
} {
  const args = argv.slice(2);
  const command = args[0];
  if (!command || command.startsWith('-')) usage();

  let includeWithoutFiles = false;
  let filter: string | null = null;
  let outPath: string | null = null;
  let contentVersionId: string | null = null;
  const positional: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--all') includeWithoutFiles = true;
    else if (a.startsWith('--filter=')) filter = a.slice('--filter='.length);
    else if (a.startsWith('--out=')) outPath = a.slice('--out='.length);
    else if (a.startsWith('--content-version=')) contentVersionId = a.slice('--content-version='.length);
    else if (a.startsWith('-')) usage();
    else positional.push(a);
  }

  return { command, positional, includeWithoutFiles, filter, outPath, contentVersionId };
}

function hasDownloadableFile(doc: DocumentSummary): boolean {
  return doc.contentVersions.length > 0;
}

function matchesFilter(doc: DocumentSummary, filter: string | null): boolean {
  if (!filter) return true;
  const q = filter.toLowerCase();
  const hay = `${doc.name} ${doc.fileName ?? ''} ${doc.level}`.toLowerCase();
  return hay.includes(q);
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function cmdList(
  loanRef: string,
  includeWithoutFiles: boolean,
  filter: string | null,
): Promise<void> {
  const docs = await listAllDocumentsForLoan(loanRef);
  const loanId = docs[0]?.loanId ?? (await resolveLoanId(loanRef));
  const filtered = docs.filter(
    (d) => matchesFilter(d, filter) && (includeWithoutFiles || hasDownloadableFile(d)),
  );

  console.log(`Loan Id: ${loanId}`);
  const withFiles = docs.filter(hasDownloadableFile).length;
  console.log(`Documents with files: ${filtered.length}${includeWithoutFiles ? ` (${withFiles} downloadable of ${docs.length} total)` : ''}\n`);

  const levelLabel = (d: DocumentSummary) =>
    d.level === 'borrower'
      ? `borrower${d.borrowerType ? ` (${d.borrowerType})` : ''}`
      : 'loan';

  for (const d of filtered) {
    const versionLabel = d.version != null ? String(d.version) : '—';
    const fileNameLabel = d.fileName ?? '—';
    const accountLabel =
      d.level === 'borrower'
        ? `${d.accountId}${d.accountName ? ` (${d.accountName})` : ''}${d.borrowerType ? ` · ${d.borrowerType}` : ''}`
        : '—';

    console.log(`[${levelLabel(d)}] ${d.name}`);
    console.log(`  id:       ${d.id}`);
    console.log(`  version:  ${versionLabel}`);
    console.log(`  fileName: ${fileNameLabel}`);
    console.log(`  account:  ${accountLabel}`);
    if (d.contentVersions.length) {
      console.log('  files:');
      for (const v of d.contentVersions) {
        const label = `${v.title}${v.fileExtension ? `.${v.fileExtension}` : ''}`;
        const fileVersion = v.versionNumber != null ? `v${v.versionNumber}` : 'v?';
        console.log(
          `    - ${fileVersion} | ${v.contentVersionId} | ${label} | ${formatSize(v.contentSize)}`,
        );
      }
    } else {
      console.log('  files:    (no file)');
    }
    console.log('');
  }
}

async function cmdDownload(
  loanRef: string,
  documentId: string,
  outPath: string | null,
  contentVersionId: string | null,
): Promise<void> {
  const file = await downloadLoanDocument(loanRef, documentId, contentVersionId ?? undefined);
  const dest = resolve(outPath ?? file.fileName);
  writeFileSync(dest, file.buffer);
  console.log(`Saved ${dest} (${file.buffer.length} bytes, ${file.contentType})`);
  console.log(`ContentVersion: ${file.contentVersionId}`);
}

async function main(): Promise<void> {
  assertSalesforceAuthConfig();
  const { command, positional, includeWithoutFiles, filter, outPath, contentVersionId } =
    parseArgs(process.argv);

  if (command === 'list') {
    const loanRef = positional[0];
    if (!loanRef) usage();
    await cmdList(loanRef, includeWithoutFiles, filter);
    return;
  }

  if (command === 'download') {
    const loanRef = positional[0];
    const documentId = positional[1];
    if (!loanRef || !documentId) usage();
    await cmdDownload(loanRef, documentId, outPath, contentVersionId);
    return;
  }

  usage();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
