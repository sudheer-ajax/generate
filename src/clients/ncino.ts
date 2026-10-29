import jsforce from 'jsforce';
import { config } from '../config/env.js';
import type { FetchLoansOptions } from '../types/ncino.js';
import type {
  NcinoAccountRecord,
  NcinoLegalEntityRecord,
  NcinoLoanCollateralRecord,
  NcinoLoanRecord,
} from '../types/ncino.js';

export interface NcinoUserInfo {
  id: string;
  organizationId: string;
}

export interface NcinoConnectResult {
  connection: jsforce.Connection;
  userInfo: NcinoUserInfo;
}

let connection: jsforce.Connection | null = null;
let cachedUserInfo: NcinoUserInfo | null = null;

async function identityAsUserInfo(conn: jsforce.Connection): Promise<NcinoUserInfo> {
  const identity = await conn.identity();
  return {
    id: identity.user_id,
    organizationId: identity.organization_id,
  };
}

/**
 * Salesforce auth: oauth | soap | token (access token) | refresh (client + refresh token).
 */
export async function connectNcino(): Promise<NcinoConnectResult> {
  if (connection?.accessToken && cachedUserInfo) {
    return { connection, userInfo: cachedUserInfo };
  }

  const {
    loginUrl,
    username,
    password,
    securityToken,
    authMode,
    clientId,
    clientSecret,
    accessToken,
    refreshToken,
    instanceUrl,
  } = config.salesforce;

  let conn: jsforce.Connection;
  let userInfo: NcinoUserInfo;

  if (authMode === 'token') {
    conn = new jsforce.Connection({
      instanceUrl: instanceUrl.replace(/\/$/, ''),
      accessToken,
      version: config.salesforce.apiVersion,
    });
    userInfo = await identityAsUserInfo(conn);
  } else if (authMode === 'refresh') {
    const oauth2 = new jsforce.OAuth2({
      loginUrl,
      clientId,
      clientSecret,
    });
    const tokenResponse = await oauth2.refreshToken(refreshToken);
    conn = new jsforce.Connection({
      oauth2,
      instanceUrl: (instanceUrl || tokenResponse.instance_url).replace(/\/$/, ''),
      accessToken: tokenResponse.access_token,
      refreshToken,
      version: config.salesforce.apiVersion,
    });
    userInfo = await identityAsUserInfo(conn);
  } else {
    conn =
      authMode === 'oauth'
        ? new jsforce.Connection({
            oauth2: {
              loginUrl,
              clientId,
              clientSecret,
            },
            version: config.salesforce.apiVersion,
          })
        : new jsforce.Connection({
            loginUrl,
            version: config.salesforce.apiVersion,
          });

    const loginPassword = `${password}${securityToken || ''}`;
    try {
      const loginResult = await conn.login(username, loginPassword);
      userInfo = { id: loginResult.id, organizationId: loginResult.organizationId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/client identifier invalid/i.test(msg)) {
        throw new Error(
          [
            msg,
            'Salesforce rejected the Connected App Consumer Key (SF_CLIENT_ID).',
            'In gbbmerge: Setup → App Manager → IL Connected App → View Consumer Details — copy Key/Secret again.',
            'Ensure "Allow OAuth Username-Password Flows" is enabled on the Connected App.',
            'Use SF_LOGIN_URL=https://test.salesforce.com (not My Domain), or set SF_AUTH_MODE=soap with SF_SECURITY_TOKEN.',
            'If you already have an OAuth access token, use SF_AUTH_MODE=token with SF_ACCESS_TOKEN + SF_INSTANCE_URL.',
          ].join(' '),
        );
      }
      if (/LOGIN_MUST_USE_SECURITY_TOKEN/i.test(msg)) {
        throw new Error(
          [
            msg,
            'Append your sandbox security token to SF_PASSWORD via SF_SECURITY_TOKEN in .env',
            '(Personal Settings → Reset My Security Token in the org).',
            'Or use SF_AUTH_MODE=oauth with a valid Connected App if IP is untrusted.',
          ].join(' '),
        );
      }
      if (/INVALID_LOGIN/i.test(msg)) {
        throw new Error(
          [
            msg,
            'Check SF_USERNAME, SF_PASSWORD, and SF_SECURITY_TOKEN (reset token in org if password changed).',
            'Quote SF_PASSWORD in .env if it contains special characters, e.g. SF_PASSWORD="yourPassword".',
            'If you can log in via `sf org login web` but SOAP still fails, the security token is often stale—reset it in the org and update .env.',
            'Or use SF_AUTH_MODE=token with SF_ACCESS_TOKEN + SF_INSTANCE_URL from `sf org auth show-access-token`.',
          ].join(' '),
        );
      }
      throw err;
    }

    if (instanceUrl) {
      conn.instanceUrl = instanceUrl.replace(/\/$/, '');
    }
  }

  connection = conn;
  cachedUserInfo = userInfo;
  return { connection: conn, userInfo };
}

export function getConnection(): jsforce.Connection {
  if (!connection?.accessToken) {
    throw new Error('nCino not connected. Call connectNcino() first.');
  }
  return connection;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  soql: string,
): Promise<T[]> {
  const conn = getConnection();
  const records: T[] = [];
  let result = await conn.query<T>(soql);
  records.push(...result.records);
  while (!result.done && result.nextRecordsUrl) {
    result = await conn.queryMore<T>(result.nextRecordsUrl);
    records.push(...result.records);
  }
  return records;
}

export async function describeObject(objectName: string) {
  const conn = getConnection();
  return conn.sobject(objectName).describe();
}

export async function describeGlobal() {
  const conn = getConnection();
  return conn.describeGlobal();
}

/** Common nCino loan fields for SOQL. */
export const NCINO_LOAN_SOQL_FIELDS = [
  'Id',
  'Name',
  'LLC_BI__Account__c',
  'LLC_BI__Close_Date__c',
  'LLC_BI__Amount__c',
  'LLC_BI__Purpose__c',
  'LLC_BI__Origination_Channel__c',
] as const;

export async function fetchLoans(options: FetchLoansOptions = {}): Promise<NcinoLoanRecord[]> {
  const limit = options.limit ?? 200;
  const whereExtra = options.whereExtra ? ` AND (${options.whereExtra})` : '';
  const fields = NCINO_LOAN_SOQL_FIELDS.join(', ');
  const soql = `
    SELECT ${fields}
    FROM LLC_BI__Loan__c
    WHERE LLC_BI__Stage__c != null
    ${whereExtra}
    ORDER BY LastModifiedDate DESC
    LIMIT ${limit}
  `
    .replace(/\s+/g, ' ')
    .trim();

  return query<NcinoLoanRecord>(soql);
}

export async function fetchLoanCollateral(
  loanIds: string[],
): Promise<NcinoLoanCollateralRecord[]> {
  if (!loanIds.length) return [];
  const idList = loanIds.map((id) => `'${id}'`).join(',');
  const soql = `
    SELECT Id, LLC_BI__Loan__c, LLC_BI__Collateral__c,
           LLC_BI__Collateral__r.Id, LLC_BI__Collateral__r.Name,
           LLC_BI__Collateral__r.LLC_BI__Postal_Code__c,
           LLC_BI__Collateral__r.LLC_BI__Value__c,
           LLC_BI__Lien_Position__c
    FROM LLC_BI__Loan_Collateral2__c
    WHERE LLC_BI__Loan__c IN (${idList})
  `
    .replace(/\s+/g, ' ')
    .trim();

  return query<NcinoLoanCollateralRecord>(soql);
}

export async function fetchLegalEntities(loanIds: string[]): Promise<NcinoLegalEntityRecord[]> {
  if (!loanIds.length) return [];
  const idList = loanIds.map((id) => `'${id}'`).join(',');
  const soql = `
    SELECT Id, LLC_BI__Loan__c, LLC_BI__Account__c,
           LLC_BI__Account__r.PersonBirthdate,
           LLC_BI__Borrower_Type__c
    FROM LLC_BI__Legal_Entities__c
    WHERE LLC_BI__Loan__c IN (${idList})
  `
    .replace(/\s+/g, ' ')
    .trim();

  return query<NcinoLegalEntityRecord>(soql);
}

export async function fetchAccounts(accountIds: string[]): Promise<NcinoAccountRecord[]> {
  if (!accountIds.length) return [];
  const idList = accountIds.map((id) => `'${id}'`).join(',');
  const soql = `
    SELECT Id, PersonBirthdate, Name
    FROM Account
    WHERE Id IN (${idList})
  `
    .replace(/\s+/g, ' ')
    .trim();

  return query<NcinoAccountRecord>(soql);
}
