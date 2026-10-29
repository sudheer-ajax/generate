/**
 * Replace data/boe-field-mapping.json with your full BOE spec export.
 * Usage: node scripts/import-boe-mapping.mjs path/to/mapping.json
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { resolve } from 'path';

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/import-boe-mapping.mjs <mapping.json>');
  process.exit(1);
}

const abs = resolve(src);
const data = JSON.parse(readFileSync(abs, 'utf8'));
if (!data.meta?.field_count || !Array.isArray(data.fields)) {
  console.error('Invalid mapping: expected meta.field_count and fields[]');
  process.exit(1);
}

const dest = resolve('data/boe-field-mapping.json');
writeFileSync(dest, JSON.stringify(data, null, 2));
console.log(`Imported ${data.fields.length} fields -> ${dest}`);
