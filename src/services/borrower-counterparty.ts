import { query } from '../clients/ncino.js';
import { RELATIONSHIP_ID_FIELD } from './trunarrative-export.js';

const LEGAL_ENTITY_OBJECT = 'LLC_BI__Legal_Entities__c';
const SOQL_IN_CHUNK = 200;

interface BorrowerLegalEntityRow {
  LLC_BI__Loan__c: string;
  LLC_BI__Borrower_Type__c?: string;
  LLC_BI__Account__r?: {
    Relationship_ID__c?: string;
  };
  [key: string]: unknown;
}

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isBorrowerType(value: string | undefined | null): boolean {
  return (value ?? '').trim().toLowerCase() === 'borrower';
}

/**
 * For each loan, Relationship ID (`Account.Relationship_ID__c`) on the first
 * borrowing-structure row with borrower type Borrower (same source as TruNarrative export).
 */
export async function fetchBorrowerRelationshipIdByLoanId(
  loanIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!loanIds.length) return map;

  for (let i = 0; i < loanIds.length; i += SOQL_IN_CHUNK) {
    const chunk = loanIds.slice(i, i + SOQL_IN_CHUNK);
    const inList = chunk.map((id) => `'${escapeSoqlLiteral(id)}'`).join(',');
    const rows = await query<BorrowerLegalEntityRow>(
      `SELECT LLC_BI__Loan__c, LLC_BI__Borrower_Type__c,
              LLC_BI__Account__r.${RELATIONSHIP_ID_FIELD}
       FROM ${LEGAL_ENTITY_OBJECT}
       WHERE LLC_BI__Loan__c IN (${inList})
       ORDER BY LLC_BI__Loan__c, Id`.replace(/\s+/g, ' '),
    );

    for (const row of rows) {
      if (!isBorrowerType(row.LLC_BI__Borrower_Type__c)) continue;
      const loanId = row.LLC_BI__Loan__c;
      if (map.has(loanId)) continue;

      const relationshipId = row.LLC_BI__Account__r?.Relationship_ID__c;
      if (relationshipId == null || String(relationshipId).trim() === '') continue;

      const id = String(relationshipId).trim();
      map.set(loanId, id);
      if (loanId.length === 18) map.set(loanId.slice(0, 15), id);
    }
  }

  return map;
}

export function borrowerRelationshipIdForLoan(
  map: Map<string, string>,
  loanId: string | null | undefined,
): string | null {
  if (!loanId) return null;
  return map.get(loanId) ?? map.get(loanId.slice(0, 15)) ?? null;
}