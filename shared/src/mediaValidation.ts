import type { CassetteValidationIssue } from './cassettePersistence.js';
import { MEDIA_LIMITS, type CompleteMediaUploadRequest, type CreateMediaUploadRequest, type MediaLedger, type MediaPlaybackRequest, type MediaValidationResult } from './mediaPersistence.js';

const ownerPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const mimePattern = /^audio\/(?:mpeg|mp3|mp4|aac|x-m4a|wav|wave|x-wav|ogg|webm|flac)(?:;codecs=[a-z0-9][a-z0-9._-]{0,39}(?:,[a-z0-9][a-z0-9._-]{0,39})*)?$/;
// 32 bytes encode to 43 data characters + '='. The final sextet's low two
// padding bits must be zero; this rejects noncanonical aliases without Buffer.
const sha256Pattern = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const intentFields = ['source', 'contentType', 'sizeBytes', 'sha256'];
const ledgerFields = ['schemaVersion', 'PK', 'SK', 'owner', 'mediaId', 'objectKey', 'state', ...intentFields, 'createdAt', 'expiresAt'];

/** These helpers validate structure only. They do not establish authorization. */
export function mediaObjectKey(owner: string, mediaId: string): string {
  if (typeof owner !== 'string' || typeof mediaId !== 'string' || !ownerPattern.test(owner) || !uuidPattern.test(mediaId)) throw new Error('Invalid media owner or UUID.');
  return `private/${owner}/media/${mediaId}`;
}
export function parseMediaObjectKey(value: string): { owner: string; mediaId: string } | undefined {
  if (typeof value !== 'string') return;
  const parts = value.split('/');
  if (parts.length !== 4 || parts[0] !== 'private' || parts[2] !== 'media' || !ownerPattern.test(parts[1]) || !uuidPattern.test(parts[3])) return;
  return { owner: parts[1], mediaId: parts[3] };
}

class Check {
  issues: CassetteValidationIssue[] = [];
  fail(path: string, message: string) { this.issues.push({ path, message }); }
  fields(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      this.fail('$', 'Expected a plain JSON object.'); return;
    }
    const object = value as Record<string, unknown>;
    for (const key of required) if (!Object.hasOwn(object, key)) this.fail(key, 'Required field.');
    for (const key of Reflect.ownKeys(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      if (typeof key !== 'string' || ![...required, ...optional].includes(key)) this.fail(String(key), 'Unknown or server-owned field.');
      else if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) this.fail(key, 'Expected an enumerable JSON data field.');
    }
    // Never read getters, even on otherwise plain input objects.
    if (this.issues.length) return;
    return object;
  }
  intent(value: Record<string, unknown>) {
    if (typeof value.source !== 'string' || !['upload', 'recording'].includes(value.source)) this.fail('source', 'Expected upload or recording.');
    if (typeof value.contentType !== 'string' || value.contentType.length > 128 || !mimePattern.test(value.contentType)) this.fail('contentType', 'Expected a supported lowercase audio MIME, optionally ;codecs=lowercase-token[,token].');
    if (typeof value.sizeBytes !== 'number' || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > MEDIA_LIMITS.audioBytes) this.fail('sizeBytes', 'Expected an integer from 1 to 25000000.');
    if (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256)) this.fail('sha256', 'Expected canonical base64 for exactly 32 SHA-256 bytes.');
  }
  uuid(value: unknown) { if (typeof value !== 'string' || !uuidPattern.test(value)) this.fail('mediaId', 'Expected a canonical lowercase UUIDv4.'); }
  timestamp(value: unknown, path: string): number | undefined {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) { this.fail(path, 'Expected an ISO UTC timestamp with milliseconds.'); return; }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) { this.fail(path, 'Invalid timestamp.'); return; }
    return parsed;
  }
  finish<T>(value: unknown, maximum: number = MEDIA_LIMITS.requestBytes): MediaValidationResult<T> {
    if (this.issues.length) return { ok: false, issues: this.issues };
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).length > maximum) return { ok: false, issues: [{ path: '$', message: `Media metadata exceeds ${maximum} bytes.` }] };
    return { ok: true, value: JSON.parse(serialized) as T };
  }
}

export function validateCreateMediaUploadRequest(input: unknown): MediaValidationResult<CreateMediaUploadRequest> {
  const check = new Check(); const value = check.fields(input, intentFields);
  if (value) check.intent(value);
  return check.finish(input);
}
function selector<T>(input: unknown): MediaValidationResult<T> {
  const check = new Check(); const value = check.fields(input, ['mediaId']);
  if (value) check.uuid(value.mediaId);
  return check.finish(input);
}
export const validateCompleteMediaUploadRequest = (input: unknown) => selector<CompleteMediaUploadRequest>(input);
export const validateMediaPlaybackRequest = (input: unknown) => selector<MediaPlaybackRequest>(input);

/** Validates durable structure only, not S3 verification or READY immutability. */
export function validateMediaLedger(input: unknown): MediaValidationResult<MediaLedger> {
  const check = new Check();
  const value = check.fields(input, ledgerFields, ['versionId', 'completedAt']);
  if (!value) return check.finish(input, MEDIA_LIMITS.ledgerBytes);
  check.intent(value); check.uuid(value.mediaId);
  if (value.schemaVersion !== 1) check.fail('schemaVersion', 'Expected schema version 1.');
  if (typeof value.owner !== 'string' || !ownerPattern.test(value.owner)) check.fail('owner', 'Expected a bounded owner segment; verification belongs to the backend.');
  if (typeof value.owner !== 'string' || value.PK !== `USER#${value.owner}`) check.fail('PK', 'Owner partition key mismatch.');
  if (typeof value.mediaId !== 'string' || value.SK !== `MEDIA#${value.mediaId}`) check.fail('SK', 'Media sort key mismatch.');
  const parsedKey = typeof value.objectKey === 'string' ? parseMediaObjectKey(value.objectKey) : undefined;
  if (!parsedKey || parsedKey.owner !== value.owner || parsedKey.mediaId !== value.mediaId) check.fail('objectKey', 'Expected the exact private owner/media key.');
  const created = check.timestamp(value.createdAt, 'createdAt');
  const expires = check.timestamp(value.expiresAt, 'expiresAt');
  if (created !== undefined && expires !== undefined && (expires - created < 1000 || expires - created > MEDIA_LIMITS.intentSeconds * 1000)) check.fail('expiresAt', 'Upload intent must expire 1–300 seconds after creation.');
  if (value.state === 'READY') {
    if (typeof value.versionId !== 'string' || !value.versionId.trim() || value.versionId !== value.versionId.trim() || value.versionId === 'null' || value.versionId.length > MEDIA_LIMITS.versionId || /[\u0000-\u001f\u007f]/.test(value.versionId)) check.fail('versionId', 'READY requires a bounded, non-null, nonblank opaque S3 version ID.');
    const completed = check.timestamp(value.completedAt, 'completedAt');
    if (completed !== undefined && ((created !== undefined && completed < created) || (expires !== undefined && completed > expires))) check.fail('completedAt', 'Completion must be within the upload intent window; expiry is not READY lifetime.');
  } else if (value.state === 'PENDING') {
    for (const field of ['versionId', 'completedAt']) if (Object.hasOwn(value, field)) check.fail(field, 'PENDING cannot include completion fields.');
  } else check.fail('state', 'Expected PENDING or READY.');
  return check.finish(input, MEDIA_LIMITS.ledgerBytes);
}
