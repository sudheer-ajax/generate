import { config } from '../config/env.js';
import {
  connectNcino,
  fetchLoans,
  fetchLoanCollateral,
  fetchLegalEntities,
  fetchAccounts,
} from '../clients/ncino.js';
import {
  mapNcinoLoanToBoeFields,
  mapCollateralToBoeFields,
  mapAccountToBoeFields,
  mapLegalEntitiesToBoeFields,
  calculateBoeFields,
} from '../clients/ncino-boe-mapper.js';
import {
  searchLoans as mambuSearchLoans,
  getLoan as mambuGetLoan,
  getLoanSchedule,
  mapMambuLoanToBoeFields,
  getNcinoLoanNameFromMambuLoan,
} from '../clients/mambu.js';
import { loadBoeMapping, orderedBoeColumnHeaders } from '../mapping/loadBoeMapping.js';
import type {
  BoeConfigValues,
  BoeFieldRow,
  BoeMappingDocument,
  JoinedBoeRow,
  MambuDatasetRow,
  NcinoDatasetRow,
  TemplateRowPreview,
} from '../types/boe.js';
import type { FetchLoansOptions } from '../types/ncino.js';
import type { MambuLoan, MambuLoanSchedule, MambuPagination } from '../types/mambu.js';

function configSlice(): BoeConfigValues {
  return {
    cutoff_date: config.boe.cutoffDate,
    pool_id: config.boe.poolId,
    originator_name: config.boe.originatorName,
    servicer_id: config.boe.servicerId,
  };
}

export function mergeBoeRow(parts: BoeFieldRow[]): BoeFieldRow {
  return Object.assign({}, ...parts);
}

export async function buildNcinoDataset(options: FetchLoansOptions = {}): Promise<NcinoDatasetRow[]> {
  await connectNcino();
  const loans = await fetchLoans(options);
  const loanIds = loans.map((l) => l.Id);
  const [collateralLinks, legalEntities] = await Promise.all([
    fetchLoanCollateral(loanIds),
    fetchLegalEntities(loanIds),
  ]);

  const accountIds = [...new Set(loans.map((l) => l.LLC_BI__Account__c).filter(Boolean))] as string[];
  const accounts = await fetchAccounts(accountIds);
  const accountById = Object.fromEntries(accounts.map((a) => [a.Id, a]));

  const collateralByLoan: Record<string, typeof collateralLinks> = {};
  for (const link of collateralLinks) {
    const loanId = link.LLC_BI__Loan__c;
    if (!collateralByLoan[loanId]) collateralByLoan[loanId] = [];
    collateralByLoan[loanId].push(link);
  }

  const entitiesByLoan: Record<string, typeof legalEntities> = {};
  for (const ent of legalEntities) {
    const loanId = ent.LLC_BI__Loan__c;
    if (!entitiesByLoan[loanId]) entitiesByLoan[loanId] = [];
    entitiesByLoan[loanId].push(ent);
  }

  const cfg = configSlice();
  return loans.map((loan) => {
    const collRows = collateralByLoan[loan.Id] ?? [];
    const primaryCollateral = collRows[0];
    const accountId = loan.LLC_BI__Account__c;
    const account = accountId ? accountById[accountId] : undefined;
    const entities = entitiesByLoan[loan.Id] ?? [];

    const row = mergeBoeRow([
      mapNcinoLoanToBoeFields(loan, cfg),
      primaryCollateral ? mapCollateralToBoeFields(primaryCollateral) : {},
      account ? mapAccountToBoeFields(account) : {},
      mapLegalEntitiesToBoeFields(entities),
      calculateBoeFields({
        loan,
        collateralValue: primaryCollateral?.LLC_BI__Collateral__r?.LLC_BI__Value__c,
        principalBalance: null,
      }),
    ]);

    return {
      ncinoLoanId: loan.Id,
      ncinoLoanName: loan.Name,
      boe: row,
    };
  });
}

export async function buildMambuDataset(pagination: MambuPagination = { limit: 200, offset: 0 }): Promise<MambuDatasetRow[]> {
  const searchResult = await mambuSearchLoans({ filterCriteria: [] }, { ...pagination, detailsLevel: 'FULL' });

  const loans: MambuLoan[] = Array.isArray(searchResult)
    ? searchResult
    : (searchResult.data ?? []);

  const rows: MambuDatasetRow[] = [];
  for (const stub of loans) {
    const id = stub.id ?? stub.encodedKey;
    if (!id) continue;

    const [full, schedule] = await Promise.all([
      mambuGetLoan(id, 'FULL'),
      getLoanSchedule(id).catch(() => null as MambuLoanSchedule | null),
    ]);

    const ncinoName = getNcinoLoanNameFromMambuLoan(full);
    rows.push({
      mambuLoanId: id,
      ncinoLoanName: ncinoName,
      boe: mapMambuLoanToBoeFields(full, schedule),
    });
  }

  return rows;
}

export function joinNcinoAndMambu(ncinoRows: NcinoDatasetRow[], mambuRows: MambuDatasetRow[]): JoinedBoeRow[] {
  const mambuByNcinoName = new Map<string, MambuDatasetRow>();
  for (const m of mambuRows) {
    if (m.ncinoLoanName) mambuByNcinoName.set(String(m.ncinoLoanName), m);
  }

  return ncinoRows.map((n) => {
    const m = mambuByNcinoName.get(String(n.ncinoLoanName));
    const boe = mergeBoeRow([n.boe, m?.boe ?? {}]);
    return {
      ncinoLoanId: n.ncinoLoanId,
      ncinoLoanName: n.ncinoLoanName,
      mambuLoanId: m?.mambuLoanId ?? null,
      boe,
    };
  });
}

export function toTemplateRow(
  joinedRow: JoinedBoeRow,
  mapping: BoeMappingDocument = loadBoeMapping(),
): TemplateRowPreview {
  const byId = joinedRow.boe;
  const headers = orderedBoeColumnHeaders(mapping);
  const values = mapping.fields.map((f) => {
    const v = byId[f.boe_field_id];
    return v === undefined || v === null ? '' : v;
  });
  return { headers, values };
}
