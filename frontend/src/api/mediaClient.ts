import { mediaObjectKey, validateCompleteMediaUploadRequest, validateCreateMediaUploadRequest, type CompleteMediaUploadResponse, type CreateMediaUploadRequest, type CreateMediaUploadResponse, type MediaPlaybackResponse, type StoredAudioReference } from '@runman/shared';
import type { CassetteToken } from './cassetteClient';

export interface MediaAccount { owner: string; generation: number }
export interface MediaApi {
  createUpload(account: MediaAccount, input: CreateMediaUploadRequest, signal?: AbortSignal): Promise<CreateMediaUploadResponse>;
  complete(account: MediaAccount, mediaId: string, signal?: AbortSignal): Promise<CompleteMediaUploadResponse>;
  playback(account: MediaAccount, mediaId: string, signal?: AbortSignal): Promise<MediaPlaybackResponse>;
}
export class MediaApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function exact(value: unknown, fields: string[]): value is Record<string, unknown> { return object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','); }
const invalid = (): never => { throw new MediaApiError(502, 'The server returned invalid private audio data. Your local audio was kept.'); };
function expires(value: unknown, now: number): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value || Date.parse(value) <= now || Date.parse(value) > now + 300_000) return invalid();
  return value;
}
function s3Location(value: unknown, key?: string): URL {
  if (typeof value !== 'string' || value.length > 16_384) return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.protocol !== 'https:' || !/^s3\.us-(?:west-2|east-1)\.amazonaws\.com$/.test(url.hostname) || url.username || url.password || url.port || url.hash) return invalid();
  const parts = url.pathname.split('/'); const bucket = parts[1];
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) return invalid();
  if (key === undefined ? ![`/${bucket}`, `/${bucket}/`].includes(url.pathname) : url.pathname !== `/${bucket}/${key}`) return invalid();
  return url;
}
export function checkedMediaReference(value: unknown, account: MediaAccount, mediaId: string, expected?: CreateMediaUploadRequest): StoredAudioReference {
  if (!exact(value, ['source', 'objectKey', 'contentType', 'sizeBytes']) || value.objectKey !== mediaObjectKey(account.owner, mediaId)) return invalid();
  const checked = validateCreateMediaUploadRequest({ source: value.source, contentType: value.contentType, sizeBytes: value.sizeBytes, sha256: expected?.sha256 ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
  if (!checked.ok || (expected && (value.source !== expected.source || value.contentType !== expected.contentType || value.sizeBytes !== expected.sizeBytes))) return invalid();
  return { source: checked.value.source, objectKey: value.objectKey as string, contentType: checked.value.contentType, sizeBytes: checked.value.sizeBytes };
}
function uploadResponse(value: unknown, account: MediaAccount, input: CreateMediaUploadRequest, now: number): CreateMediaUploadResponse {
  if (!exact(value, ['mediaId', 'upload']) || !validateCompleteMediaUploadRequest({ mediaId: value.mediaId }).ok || !exact(value.upload, ['url', 'fields', 'expiresAt'])) return invalid();
  const mediaId = value.mediaId as string; const upload = value.upload;
  const location = s3Location(upload.url);
  if (location.search || !object(upload.fields)) return invalid();
  const fields = upload.fields;
  const allowed = ['key', 'bucket', 'Content-Type', 'x-amz-checksum-algorithm', 'x-amz-checksum-sha256', 'x-amz-server-side-encryption', 'success_action_status', 'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Security-Token', 'X-Amz-Signature', 'Policy'];
  if (Object.keys(fields).length > allowed.length || Object.entries(fields).some(([key, field]) => !allowed.includes(key) || typeof field !== 'string' || field.length > 32_768 || /[\u0000-\u001f\u007f]/.test(field))) return invalid();
  const required: Record<string, string> = { key: mediaObjectKey(account.owner, mediaId), bucket: location.pathname.split('/')[1], 'Content-Type': input.contentType, 'x-amz-checksum-algorithm': 'SHA256', 'x-amz-checksum-sha256': input.sha256, 'x-amz-server-side-encryption': 'AES256', success_action_status: '204', 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256' };
  for (const [key, field] of Object.entries(required)) if (fields[key] !== field) return invalid();
  for (const key of ['Policy', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Signature']) if (typeof fields[key] !== 'string' || !fields[key]) return invalid();
  const expiry = expires(upload.expiresAt, now);
  try {
    const policy: unknown = JSON.parse(atob(fields.Policy as string));
    if (!object(policy) || typeof policy.expiration !== 'string' || Date.parse(policy.expiration) !== Date.parse(expiry) || !Array.isArray(policy.conditions) || policy.conditions.length > 32) return invalid();
    const conditions = policy.conditions;
    const matches = (key: string, field: string) => conditions.some((condition: unknown) => object(condition) && condition[key] === field || Array.isArray(condition) && condition.length === 3 && condition[0] === 'eq' && condition[1] === `$${key}` && condition[2] === field);
    for (const [key, field] of Object.entries(required)) if (!matches(key, field)) return invalid();
    if (!conditions.some((condition: unknown) => Array.isArray(condition) && condition.length === 3 && condition[0] === 'content-length-range' && condition[1] === input.sizeBytes && condition[2] === input.sizeBytes)) return invalid();
  } catch { return invalid(); }
  return { mediaId, upload: { url: upload.url as string, fields: { ...fields } as Record<string, string>, expiresAt: expiry } };
}

export function createMediaApi(options: { baseUrl: string; currentAccount(): MediaAccount | null; accessToken(): Promise<CassetteToken | null>; fetcher?: typeof fetch; now?: () => number }): MediaApi {
  const fetcher = options.fetcher ?? fetch; const now = options.now ?? Date.now;
  function guard(account: MediaAccount, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('Audio request canceled.', 'AbortError');
    const active = options.currentAccount();
    if (!active || active.owner !== account.owner || active.generation !== account.generation) throw new MediaApiError(401, 'Your account changed. Sign in before using private audio.');
  }
  async function request(account: MediaAccount, path: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    guard(account, signal);
    let access: CassetteToken | null;
    try { access = await options.accessToken(); } catch { guard(account, signal); throw new MediaApiError(401, 'Your session could not be refreshed. Your local audio was kept.'); }
    guard(account, signal);
    if (!access || access.sub !== account.owner || !access.token || !Number.isFinite(access.expiresAt) || access.expiresAt * 1000 <= now()) throw new MediaApiError(401, 'Sign in before using private audio.');
    let response: Response;
    try { response = await fetcher(`${options.baseUrl}/api/media/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.token}` }, body: JSON.stringify(input), signal, cache: 'no-store', credentials: 'omit' }); }
    catch { guard(account, signal); throw new MediaApiError(0, 'The audio request could not be confirmed. Your local audio was kept.'); }
    guard(account, signal);
    const body: unknown = await response.json().catch(() => null);
    guard(account, signal);
    if (!response.ok) throw new MediaApiError(response.status, object(body) && typeof body.error === 'string' && body.error.length <= 1000 ? body.error : `Audio request failed (${response.status}).`);
    return body;
  }
  function selector(mediaId: string) { const checked = validateCompleteMediaUploadRequest({ mediaId }); if (!checked.ok) throw new MediaApiError(400, 'Invalid private audio ID.'); return checked.value; }
  return {
    async createUpload(account, input, signal) {
      const checked = validateCreateMediaUploadRequest(input);
      if (!checked.ok) throw new MediaApiError(400, 'Invalid private audio upload metadata.');
      return uploadResponse(await request(account, 'uploads', checked.value, signal), account, checked.value, now());
    },
    async complete(account, mediaId, signal) {
      const body = await request(account, 'complete', selector(mediaId), signal);
      if (!exact(body, ['reference'])) return invalid();
      return { reference: checkedMediaReference(body.reference, account, mediaId) };
    },
    async playback(account, mediaId, signal) {
      const body = await request(account, 'playback', selector(mediaId), signal);
      if (!exact(body, ['url', 'expiresAt'])) return invalid();
      const location = s3Location(body.url, mediaObjectKey(account.owner, mediaId));
      const version = location.searchParams.get('versionId');
      if (!version || version === 'null' || version.length > 1024 || /[\u0000-\u001f\u007f]/.test(version)) return invalid();
      return { url: body.url as string, expiresAt: expires(body.expiresAt, now()) };
    },
  };
}
