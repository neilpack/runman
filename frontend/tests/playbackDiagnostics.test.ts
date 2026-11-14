import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Track } from '@runman/shared';
import { MediaApiError } from '../src/api/mediaClient';
import { MediaPlaybackError } from '../src/audio/mediaPlayback';
import { playbackDiagnostic, probePlaybackSource } from '../src/audio/playbackDiagnostics';

const url = 'https://s3.us-west-2.amazonaws.com/private-audio/private/owner/media/11111111-1111-4111-8111-111111111111?X-Amz-Signature=SECRET';
const track: Track = { id: 'SECRET', title: 'SECRET-file.mp3', artist: 'SECRET', side: 'A', durationSec: 5, source: 'upload', audioUrl: url,
  audioReference: { source: 'upload', objectKey: 'private/SECRET/media/id', sizeBytes: 123, contentType: 'audio/mpeg;filename=SECRET' } };
const audio = { src: url, readyState: 0, networkState: 3, error: { code: 4 } };
const signal = () => new AbortController().signal;

test('diagnostics allowlist excludes raw errors, stack, signed URLs, file names, owner and keys', () => {
  const error = new MediaApiError(502, `SECRET ${url}`, url); error.stack = url;
  const report = playbackDiagnostic(error, { stage: 'playback-url', retried: false, track, audio, userAgent: 'SECRET Chrome/140.0.1.2' });
  assert.equal(report.apiStatus, 502); assert.equal(report.apiCode, 'unknown');
  assert.equal(report.browser, 'Chrome 140'); assert.equal(report.contentType, 'audio/mpeg');
  assert.equal(report.mediaErrorCode, 4); assert.equal(report.sourceAttached, true);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|https:|objectKey|stack|Signature/);
});

test('reports distinguish API response validation from native decoding/network errors', () => {
  const invalid = playbackDiagnostic(new MediaApiError(502, 'unused', 'grant-expired'), { stage: 'playback-url', retried: false, track, audio });
  assert.equal(invalid.apiCode, 'grant-expired'); assert.equal(invalid.stage, 'playback-url');
  const decode = playbackDiagnostic(new MediaPlaybackError(3), { stage: 'media-start', retried: true, track, audio });
  assert.equal(decode.mediaErrorCode, 3); assert.equal(decode.summary, 'AUDIO DECODE ERROR'); assert.equal(decode.retried, true);
});

test('S3 range probe records reachable status/type, omits credentials, and cancels response audio', async () => {
  let canceled = false;
  const result = await probePlaybackSource(url, signal(), async (target, init) => {
    assert.equal(target, url); assert.equal(init?.method, 'GET'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers); assert.equal(headers.get('Range'), 'bytes=0-0'); assert.equal(headers.has('Authorization'), false);
    return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 206, headers: { 'content-type': 'audio/mpeg' } });
  });
  assert.deepEqual(result, { outcome: 'reachable', status: 206, contentType: 'audio/mpeg' }); assert.equal(canceled, true);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|https:/);
});

test('S3 denial reports only HTTP status and allowlisted XML Code, never Message or signed data', async () => {
  const result = await probePlaybackSource(url, signal(), async () => new Response('<Error><Code>SignatureDoesNotMatch</Code><Message>SECRET</Message><RequestId>SECRET</RequestId></Error>', { status: 403, headers: { 'content-type': 'application/xml' } }));
  assert.deepEqual(result, { outcome: 's3-error', status: 403, errorCode: 'SignatureDoesNotMatch', contentType: 'application/xml' });
  assert.doesNotMatch(JSON.stringify(result), /SECRET|RequestId/);
  const unknown = await probePlaybackSource(url, signal(), async () => new Response('<Code>SECRET</Code>', { status: 403 }));
  assert.equal(unknown.errorCode, undefined);
});

test('a failed or CORS-blocked probe is distinguished without leaking its exception', async () => {
  assert.deepEqual(await probePlaybackSource(url, signal(), async () => { throw new TypeError(`SECRET ${url}`); }), { outcome: 'network-or-cors' });
});

test('external destinations and already canceled work never send a probe', async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; throw new Error('Unexpected request'); };
  for (const target of ['https://attacker.example/audio', 'http://s3.us-west-2.amazonaws.com/private-audio/private/owner/media/id', 'https://s3.us-west-2.amazonaws.com/public/audio']) {
    assert.deepEqual(await probePlaybackSource(target, signal(), fetcher), { outcome: 'not-run' });
  }
  const canceled = new AbortController(); canceled.abort();
  assert.deepEqual(await probePlaybackSource(url, canceled.signal, fetcher), { outcome: 'canceled' }); assert.equal(calls, 0);
});

test('S3 error body reads are bounded and cannot extract a code hidden beyond the limit', async () => {
  const result = await probePlaybackSource(url, signal(), async () => new Response('x'.repeat(8192) + '<Code>SECRET</Code>', { status: 403 }));
  assert.equal(result.errorCode, undefined); assert.equal(result.status, 403);
});
