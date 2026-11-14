// S3 helpers. Presigned URLs let the browser upload/download directly to S3
// without streaming files through the API.

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from './clients.js';
import { config } from '../config.js';

function requireBucket(): string {
  if (!config.aws.uploadsBucket) {
    throw new Error('UPLOADS_BUCKET is not configured');
  }
  return config.aws.uploadsBucket;
}

export async function getUploadUrl(key: string, contentType: string, expiresIn = 300) {
  const command = new PutObjectCommand({ Bucket: requireBucket(), Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn });
}

export async function getDownloadUrl(key: string, expiresIn = 300) {
  const command = new GetObjectCommand({ Bucket: requireBucket(), Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}
