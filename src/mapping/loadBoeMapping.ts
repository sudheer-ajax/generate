import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { BoeFieldDefinition, BoeMappingDocument } from '../types/boe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPPING_PATH = join(__dirname, '../../data/boe-field-mapping.json');

let cached: BoeMappingDocument | undefined;

export function loadBoeMapping(): BoeMappingDocument {
  if (cached) return cached;
  const raw = readFileSync(MAPPING_PATH, 'utf8');
  cached = JSON.parse(raw) as BoeMappingDocument;
  return cached;
}

export function fieldsBySource(mapping: BoeMappingDocument = loadBoeMapping()): Record<string, BoeFieldDefinition[]> {
  const groups: Record<string, BoeFieldDefinition[]> = {};
  for (const field of mapping.fields) {
    const src = field.mapping?.source_system ?? 'Unknown';
    if (!groups[src]) groups[src] = [];
    groups[src].push(field);
  }
  return groups;
}

export function orderedBoeColumnHeaders(mapping: BoeMappingDocument = loadBoeMapping()): string[] {
  return mapping.fields.map((f) => f.boe_field_name);
}
