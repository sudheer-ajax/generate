import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config/env.js';

let client: S3Client | null = null;

export function isS3ExportEnabled(): boolean {
  return Boolean(config.export.s3Bucket);
}

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({ region: config.export.awsRegion });
  }
  return client;
}

export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const bucket = config.export.s3Bucket;
  if (!bucket) {
    throw new Error('AWS_S3_BUCKET is not configured');
  }
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export function buildS3Key(relativePath: string): string {
  const prefix = config.export.s3Prefix.replace(/\/$/, '');
  const normalized = relativePath.replace(/^\/+/, '').replace(/\\/g, '/');
  return prefix ? `${prefix}/${normalized}` : normalized;
}
