import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface MambuLoanAccountRecord {
  /** Singer tap line type RECORD. */
  mambuAccountId: string;
  ncinoLoanId: string;
  record: Record<string, unknown>;
  loancreation: Record<string, string | number | null>;
  loanMaturity: Record<string, string | number | null>;
}

export interface MambuLoanAccountsIndex {
  byNcinoLoanId: Map<string, MambuLoanAccountRecord>;
  byMambuAccountId: Map<string, MambuLoanAccountRecord>;
}

function normalizeSfId(id: string): string {
  const t = id.trim();
  if (t.length === 18) return t;
  if (t.length === 15) return t;
  return t;
}

function sfIdKeys(id: string): string[] {
  const t = normalizeSfId(id);
  const keys = [t];
  if (t.length === 18) keys.push(t.slice(0, 15));
  return keys;
}

function flattenCustomFields(
  customFields: unknown,
): { loancreation: Record<string, string | number | null>; loanMaturity: Record<string, string | number | null> } {
  const loancreation: Record<string, string | number | null> = {};
  const loanMaturity: Record<string, string | number | null> = {};
  if (!Array.isArray(customFields)) return { loancreation, loanMaturity };

  for (const block of customFields) {
    if (!block || typeof block !== 'object') continue;
    const lc = (block as Record<string, unknown>).__loancreation;
    if (lc && typeof lc === 'object' && !Array.isArray(lc)) {
      for (const [k, v] of Object.entries(lc as Record<string, unknown>)) {
        if (v === null || v === undefined) loancreation[k] = null;
        else if (typeof v === 'number') loancreation[k] = v;
        else loancreation[k] = String(v);
      }
    }
    const lm = (block as Record<string, unknown>).__loan_maturity;
    if (lm && typeof lm === 'object' && !Array.isArray(lm)) {
      for (const [k, v] of Object.entries(lm as Record<string, unknown>)) {
        if (v === null || v === undefined) loanMaturity[k] = null;
        else if (typeof v === 'number') loanMaturity[k] = v;
        else loanMaturity[k] = String(v);
      }
    }
  }
  return { loancreation, loanMaturity };
}

/**
 * Load Singer JSONL export (`type: RECORD`, stream `loan_accounts`).
 * Indexes by nCino loan Id (`custom_fields.__loancreation.n_cino__loan__object__id`).
 */
export function loadMambuLoanAccountsFile(filePath: string): MambuLoanAccountsIndex {
  const abs = resolve(filePath);
  const text = readFileSync(abs, 'utf8');
  const byNcinoLoanId = new Map<string, MambuLoanAccountRecord>();
  const byMambuAccountId = new Map<string, MambuLoanAccountRecord>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: { type?: string; stream?: string; record?: Record<string, unknown> };
    try {
      parsed = JSON.parse(trimmed) as typeof parsed;
    } catch {
      continue;
    }
    if (parsed.type !== 'RECORD' || parsed.stream !== 'loan_accounts' || !parsed.record) continue;

    const record = parsed.record;
    const mambuAccountId = record.id != null ? String(record.id) : '';
    const { loancreation, loanMaturity } = flattenCustomFields(record.custom_fields);
    const ncinoRaw = loancreation.n_cino__loan__object__id;
    if (!ncinoRaw || !mambuAccountId) continue;

    const ncinoLoanId = String(ncinoRaw).trim();
    const entry: MambuLoanAccountRecord = {
      mambuAccountId,
      ncinoLoanId,
      record,
      loancreation,
      loanMaturity,
    };

    for (const key of sfIdKeys(ncinoLoanId)) {
      if (!byNcinoLoanId.has(key)) byNcinoLoanId.set(key, entry);
    }
    if (!byMambuAccountId.has(mambuAccountId)) byMambuAccountId.set(mambuAccountId, entry);
  }

  return { byNcinoLoanId, byMambuAccountId };
}

export function findMambuRecord(
  index: MambuLoanAccountsIndex,
  resolvedNcinoLoanId: string,
): MambuLoanAccountRecord | undefined {
  for (const key of sfIdKeys(resolvedNcinoLoanId)) {
    const hit = index.byNcinoLoanId.get(key);
    if (hit) return hit;
  }
  return undefined;
}