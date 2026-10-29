import dotenv from 'dotenv';

dotenv.config();

/**
 * OAuth username-password must use https://test.salesforce.com (sandbox) or
 * https://login.salesforce.com (prod)—not the My Domain host.
 */
function resolveSalesforceLoginUrl(): string {
  const raw = (process.env.SF_LOGIN_URL || '').trim();
  if (!raw) return 'https://test.salesforce.com';
  if (raw.includes('test.salesforce.com') || raw.includes('login.salesforce.com')) {
    return raw.replace(/\/$/, '');
  }
  if (raw.includes('.sandbox.') || raw.includes('--')) {
    return 'https://test.salesforce.com';
  }
  return raw.replace(/\/$/, '');
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export type SalesforceAuthMode = 'oauth' | 'soap' | 'token' | 'refresh';

function resolveSalesforceAuthMode(): SalesforceAuthMode {
  const explicit = (process.env.SF_AUTH_MODE || '').trim().toLowerCase();
  if (explicit === 'soap' || explicit === 'oauth' || explicit === 'token' || explicit === 'refresh') {
    return explicit;
  }
  if (process.env.SF_ACCESS_TOKEN?.trim()) return 'token';
  if (process.env.SF_REFRESH_TOKEN?.trim()) return 'refresh';
  // Username + security token → SOAP (no Connected App required)
  if (
    process.env.SF_USERNAME?.trim() &&
    process.env.SF_PASSWORD?.trim() &&
    process.env.SF_SECURITY_TOKEN?.trim()
  ) {
    return 'soap';
  }
  if (process.env.SF_CLIENT_ID?.trim() && process.env.SF_CLIENT_SECRET?.trim()) {
    return 'oauth';
  }
  return 'soap';
}

export const config = {
  port: Number(process.env.PORT || 3000),
  /** Legacy BOE preview CLI only (`npm run legacy:boe-preview`). */
  boe: {
    cutoffDate: process.env.BOE_CUTOFF_DATE || '',
    poolId: process.env.BOE_POOL_ID || '',
    originatorName: process.env.BOE_ORIGINATOR_NAME || '',
    servicerId: process.env.BOE_SERVICER_ID || '',
  },
  salesforce: {
    loginUrl: resolveSalesforceLoginUrl(),
    instanceUrl: process.env.SF_INSTANCE_URL || '',
    authMode: resolveSalesforceAuthMode(),
    clientId: process.env.SF_CLIENT_ID || '',
    clientSecret: process.env.SF_CLIENT_SECRET || '',
    username: process.env.SF_USERNAME || '',
    password: process.env.SF_PASSWORD || '',
    securityToken: process.env.SF_SECURITY_TOKEN || '',
    accessToken: process.env.SF_ACCESS_TOKEN || '',
    refreshToken: process.env.SF_REFRESH_TOKEN || '',
    apiVersion: process.env.SF_API_VERSION || '60.0',
  },
  mambu: {
    baseUrl: (process.env.MAMBU_BASE_URL || '').replace(/\/$/, ''),
    apiKey: process.env.MAMBU_API_KEY || '',
    ncinoLoanNameField: process.env.MAMBU_NCINO_LOAN_NAME_FIELD || 'ncino_loan_name',
  },
  export: {
    loanIdsFile: process.env.EXPORT_LOAN_IDS_FILE || 'data/loan-ids.txt',
    configFile: process.env.EXPORT_CONFIG_FILE || 'data/export.config.json',
    localDir: process.env.EXPORT_LOCAL_DIR || 'output/documents',
    s3Bucket: (process.env.AWS_S3_BUCKET || '').trim(),
    s3Prefix: (process.env.AWS_S3_PREFIX || 'ncino-loan-documents').replace(/^\/+|\/+$/g, ''),
    awsRegion: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-west-2',
  },
} as const;

export function assertSalesforceAuthConfig(): void {
  const mode = config.salesforce.authMode;
  if (mode === 'token') {
    required('SF_ACCESS_TOKEN', config.salesforce.accessToken);
    required('SF_INSTANCE_URL', config.salesforce.instanceUrl);
    return;
  }
  if (mode === 'refresh') {
    required('SF_CLIENT_ID', config.salesforce.clientId);
    required('SF_CLIENT_SECRET', config.salesforce.clientSecret);
    required('SF_REFRESH_TOKEN', config.salesforce.refreshToken);
    return;
  }
  required('SF_USERNAME', config.salesforce.username);
  required('SF_PASSWORD', config.salesforce.password);
  if (mode === 'oauth') {
    required('SF_CLIENT_ID', config.salesforce.clientId);
    required('SF_CLIENT_SECRET', config.salesforce.clientSecret);
  }
}

export function assertMambuConfig(): void {
  required('MAMBU_BASE_URL', config.mambu.baseUrl);
  required('MAMBU_API_KEY', config.mambu.apiKey);
}
