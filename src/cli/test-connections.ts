import { assertSalesforceAuthConfig, assertMambuConfig, config } from '../config/env.js';
import { connectNcino, describeGlobal } from '../clients/ncino.js';
import { searchLoans } from '../clients/mambu.js';
import type { MambuLoan } from '../types/mambu.js';

async function testSalesforce(): Promise<void> {
  assertSalesforceAuthConfig();
  console.log(`Salesforce auth mode: ${config.salesforce.authMode}`);
  console.log(`OAuth login host: ${config.salesforce.loginUrl}`);
  const { userInfo } = await connectNcino();
  const global = await describeGlobal();
  const loanRelated = global.sobjects
    .filter((s) => s.name.startsWith('LLC_BI__') && /Loan/i.test(s.name))
    .map((s) => s.name)
    .sort();
  const coreLoanObjects = [
    'LLC_BI__Loan__c',
    'LLC_BI__Loan_Collateral2__c',
    'LLC_BI__Collateral__c',
    'LLC_BI__Legal_Entities__c',
  ];
  const present = coreLoanObjects.filter((name) =>
    global.sobjects.some((s) => s.name === name),
  );
  const missing = coreLoanObjects.filter((name) => !present.includes(name));

  console.log('Salesforce OK:', userInfo.id, userInfo.organizationId);
  console.log('Core nCino loan objects present:', present.join(', ') || '(none)');
  if (missing.length) console.log('Missing from org:', missing.join(', '));
  console.log(`All LLC_BI__* with "Loan" in name (${loanRelated.length}):`, loanRelated.join(', '));
}

async function testMambu(): Promise<void> {
  assertMambuConfig();
  const result = await searchLoans({}, { limit: 1, offset: 0, detailsLevel: 'BASIC' });
  const count = Array.isArray(result)
    ? result.length
    : ((result as { data?: MambuLoan[] }).data?.length ?? 0);
  console.log('Mambu OK:', config.mambu.baseUrl, `sample loans: ${count}`);
}

const which = process.argv[2] || 'all';

async function main(): Promise<void> {
  if (which === 'salesforce' || which === 'all') {
    await testSalesforce();
  }
  if (which === 'mambu' || which === 'all') {
    await testMambu();
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(message);
  process.exit(1);
});
