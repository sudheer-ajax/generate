import { assertSalesforceAuthConfig } from '../config/env.js';
import { connectNcino, describeObject } from '../clients/ncino.js';

const OBJECTS = [
  'LLC_BI__Loan__c',
  'LLC_BI__Collateral__c',
  'LLC_BI__Loan_Collateral2__c',
  'LLC_BI__Legal_Entities__c',
  'Account',
] as const;

async function main(): Promise<void> {
  assertSalesforceAuthConfig();
  await connectNcino();

  for (const name of OBJECTS) {
    try {
      const d = await describeObject(name);
      console.log(`\n=== ${name} (${d.fields.length} fields) ===`);
      const sample = d.fields
        .filter((f) => !f.calculated && f.type !== 'address')
        .slice(0, 40)
        .map((f) => `${f.name} (${f.type})`);
      console.log(sample.join('\n'));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`\n=== ${name}: ${message}`);
    }
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(message);
  process.exit(1);
});
