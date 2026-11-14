# Audio storage integration

Private audio uses the existing Cognito user-pool session and authenticated
`/api/media` endpoints. The browser hashes the original file with WebCrypto,
requests an upload intent, sends a presigned multipart form directly to S3, then
asks the backend to verify and finalize it. Only verified completion returns a
durable `StoredAudioReference`. No identity pool, browser AWS credential provider,
Amplify Storage configuration, or new frontend dependency is required.

See [the integration handoff](../../../S3_IMPLEMENTATION.md) and
[manual console setup](../../../S3_CONSOLE_SETUP.md). Code builds and offline tests
do not establish live S3 permissions; the user performs deployment and live checks.

## Editor and recorder

`components/AudioInput.tsx` provides file selection, microphone recording, local
preview, upload progress/cancellation, completion retry, and explicit adoption:

```tsx
<AudioInput
  key={cassetteId}
  cassetteId={cassetteId}
  onUploaded={(reference) => addAudioToDraft(reference)}
/>
```

The callback synchronously adopts the reference and must be idempotent by object
key. Cassette Save remains a separate action. Failed adoption or saving preserves
the reference and draft. Failed verification can retry the same media ID without
re-uploading. A new clip deliberately abandons that local retry handle.

Without a cassette ID/callback, preview remains local. Signed-out users can preview
but cannot upload. Original blobs are retained on failure, with no conversion or
extension guessing. Audio must be nonempty, at most 25,000,000 bytes, have a
supported canonical MIME/codec and be playable according to the browser. Hashes
cover the original bytes; only MIME metadata is normalized before signing.
These checks do not guarantee arbitrary bytes decode successfully.

`recordAudio.ts` releases microphone streams on cancellation/unmount, including
late permission grants. Browser permission prompts cannot be dismissed by code.
Local preview object URLs are revoked on clip change/unmount. Account-context
changes synchronously cancel work and clear audio; operation counters reject late
callbacks even when React reuses a component. A same-account relogin is a new context.

## Adapter and playback

```ts
import { audioStorage } from '@/audio/apiAudioStorage';

const task = audioStorage.upload({
  cassetteId,
  data: fileOrRecordingBlob,
  source: 'upload', // 'recording' for microphone clips
  onProgress: ({ transferredBytes, totalBytes }) => {},
});
const reference = await task.result;
// On a verification failure, retain this task and check canRetryCompletion().
// await task.retryCompletion() retries finalization, not transfer.
const { url, expiresAt } = await audioStorage.playback(cassetteId, reference);
```

Only the durable reference belongs in drafts or saved tapes. Signed forms, tokens
and playback URLs stay in memory. `api.media` obtains a fresh access token for
each request and checks account generation before/after asynchronous work. Direct
S3 POST uses form fields, without a Cognito Authorization header or a manually
set multipart Content-Type. The browser validates S3 destinations and response
metadata before sending bytes or accepting references.

Grant duration is validated against AWS signing timestamps, avoiding comparisons
between Lambda's and the browser's wall clocks. Playback `expiresAt` from the
client is a conservative browser-local cache deadline based on request start,
signed duration and one second of timestamp rounding. S3 enforces actual expiry.
Terminal failures show a persistent, copyable diagnostic panel with safe API/media
codes and a bounded S3 range probe; no bearer grants or raw errors are included.

The backend owns keys `private/<verified user sub>/media/<server UUID>`, enforces
ownership, and pins a finalized S3 version. Cassette ID remains an editor-context
argument, not part of the S3 key: same-owner cassette copies can reuse references.
Old identity-pool keys require re-upload; they are not silently reinterpreted.

`useTapeDeck` renews private URLs near expiry on play/resume/active seek and retries
one URL renewal after a media error. Paused seeking never starts playback. The
in-memory playback controller cancels superseded requests and rejects stale
results, including replacement audio under an existing track ID. Account changes
and unmount clear sources and invalidate the cache. Signed URLs remain bearer
capabilities until expiry; never log, persist or share them.

## Retention and verification

There is no physical delete API, `removeUnused`, garbage collection or lifecycle
expiry. Cancelled transfers may leave bytes; forgetting a local upload, removing
a track or deleting a cassette does not delete S3 objects. The UI states this.
Never expire noncurrent versions: saved tapes depend on pinned versions.

Run `npm run test:audio` for offline client, orchestration, recorder, context and
playback tests. Live checks still require deployed code and user sessions:
upload/save/reload/play, target-browser recording, URL renewal, cancellation,
verification retry, and second-account denial. Never provide real tokens or
temporary AWS credentials to tests or chat.
