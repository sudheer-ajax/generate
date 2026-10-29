/**
 * Legacy BOE template preview (optional). Not part of the default product surface.
 * Run: npm run legacy:boe-preview
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config, assertSalesforceAuthConfig, assertMambuConfig } from '../config/env.js';
import {
  buildNcinoDataset,
  buildMambuDataset,
  joinNcinoAndMambu,
  toTemplateRow,
} from '../services/boe-builder.js';
import { loadBoeMapping } from '../mapping/loadBoeMapping.js';
import type { JoinedBoeRow } from '../types/boe.js';

async function main(): Promise<void> {
  const mapping = loadBoeMapping();
  console.log(`BOE template: ${mapping.meta.template}`);
  console.log(`Fields: ${mapping.meta.field_count}`);

  const mambuConfigured = Boolean(config.mambu.baseUrl && config.mambu.apiKey);
  const runNcino = !process.argv.includes('--mambu-only');
  const runMambu =
    process.argv.includes('--mambu-only') ||
    process.argv.includes('--with-mambu') ||
    (mambuConfigured && !process.argv.includes('--ncino-only'));

  let joined: JoinedBoeRow[] = [];

  if (runNcino) {
    assertSalesforceAuthConfig();
    const ncinoRows = await buildNcinoDataset({ limit: 50 });
    joined = ncinoRows.map((n) => ({
      ncinoLoanId: n.ncinoLoanId,
      ncinoLoanName: n.ncinoLoanName,
      mambuLoanId: null,
      boe: n.boe,
    }));
    console.log(`nCino loans fetched: ${ncinoRows.length}`);
  }

  if (runMambu) {
    assertMambuConfig();
    const mambuRows = await buildMambuDataset({ limit: 50, offset: 0 });
    console.log(`Mambu loans fetched: ${mambuRows.length}`);

    if (runNcino && joined.length) {
      joined = joinNcinoAndMambu(
        joined.map((j) => ({
          ncinoLoanId: j.ncinoLoanId!,
          ncinoLoanName: j.ncinoLoanName,
          boe: j.boe,
        })),
        mambuRows,
      );
    } else if (!runNcino) {
      joined = mambuRows.map((m) => ({
        ncinoLoanId: null,
        ncinoLoanName: m.ncinoLoanName ?? '',
        mambuLoanId: m.mambuLoanId,
        boe: m.boe,
      }));
    }
  }

  const outDir = join(process.cwd(), 'output');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `boe-preview-${Date.now()}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        cutoffDate: config.boe.cutoffDate,
        rows: joined.slice(0, 10).map((r) => ({
          ...r,
          templatePreview: toTemplateRow(r),
        })),
      },
      null,
      2,
    ),
  );

  console.log(`Wrote preview: ${outPath}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
