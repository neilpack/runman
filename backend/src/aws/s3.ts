// S3 helpers. Presigned URLs let the browser upload/download directly to S3
// without streaming files through the API.

import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
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

/** Every object key under `prefix`, following pagination. Stops at `maxKeys` as a runaway guard. */
export async function listObjectKeys(prefix: string, maxKeys = 10_000): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: requireBucket(), Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of res.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token && keys.length < maxKeys);
  return keys.slice(0, maxKeys);
}

/** Reads a small text object (e.g. a JSON manifest). Rejects anything over `maxBytes`. */
export async function getObjectText(key: string, maxBytes = 256_000): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: requireBucket(), Key: key }));
  if (res.ContentLength !== undefined && res.ContentLength > maxBytes) {
    res.Body?.transformToWebStream().cancel().catch(() => undefined);
    throw new Error(`${key} is larger than ${maxBytes} bytes`);
  }
  return (await res.Body?.transformToString('utf-8')) ?? '';
}
