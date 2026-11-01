# nCino integration services

Node.js (TypeScript) integration with **nCino on Salesforce** — loan document list/download via REST and CLI. **Mambu** client stubs are included for future use.

## Setup

```bash
npm install
cp .env.example .env
npm run build
```

Configure Salesforce in `.env` (see `.env.example` and [Deployment & environment](#deployment--environment)). For local dev, `SF_AUTH_MODE=token` with `SF_ACCESS_TOKEN` and `SF_INSTANCE_URL` is typical. **Do not commit `.env`.**

## HTTP API

```bash
npm run server
# or after build:
npm start
```

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info and route list |
| GET | `/health` | Health check |
| GET | `/api/loans/:loanId/documents` | List loan + borrower documents (`loanId` = `LLC_BI__Loan__c` Id or loan `Name`) |
| GET | `/api/loans/:loanId/documents/:documentId/download` | Download file |
| GET | `.../download?contentVersionId=068...` | Specific ContentVersion when multiple files exist |
| GET | `.../documents?filesOnly=true` | Only documents with attached files |

Document resolution: `LLC_BI__LLC_LoanDocument__c` and `LLC_BI__AccountDocument__c` → Document Store → Salesforce `ContentVersion` / `VersionData`.

## CLI

```bash
npm run test:auth              # Salesforce (+ Mambu if configured)
npm run docs:list -- <loanIdOrName> [--filter=text] [--all]
npm run docs:download -- <loanIdOrName> <documentId> [--out=path] [--content-version=068...]
npm run describe               # Sample field describe for core nCino objects
npm run loans:existence        # CSV: which loan ids/names exist in the connected org (e.g. prod list vs backup)
```

`docs:list` shows only documents with files by default; `--all` includes empty placeholders.

### Prod loan list vs backup org

Point `.env` at your **backup** sandbox, put **prod** `LLC_BI__Loan__c` Ids (or loan Names) in `data/loan-ids.txt`, then:

```bash
npm run loans:existence
# optional: npm run loans:existence -- --out=output/loan-existence/report.csv
```

CSV columns: `index`, `inputRef`, `inputKind`, `existsInOrg` (`yes`/`no`), `loanId`, `loanName`. Console prints found/missing counts. Full sandbox copies usually keep the same record Ids as prod.

### Batch export (many loans → local folder + optional S3)

1. Put nCino loan Ids or Names in `data/loan-ids.txt` (one per line).
2. Adjust `data/export.config.json` — `batchSize`, `exportTargets`, `allowedFileExtensions` (see file comments).
3. Set paths and AWS variables in `.env` (or on the host when deployed).

```bash
npm run docs:batch -- --list            # show batches (default 20 loans per batch)
npm run docs:batch -- 1                 # export batch 1 only
npm run docs:batch -- --batch=2 --dry-run
npm run docs:batch -- 1 --local-only    # skip S3 even if bucket is set
```

### Batch download by document Id list

Put nCino document Ids in `data/document-ids.txt` (or set `EXPORT_DOCUMENT_IDS_FILE`). Same `batchSize` in `data/export.config.json` as other batch jobs.

```bash
npm run docs:batch-ids -- --list
npm run docs:batch-ids -- 1
npm run docs:batch-ids -- 2 --dry-run
```

Line formats: `documentId` | `loanId,documentId` | `loanId,documentId,contentVersionId`. Loan Id is optional for loan-level documents (resolved from the record). Output: `output/document-downloads/batch-NNN/` plus `manifest-batch-NNN.json`.

### TruNarrative references (CSV by batch)

Same `data/loan-ids.txt` and batch size as document export. One row per **legal entity** on each loan. CSV includes `relationshipType` from **`Account.Type`**, `relationshipId` from **`Account.Relationship_ID__c`**, and TruNarrative id from `Account.TruNarrative_Account_Reference__c`.

```bash
npm run trunarrative:batch -- --list
npm run trunarrative:batch -- 1
```

Output: `output/trunarrative/batch-001/trunarrative-batch-001.csv` (column **Id** = 1-based row number within the batch).

### Loan collateral / securities (CSV by batch)

Same `data/loan-ids.txt` and batch size. One row per **LLC_BI__Loan_Collateral2__c** link (security on the loan).

```bash
npm run collateral:batch -- --list
npm run collateral:batch -- 1
```

Output: `output/collateral/batch-001/collateral-batch-001.csv`

By default only **residential** collateral (`collateralTypeIncludes`: `Residential`) with a real **address** (`LLC_BI__Full_Address__c`, not “No Address Provided”). Configure in `data/export.config.json` → `collateralExport`. CSV includes **collateralAddress** and **lienPosition**.

**Output layout**

```text
output/documents/batch-001/{LoanName}_{loanId}/
  {loanId}_guarantor_{legalEntityId}_doc_{documentId}_CIF_v1.pdf
  manifest.json
```

**Export rules** (`data/export.config.json`):

- **matchNames** / **matchPatterns** — nCino document record **Name** only (`LLC_BI__*Document__c.Name`), not `NDOC__fileName__c`.
- **label** — token in the saved file name (e.g. **CIF**).
- **allowedFileExtensions** — e.g. `["pdf"]` to skip other types.

**File name patterns**

- Loan document: `{loanId}_loan_doc_{documentId}_{label}_{version}.{ext}`
- Borrower/guarantor: `{loanId}_{party}_{legalEntityId}_doc_{documentId}_{label}_{version}.{ext}`  
  (`legalEntityId` = `LLC_BI__Legal_Entities__c` Id)

## Deployment & environment

After deploy, configure **environment variables** on the runtime (ECS, Lambda, EC2, Secrets Manager, etc.). Same names as `.env.example` — no code change required for bucket or auth.

### S3 (batch export)

| Variable | Purpose |
|----------|---------|
| `AWS_S3_BUCKET` | Target bucket. If empty, uploads are skipped (local only). |
| `AWS_S3_PREFIX` | Key prefix under the bucket (default `ncino-loan-documents`). |
| `AWS_REGION` | S3 client region (default `eu-west-2`; falls back to `AWS_DEFAULT_REGION`). |
| `EXPORT_LOCAL_DIR` | Local root for exports (default `output/documents`). |

S3 object keys mirror the local path:

```text
s3://{AWS_S3_BUCKET}/{AWS_S3_PREFIX}/batch-001/{LoanName}_{loanId}/{filename}.pdf
```

Example: `AWS_S3_PREFIX=prod/loan-docs` →  
`s3://my-bucket/prod/loan-docs/batch-001/...`

AWS credentials use the standard SDK chain (task IAM role, instance profile, or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).

Optional:

| Variable | Default |
|----------|---------|
| `EXPORT_LOAN_IDS_FILE` | `data/loan-ids.txt` |
| `EXPORT_CONFIG_FILE` | `data/export.config.json` |

### Salesforce auth: access token → username / password / security token (SOAP)

For deployed jobs using integration user + security token:

```env
SF_AUTH_MODE=soap
SF_LOGIN_URL=https://test.salesforce.com
SF_USERNAME=your.user@org.sandbox
SF_PASSWORD=...
SF_SECURITY_TOKEN=...
```

Clear token-based vars so mode is not overridden:

```env
SF_ACCESS_TOKEN=
SF_REFRESH_TOKEN=
```

Set **`SF_AUTH_MODE=soap` explicitly** if `SF_ACCESS_TOKEN` is still present in the environment.

SOAP does not require `SF_INSTANCE_URL` at login (jsforce resolves it). Use `https://test.salesforce.com` for sandbox login, not the My Domain URL.

`SF_SECURITY_TOKEN` is the Salesforce **security token** (email), not an OAuth access token from the CLI.

Verify after changing auth:

```bash
npm run test:auth salesforce
npm run docs:batch -- 1 --dry-run
```

## Project layout

| Path | Role |
|------|------|
| `src/clients/ncino.ts` | Salesforce / nCino (jsforce, SOQL, describe) |
| `src/clients/mambu.ts` | Mambu API v2 (future) |
| `src/clients/s3-storage.ts` | S3 upload for batch export |
| `src/config/env.ts` | Env loading (Salesforce, export, S3) |
| `src/services/loan-documents.ts` | List/download loan and borrower documents |
| `src/server.ts` | HTTP server |
| `src/cli/` | CLIs (documents, auth test, describe, batch export) |
| `src/services/boe-builder.ts` | Legacy BOE experiment (not used by default) |

## Legacy

Optional BOE template preview (previous repo purpose):

```bash
npm run legacy:boe-preview -- --ncino-only
```
