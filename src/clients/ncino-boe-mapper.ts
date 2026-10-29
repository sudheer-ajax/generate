import type { BoeConfigValues, BoeFieldRow } from '../types/boe.js';
import type {
  CalculateBoeContext,
  NcinoAccountRecord,
  NcinoLegalEntityRecord,
  NcinoLoanCollateralRecord,
  NcinoLoanRecord,
} from '../types/ncino.js';

/** boe_field_id -> Salesforce field API name on LLC_BI__Loan__c (org-specific). */
export const NCINO_FIELD_OVERRIDES: Partial<Record<string, string>> = {
  // AR4: 'Your_Regulated_Field__c',
};

export function mapNcinoLoanToBoeFields(
  loan: NcinoLoanRecord,
  configValues: BoeConfigValues = {},
): BoeFieldRow {
  const regulatedField = NCINO_FIELD_OVERRIDES.AR4;
  const regulatedValue =
    regulatedField && loan[regulatedField] != null ? String(loan[regulatedField]) : 'ND';

  return {
    AR1: configValues.cutoff_date ?? null,
    AR2: configValues.pool_id ?? null,
    AR5: configValues.originator_name ?? null,
    AR6: configValues.servicer_id ?? null,
    AR7: loan.LLC_BI__Account__c ?? null,
    AR55: loan.LLC_BI__Close_Date__c ?? null,
    AR58: mapOriginationChannel(loan.LLC_BI__Origination_Channel__c),
    AR59: mapPurpose(loan.LLC_BI__Purpose__c),
    AR66: loan.LLC_BI__Amount__c ?? null,
    AR4: regulatedValue,
  };
}

export function mapCollateralToBoeFields(collateralRow: NcinoLoanCollateralRecord): BoeFieldRow {
  const col = collateralRow.LLC_BI__Collateral__r ?? {};
  return {
    AR8: col.Id ?? col.Name ?? null,
    AR129: outwardPostcode(col.LLC_BI__Postal_Code__c),
    AR136: col.LLC_BI__Value__c ?? null,
    AR84: mapLien(collateralRow.LLC_BI__Lien_Position__c),
  };
}

export function mapAccountToBoeFields(account: NcinoAccountRecord): BoeFieldRow {
  const yob = account.PersonBirthdate;
  return {
    AR18: yob ? String(new Date(yob).getUTCFullYear()) : null,
  };
}

export function mapLegalEntitiesToBoeFields(entities: NcinoLegalEntityRecord[]): BoeFieldRow {
  const borrowers = entities.filter(Boolean);
  const primary = borrowers[0];
  const secondary = borrowers[1];
  return {
    AR19: borrowers.length || 0,
    AR20: secondary?.LLC_BI__Account__r?.PersonBirthdate
      ? String(new Date(secondary.LLC_BI__Account__r.PersonBirthdate).getUTCFullYear())
      : null,
    AR15: mapBorrowerType(primary?.LLC_BI__Borrower_Type__c),
  };
}

export function calculateBoeFields(ctx: CalculateBoeContext): BoeFieldRow {
  const { loan, collateralValue, principalBalance } = ctx;
  const amount = loan?.LLC_BI__Amount__c;
  const valuation = collateralValue;
  const out: BoeFieldRow = {};

  if (amount != null && valuation != null && Number(valuation) > 0) {
    out.AR135 = Number(((Number(amount) / Number(valuation)) * 100).toFixed(8));
  }
  if (principalBalance != null && valuation != null && Number(valuation) > 0) {
    out.AR141 = Number(((Number(principalBalance) / Number(valuation)) * 100).toFixed(8));
  }

  return out;
}

function outwardPostcode(postcode: string | undefined): string | null {
  if (!postcode) return null;
  const trimmed = String(postcode).trim().toUpperCase();
  const match = trimmed.match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return match ? match[1]! : trimmed.slice(0, 3);
}

function mapOriginationChannel(value: string | undefined): string {
  if (!value) return 'ND';
  const v = String(value).toLowerCase();
  if (v.includes('broker')) return '3';
  if (v.includes('internet') || v.includes('online')) return '4';
  if (v.includes('branch') || v.includes('office')) return '1';
  if (v.includes('direct') || v.includes('central')) return '2';
  return 'ND';
}

function mapPurpose(value: string | undefined): string {
  if (!value) return 'ND';
  const v = String(value).toLowerCase();
  if (v.includes('purchase')) return '1';
  if (v.includes('remortgage') || v.includes('re-mortgage')) return '2';
  if (v.includes('btl') || v.includes('buy to let')) return '11';
  if (v.includes('right to buy')) return '12';
  return '7';
}

function mapLien(value: string | undefined): string {
  if (!value) return 'ND';
  const v = String(value).toLowerCase();
  if (v.includes('1') || v.includes('first')) return '1';
  if (v.includes('2') || v.includes('second')) return '2';
  if (v.includes('3') || v.includes('third')) return '3';
  return '4';
}

function mapBorrowerType(value: string | undefined): string {
  if (!value) return 'ND';
  const v = String(value).toLowerCase();
  if (v.includes('individual') || v.includes('person')) return 'IND';
  if (v.includes('commercial') || v.includes('company')) return 'COM';
  return 'ND';
}
