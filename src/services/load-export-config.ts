import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ExportConfig, ExportTarget } from '../types/export.js';
import { config } from '../config/env.js';

const DEFAULT_TARGETS: ExportTarget[] = [];

const DEFAULT: ExportConfig = {
  batchSize: 20,
  exportTargets: DEFAULT_TARGETS,
  allowedFileExtensions: [],
  excludeNamePatterns: [],
};

export function loadExportConfig(filePath?: string): ExportConfig {
  const path = resolve(filePath ?? config.export.configFile);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ExportConfig> & {
    _comment?: string;
    includeDocumentNames?: string[];
    includeNamePatterns?: string[];
  };

  let exportTargets = raw.exportTargets ?? DEFAULT.exportTargets;
  if (!exportTargets.length && raw.includeDocumentNames?.length) {
    exportTargets = raw.includeDocumentNames.map((label) => ({
      label,
      matchNames: [label],
      matchPatterns: raw.includeNamePatterns,
    }));
  }

  return {
    batchSize: raw.batchSize ?? DEFAULT.batchSize,
    exportTargets,
    allowedFileExtensions: raw.allowedFileExtensions ?? DEFAULT.allowedFileExtensions,
    excludeNamePatterns: raw.excludeNamePatterns ?? DEFAULT.excludeNamePatterns,
    collateralExport: raw.collateralExport,
  };
}
