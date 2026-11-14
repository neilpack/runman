# Audio storage integration

This module includes the audio storage adapter and browser recorder. The dashboard offers local file/recording preview without cloud writes. Cassette persistence is not implemented here. It uses the existing application-level Amplify initialization and generated outputs, which must include both the Cognito identity pool and storage configuration after the shared backend is deployed. No separate auth configuration or Express endpoint is needed.

## Recorder and editor control

`components/AudioInput.tsx` supports file selection, microphone recording, local playback, upload progress/cancellation/retry, and explicit adoption into a cassette draft. Mount it in the editor with a stable cassette ID:

```tsx
<AudioInput
  key={cassetteId}
  cassetteId={cassetteId}
  onUploaded={(reference) => addAudioToDraft(reference)}
/>
```

The callback must synchronously adopt the reference into local draft state and be idempotent by object key. Saving to the cloud remains a separate action owned by persistence. The control does not automatically call Save. It retains completed references and original blobs if adoption fails. Before any adoption attempt, an exclusive unused upload can be discarded explicitly; once the reference is offered to the parent, deletion becomes the parent's responsibility even if the callback throws. Use a new `key` when changing cassettes so draft audio cannot cross cassette boundaries.

Omitting the cassette ID or callback gives local preview only. Recording chooses a MIME/codec supported for both recording and playback, retains final data after Stop, and rejects clips exceeding the size limit. Cancel or unmount releases the microphone, including when permission is granted after cancellation. Permission prompts themselves cannot be dismissed programmatically. Player object URLs are revoked on clip change/unmount; auth's existing keyed session subtree unmounts this control on sign-out/account changes. No authentication files were changed.

`recordAudio.ts` can also be used independently with an `AbortSignal`. Its injectable microphone/recorder boundary is covered by tests for final chunks, cancellation, pending permission, size errors, constructor/start errors, and stream release. Actual microphone/codec behavior still requires a target-browser smoke test.

## Adapter usage

```ts
import { audioStorage } from '@/audio/amplifyAudioStorage';

const task = audioStorage.upload({
  cassetteId, // stable ID allocated before uploading, also used by cassette persistence
  data: fileOrRecordingBlob,
  source: 'upload', // use 'recording' for a MediaRecorder blob with its actual MIME type
  onProgress: ({ transferredBytes, totalBytes }) => {
    // Show transferred bytes; a total is not always available.
  },
});
// task.cancel() cancels pending work, including while identity lookup is pending.
const reference = await task.result;
// Only now add reference to the draft track and allow Save cassette.
// Persist reference as-is; never persist a playback URL.
const { url, expiresAt } = await audioStorage.playback(cassetteId, reference);
```

Keep the original file/blob and draft edits when an operation rejects; show the error and let the user retry by calling upload again. Each attempt uses a new random object key. A successful SDK completion wins a late cancellation race and returns its reference, allowing the caller to retain or clean it up. Do not drop successful references on cancellation or failed cassette saves.

The browser accepts nonempty audio up to **25,000,000 bytes**, with a known audio MIME type and positive `HTMLAudioElement.canPlayType` result. Recording blobs must carry the recorder's actual MIME/codec type. There is no conversion, file-extension guessing, byte-level inspection, or guarantee every accepted file will decode. The size check is a demo guard, not an S3 security limit.

Playback URLs expire after at most five minutes (possibly sooner with credential expiry). Request a new URL when loading a track or when playback requires renewal; retain `expiresAt` only in memory. Clear player URLs and cancel pending uploads on sign-out/account switching using the authentication lifecycle. Signed URLs are bearer credentials usable until expiry; never log or share them. Client path checks supplement the backend identity-scoped IAM rules; they do not establish isolation by themselves.

Objects live at `audio/<identity-pool-id>/<cassette-id>/<random-id>`. Do not substitute the user pool `sub`, share references between cassettes, or copy an existing key into a second cassette. Duplicating a cassette requires uploading separate objects so deleting one cassette cannot break another.

Cleanup must be coordinated with persistence:

1. Finish uploads before persisting their references. Preserve pending/successful references if cassette save fails so Save can be retried.
2. For track replacement/removal, first save the revised cassette successfully. Then call `removeUnused(cassetteId, oldReference)` for references confirmed unused.
3. For cassette deletion, capture its references, successfully delete the cassette record, then remove its objects individually. Retain failed cleanup references in a retry queue; do not silently report full cleanup. Never delete files before record deletion succeeds.
4. For an abandoned draft, remove only completed uploads exclusive to that draft, after confirming no save is pending or succeeded. Never sweep by identity prefix, guess unused objects from a stale list, or clean up automatically on a save/network failure.

This adapter provides explicit scoped removal, not transactional record/file cleanup. Persistence must serialize saves/deletion or use revision checks before declaring a reference unused, and provide durable retry handling. Those features remain with the persistence/editor integration.

Run `npm run test:audio` without AWS credentials. Before marking AWS checkpoint 4 complete, deploy only with authorization, then verify: account A upload/save/reload/play; account B denied read/write/delete of A's exact key using direct SDK calls; signed-out access denied; recording playback in target browsers; URL expiry/renewal; and failed save/delete cleanup ordering. Local adapter tests do not prove deployed IAM isolation.
