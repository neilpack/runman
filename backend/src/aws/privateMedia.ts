import { GetBucketVersioningCommand, GetObjectCommand, HeadObjectCommand, S3Client, type GetBucketVersioningCommandOutput, type HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import { createPresignedPost, type PresignedPostOptions } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MEDIA_LIMITS, parseMediaObjectKey, validateMediaLedger } from '@runman/shared';
import { s3 } from './clients.js';
import type { PendingMedia, PrivateMediaStorage, ReadyMedia } from '../services/mediaStorage.js';

interface Dependencies {
  client?: S3Client;
  now?: () => number;
  head?: (command: HeadObjectCommand) => Promise<HeadObjectCommandOutput>;
  versioning?: (command: GetBucketVersioningCommand) => Promise<GetBucketVersioningCommandOutput>;
  post?: typeof createPresignedPost;
  signGet?: (client: S3Client, command: GetObjectCommand, options: { expiresIn: number; signingDate: Date }) => Promise<string>;
}

/** Bound exclusively to trusted server configuration, never caller bucket/URL input. */
export function createPrivateMediaStorage(bucket: string, deps: Dependencies = {}): PrivateMediaStorage {
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..') || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(bucket)) throw new Error('Invalid private bucket.');
  const client = deps.client ?? s3;
  const now = deps.now ?? Date.now;
  const head = deps.head ?? ((command: HeadObjectCommand) => client.send(command));
  const versioning = deps.versioning ?? ((command: GetBucketVersioningCommand) => client.send(command));
  const post = deps.post ?? createPresignedPost;
  const signGet = deps.signGet ?? ((signer: S3Client, command: GetObjectCommand, options: { expiresIn: number; signingDate: Date }) => getSignedUrl(signer, command, options));
  function checked<T extends PendingMedia | ReadyMedia>(record: T): T {
    if (!validateMediaLedger(record).ok) throw new Error('Invalid private media record.');
    return record;
  }
  async function signing(deadline = Infinity) {
    // Resolve once: lifetime calculations and signing must use the same credentials.
    const credentials = await client.config.credentials();
    const region = await client.config.region();
    if (!['us-west-2', 'us-east-1'].includes(region)) throw new Error('Unsupported media region.');
    const created = now();
    const credentialExpiry = credentials.expiration?.getTime() ?? Infinity;
    const limit = Math.min(deadline, created + MEDIA_LIMITS.intentSeconds * 1000, credentialExpiry);
    const seconds = Math.floor((limit - created) / 1000);
    if (!Number.isFinite(created) || Number.isNaN(limit) || seconds < 1) throw new Error('Signing credentials or grant window expired.');
    // Static credentials prevent a second provider resolution/rotation during signing.
    // This client only signs; network reads reuse the existing shared S3 client.
    const signer = new S3Client({ region, credentials, forcePathStyle: true });
    return { signer, region, created, limit, seconds };
  }
  function location(value: string, region: string, key?: string) {
    const url = new URL(value);
    const expected = `/${bucket}${key ? `/${key}` : ''}`;
    if (url.protocol !== 'https:' || url.hostname !== `s3.${region}.amazonaws.com` || url.port || url.username || url.password || url.hash || (url.pathname !== expected && !(key === undefined && url.pathname === `${expected}/`))) throw new Error('Unexpected signed media location.');
    return url;
  }
  return {
    async versioningEnabled() {
      return (await versioning(new GetBucketVersioningCommand({ Bucket: bucket }))).Status === 'Enabled';
    },
    async createUpload(input) {
      const record = checked(input);
      if (record.state !== 'PENDING') throw new Error('Upload grant requires pending media.');
      const grant = await signing(Date.parse(record.expiresAt));
      const fields = {
        'Content-Type': record.contentType,
        'x-amz-checksum-algorithm': 'SHA256',
        'x-amz-checksum-sha256': record.sha256,
        'x-amz-server-side-encryption': 'AES256',
        success_action_status: '204',
      };
      const options: PresignedPostOptions = {
        Bucket: bucket, Key: record.objectKey, Fields: fields, Expires: grant.seconds,
        Conditions: [
          { bucket }, { key: record.objectKey },
          ['content-length-range', record.sizeBytes, record.sizeBytes],
          ...Object.entries(fields).map(([key, value]) => ({ [key]: value })),
        ],
      };
      const result = await post(grant.signer, options);
      const url = location(result.url, grant.region);
      if (url.search) throw new Error('Unexpected upload query.');
      // The SDK timestamps POST policies itself. Inspect the actual signed expiry,
      // rather than assuming it is identical to our earlier clock sample.
      if (!result.fields || Object.keys(result.fields).length > 32 || Object.values(result.fields).some(value => typeof value !== 'string' || value.length > 32_768)) throw new Error('Invalid signed form.');
      for (const [key, value] of Object.entries({ ...fields, key: record.objectKey, bucket })) if (result.fields[key] !== value) throw new Error('Signed form metadata mismatch.');
      const policy: unknown = JSON.parse(Buffer.from(result.fields.Policy ?? '', 'base64').toString('utf8'));
      if (!policy || typeof policy !== 'object' || !('expiration' in policy) || typeof policy.expiration !== 'string') throw new Error('Invalid signed policy.');
      const expires = Date.parse(policy.expiration);
      if (!Number.isFinite(expires) || expires <= now() || expires > grant.limit) throw new Error('Signed policy exceeds its authorized window.');
      return { url: result.url, fields: result.fields, expiresAt: new Date(expires).toISOString() };
    },
    async head(objectKey, versionId) {
      if (!parseMediaObjectKey(objectKey)) throw new Error('Invalid private media key.');
      if (versionId !== undefined && (!versionId.trim() || versionId === 'null' || versionId !== versionId.trim() || versionId.length > MEDIA_LIMITS.versionId || /[\u0000-\u001f\u007f]/.test(versionId))) throw new Error('Invalid media version.');
      try {
        const object = await head(new HeadObjectCommand({ Bucket: bucket, Key: objectKey, VersionId: versionId, ChecksumMode: 'ENABLED' }));
        return { versionId: object.VersionId, sizeBytes: object.ContentLength, contentType: object.ContentType, sha256: object.ChecksumSHA256 };
      } catch (error) {
        const missing = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (missing?.name === 'NotFound' || missing?.name === 'NoSuchKey' || missing?.name === 'NoSuchVersion' || missing?.$metadata?.httpStatusCode === 404) return;
        throw error;
      }
    },
    async playback(input) {
      const record = checked(input);
      if (record.state !== 'READY') throw new Error('Playback requires ready media.');
      const grant = await signing();
      const url = await signGet(grant.signer, new GetObjectCommand({ Bucket: bucket, Key: record.objectKey, VersionId: record.versionId, ResponseContentType: record.contentType, ResponseCacheControl: 'no-store' }), { expiresIn: grant.seconds, signingDate: new Date(grant.created) });
      const parsed = location(url, grant.region, record.objectKey);
      if (parsed.searchParams.get('versionId') !== record.versionId) throw new Error('Playback grant is not version-pinned.');
      return { url, expiresAt: new Date(grant.created + grant.seconds * 1000).toISOString() };
    },
  };
}
