import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';
import { config, assertSalesforceAuthConfig } from './config/env.js';
import { listAllDocumentsForLoan, downloadLoanDocument } from './services/loan-documents.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: 'Invalid request' });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      const body =
        path === '/health'
          ? { status: 'ok', service: 'ncino-services' }
          : {
              service: 'ncino-services',
              description: 'nCino / Salesforce loan document API',
              routes: [
                'GET /health',
                'GET /api/loans/:loanId/documents?filesOnly=true',
                'GET /api/loans/:loanId/documents/:documentId/download?contentVersionId=optional',
              ],
            };
      sendJson(res, 200, body);
      return;
    }

    // GET /api/loans/:loanId/documents
    const listMatch = path.match(/^\/api\/loans\/([^/]+)\/documents\/?$/);
    if (req.method === 'GET' && listMatch) {
      const loanId = decodeURIComponent(listMatch[1]!);
      const filesOnly = url.searchParams.get('filesOnly') === 'true';
      let documents = await listAllDocumentsForLoan(loanId);
      if (filesOnly) {
        documents = documents.filter((d) => d.contentVersions.length > 0);
      }
      sendJson(res, 200, {
        loanId,
        count: documents.length,
        loanDocumentCount: documents.filter((d) => d.level === 'loan').length,
        borrowerDocumentCount: documents.filter((d) => d.level === 'borrower').length,
        documents,
      });
      return;
    }

    // GET /api/loans/:loanId/documents/:documentId/download
    const downloadMatch = path.match(/^\/api\/loans\/([^/]+)\/documents\/([^/]+)\/download\/?$/);
    if (req.method === 'GET' && downloadMatch) {
      const loanId = decodeURIComponent(downloadMatch[1]!);
      const documentId = decodeURIComponent(downloadMatch[2]!);
      const contentVersionId = url.searchParams.get('contentVersionId') ?? undefined;
      const file = await downloadLoanDocument(loanId, documentId, contentVersionId);
      res.writeHead(200, {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Content-Length': file.buffer.length,
        'X-Content-Version-Id': file.contentVersionId,
      });
      res.end(file.buffer);
      return;
    }

    sendJson(res, 404, {
      error: 'Not found',
      routes: [
        'GET /',
        'GET /health',
        'GET /api/loans/:loanId/documents?filesOnly=true',
        'GET /api/loans/:loanId/documents/:loanDocumentId/download?contentVersionId=optional',
      ],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 500;
    sendJson(res, status, { error: message });
  }
}

async function main(): Promise<void> {
  assertSalesforceAuthConfig();
  const port = config.port;
  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.listen(port, () => {
    console.log(`nCino services API http://localhost:${port}`);
    console.log('GET /api/loans/:loanId/documents?filesOnly=true');
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
