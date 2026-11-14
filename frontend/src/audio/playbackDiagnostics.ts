import type { Track } from '@runman/shared';
import { MediaApiError } from '../api/mediaClient';
import { MediaPlaybackError, playbackFailureMessage } from './mediaPlayback';

export interface S3PlaybackProbe {
  outcome: 'checking' | 'reachable' | 's3-error' | 'network-or-cors' | 'canceled' | 'timeout' | 'not-run';
  status?: number;
  errorCode?: string;
  contentType?: string;
}
export interface PlaybackDiagnostic {
  diagnosticVersion: 1;
  at: string;
  stage: 'playback-url' | 'media-start' | 'media-playback';
  summary: string;
  retried: boolean;
  browser: string;
  source: Track['source'];
  contentType?: string;
  sizeBytes?: number;
  apiStatus?: number;
  apiCode?: string;
  grantTiming?: { signedDurationSeconds?: number; expiryDifferenceMs?: number; signingClockOffsetSeconds?: number };
  exception?: string;
  mediaErrorCode?: number;
  readyState?: number;
  networkState?: number;
  sourceAttached: boolean;
  s3?: S3PlaybackProbe;
}
const apiCodes = new Set(['http-error', 'response-shape', 'timestamp-invalid', 'signing-date-invalid', 'grant-expired', 'grant-window-invalid', 'destination-invalid', 'reference-invalid', 'version-invalid']);
const exceptions = new Set(['NotAllowedError', 'NotSupportedError', 'InvalidStateError', 'AbortError', 'TimeoutError', 'SecurityError', 'TypeError']);
const s3Codes = new Set(['AccessDenied', 'SignatureDoesNotMatch', 'ExpiredToken', 'InvalidToken', 'RequestTimeTooSkewed', 'NoSuchKey', 'NoSuchVersion', 'InvalidRequest', 'AuthorizationQueryParametersError', 'InvalidArgument', 'InvalidAccessKeyId', 'TokenRefreshRequired', 'RequestExpired', 'AllAccessDisabled', 'NoSuchBucket', 'PermanentRedirect', 'SlowDown', 'InternalError', 'ServiceUnavailable', 'InvalidRange']);
function bounded(value: unknown, max: number) { return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : undefined; }
function signedBounded(value: unknown, max: number) { return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= max ? value : undefined; }
function mime(value: string | undefined) { const base = value?.split(';')[0].trim().toLowerCase(); return base && /^[a-z0-9.+_-]{1,60}\/[a-z0-9.+_-]{1,60}$/.test(base) ? base : undefined; }
function browser(agent: string) {
  for (const [pattern, label] of [[/Edg\/(\d+)/, 'Edge'], [/Firefox\/(\d+)/, 'Firefox'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+).*Safari\//, 'Safari']] as const) {
    const match = agent.match(pattern); if (match) return `${label} ${match[1].slice(0, 4)}`;
  }
  return 'Unknown';
}
/** Explicit allowlist: no raw messages, stack, URL, tokens, filenames, owner or object keys. */
export function playbackDiagnostic(error: unknown, input: {
  stage: PlaybackDiagnostic['stage']; retried: boolean; track: Track;
  audio: { src: string; readyState: number; networkState: number; error: { code: number } | null };
  userAgent?: string; now?: () => Date;
}): PlaybackDiagnostic {
  const mediaCode = error instanceof MediaPlaybackError ? error.code : input.audio.error?.code;
  return {
    diagnosticVersion: 1, at: (input.now?.() ?? new Date()).toISOString(),
    stage: input.stage, summary: playbackFailureMessage(error), retried: input.retried,
    browser: browser(input.userAgent ?? ''), source: input.track.source,
    contentType: mime(input.track.audioReference?.contentType),
    sizeBytes: bounded(input.track.audioReference?.sizeBytes, 25_000_000),
    ...(error instanceof MediaApiError ? { apiStatus: bounded(error.status, 599), apiCode: apiCodes.has(error.diagnosticCode) ? error.diagnosticCode : 'unknown' } : {}),
    ...(error instanceof MediaApiError && error.grantTiming ? { grantTiming: {
      signedDurationSeconds: bounded(error.grantTiming.signedDurationSeconds, 604800),
      expiryDifferenceMs: signedBounded(error.grantTiming.expiryDifferenceMs, 604800000),
      signingClockOffsetSeconds: signedBounded(error.grantTiming.signingClockOffsetSeconds, 31536000),
    } } : {}),
    ...(error instanceof Error && exceptions.has(error.name) ? { exception: error.name } : {}),
    mediaErrorCode: bounded(mediaCode, 4), readyState: bounded(input.audio.readyState, 4),
    networkState: bounded(input.audio.networkState, 3), sourceAttached: Boolean(input.audio.src),
  };
}

/** Diagnostic GET of the same authorized object, limited to one byte when S3 honors Range. */
export async function probePlaybackSource(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<S3PlaybackProbe> {
  if (signal.aborted) return { outcome: 'canceled' };
  let target: URL;
  try { target = new URL(url); } catch { return { outcome: 'not-run' }; }
  if (target.protocol !== 'https:' || !/^s3\.us-(?:west-2|east-1)\.amazonaws\.com$/.test(target.hostname) || target.username || target.password || target.port || target.hash || !/^\/[a-z0-9.-]+\/private\/[a-zA-Z0-9_-]+\/media\/[0-9a-f-]+$/.test(target.pathname)) return { outcome: 'not-run' };
  try {
    const response = await fetcher(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
    const contentType = mime(response.headers.get('content-type') ?? undefined);
    if (response.ok) {
      await response.body?.cancel();
      return { outcome: 'reachable', status: response.status, contentType };
    }
    // Read a bounded error prefix, never the signed URL or S3 Message/RequestId.
    const reader = response.body?.getReader(); let text = '';
    if (reader) {
      try {
        const decoder = new TextDecoder(); let bytes = 0;
        while (bytes < 8192) { const chunk = await reader.read(); if (chunk.done) break; const allowed = chunk.value.subarray(0, 8192 - bytes); bytes += allowed.length; text += decoder.decode(allowed, { stream: true }); }
      } finally { await reader.cancel(); }
    }
    const code = text.match(/<Code>([A-Za-z][A-Za-z0-9]{0,63})<\/Code>/)?.[1];
    return { outcome: 's3-error', status: response.status, ...(code && s3Codes.has(code) ? { errorCode: code } : {}), contentType };
  } catch { return { outcome: signal.aborted ? 'canceled' : 'network-or-cors' }; }
}
