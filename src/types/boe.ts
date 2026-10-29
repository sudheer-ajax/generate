export type BoeFieldValue = string | number | null;

/** BOE row keyed by template field id (e.g. AR1). */
export type BoeFieldRow = Record<string, BoeFieldValue>;

export interface BoeFieldMapping {
  source_system: string;
  api?: string;
  object?: string;
  field?: string;
  transformation?: string;
  confidence?: string;
}

export interface BoeFieldDefinition {
  boe_field_id: string;
  boe_field_name: string;
  priority?: string;
  tag?: string;
  category?: string;
  data_type?: string;
  mapping?: BoeFieldMapping;
}

export interface BoeMappingMeta {
  template: string;
  field_count: number;
  [key: string]: unknown;
}

export interface BoeMappingDocument {
  meta: BoeMappingMeta;
  fields: BoeFieldDefinition[];
}

export interface BoeConfigValues {
  cutoff_date?: string;
  pool_id?: string;
  originator_name?: string;
  servicer_id?: string;
}

export interface NcinoDatasetRow {
  ncinoLoanId: string;
  ncinoLoanName: string;
  boe: BoeFieldRow;
}

export interface MambuDatasetRow {
  mambuLoanId: string;
  ncinoLoanName: string | null;
  boe: BoeFieldRow;
}

export interface JoinedBoeRow {
  ncinoLoanId: string | null;
  ncinoLoanName: string;
  mambuLoanId: string | null;
  boe: BoeFieldRow;
}

export interface TemplateRowPreview {
  headers: string[];
  values: (string | number)[];
}
