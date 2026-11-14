# S3 audio integration handoff

## Goal and boundary
Allow signed-in users to upload/record audio, save complete tapes, reload, and play
their own audio. Work on `feat/s3-integration`, which includes the cassette PR's
code. **Checkpoints 1–3 are complete locally, the user has deployed the backend,
and the user confirms upload/save/reload/play works.** Additional live checks
remain below. The user makes all AWS
console changes. Agents must not provision or modify AWS resources.

Reuse the existing Cognito access-token middleware, Express/Lambda, LabRole,
DynamoDB cassette table, audio recorder, upload UI, and deck. Replace the obsolete
identity-pool/browser-credential adapter; do not add an identity pool or custom role.
Keep the separate audio-storage worktree untouched. Preserve the uncommitted
`backend/.env.example` edit; new configuration examples need a separate file.

## Architectural decisions
- Separate private bucket configured by `PRIVATE_AUDIO_BUCKET`, in `us-west-2`.
  Existing `UPLOADS_BUCKET` remains Explore's public catalog. Block Public Access,
  enable versioning and SSE-S3; user verifies existing LabRole permissions later.
- Server creates keys `private/<verified Cognito sub>/media/<server UUID>`.
  Clients never choose owner, bucket, object key, S3 version, or READY state.
- Reuse the current table: `PK=USER#<verified sub>`, `SK=MEDIA#<mediaId>`.
  Media entries coexist with `CASSETTE#` items and never appear in cassette queries.
  Ledger stores pending/ready state, exact bytes/type/SHA-256, source, key,
  timestamps/intent expiry and, on completion, the pinned non-null S3 VersionId.
- Keep `StoredAudioReference` compatible. It is a selector, not authorization;
  resolve owner/key/type/size/source against the server ledger. Same-owner tape
  copies can share media; do not bind files exclusively to cassette IDs. Reject
  foreign-owner or old identity-pool keys unless separately migrated by re-upload.
- Upload uses a short-lived presigned POST: exact key, MIME, SHA-256 fields, and
  exact byte-size policy bounded to **1–25,000,000 bytes**. Browser uploads directly
  to S3, not through Lambda. Signed forms are scoped bearer grants kept in memory;
  no general AWS credential provider is configured in the browser.
- Completion checks the actual object with server-side HeadObject/checksum
  retrieval, validates size/type/checksum, captures a real VersionId and conditionally
  marks the media READY. Missing/null versions fail closed. READY completion is
  idempotent and never repins a later object version.
- Playback and cassette-save existence checks use that pinned version, not latest
  key content. Replaying an upload grant cannot replace validated playback bytes.
  Saved references contain no signed URLs, form fields, tokens, or file bytes.
- No physical deletion, GC, TTL, or lifecycle expiry in the initial integration.
  In particular, expiring noncurrent versions could remove pinned audio. Track
  removal/cassette deletion remain metadata-only. Orphan storage is retained and
  explained until a separate attachment/deletion design is approved.
- Immutable READY records and no app deletion avoid attachment/cleanup races
  without a 101-action transaction for a 100-track cassette. Keep the current
  100-track total limit. Never remove the private-audio save guard before backend
  ownership, READY state and pinned-object checks are connected.
- MIME/checksum checks establish metadata/integrity, not that arbitrary bytes
  decode as audio. Preserve browser format checks, progress, cancellation, local
  preview, failed-save references, account-generation guards and URL renewal.

## Approval-gated checkpoints
1. **Complete locally — contracts only:** typed upload-intent, completion and playback
   requests/responses, internal media ledger, validation/key/version rules, and
   focused offline tests. Strictly reject client ownership/server fields. No SDK
   calls, dependencies, frontend changes, or AWS operations.
2. **Complete locally — backend:** authenticated routes, S3 helpers and media repository with injected
   offline tests. Validate private references during cassette save; issue playback
   grants only for owned READY media. Preserve conditional cassette revisions and
   read-only/public Explore namespace boundaries. Never fetch caller-provided URLs.
3. **Complete locally — frontend:** replace the identity-pool adapter with authenticated API + direct
   upload, completion and playback. Maintain existing AudioInput/deck behavior,
   source types and durable references. Handle logout and late results safely;
   report retained uploads honestly rather than claiming physical cleanup.
4. **Manual deployment preparation:** versioned private bucket, exact CORS,
   required LabRole S3/version permissions, Lambda variables/routes, packaging and
   console instructions. User performs changes; stop if lab permissions deny them.
5. **Live checks with user sessions:** upload/save/reload/play/URL renewal, private
   two-account denial, invalid size/type/checksum, incomplete uploads, retries and
   replay preserving the finalized version. Agent and user-run results must be
   attributed separately; do not request credentials or tokens in chat.

Explore publication and `source: community` cloud persistence are separate work;
keep those tracks locally with explicit errors until their contract is integrated.
Agents made no AWS resource changes. The user deployed the backend and runs the
frontend locally. Frontend upload/playback code is connected; remaining live checks
are recorded below.

## Checkpoint 1 pickup
`shared/src/index.ts` exports `mediaPersistence.ts` and `mediaValidation.ts`.
The implemented endpoints are POST `/api/media/uploads` with
`{source,contentType,sizeBytes,sha256}` and POST `/api/media/complete` /
`/api/media/playback` with exactly `{mediaId}`.
Upload responses contain a transient nested `upload:{url,fields,expiresAt}` grant;
completion returns `StoredAudioReference`; playback returns a temporary URL/expiry.

Pure validators cover those client requests and the PENDING/READY internal ledger.
They reject unknown/server-owned fields, accessor/non-JSON input, malformed UUIDs,
noncanonical checksum/MIME, invalid byte counts, owner/key mismatches, invalid
versions and time ordering. Requests are bounded to 4 KiB and ledger records to
16 KiB. `mediaObjectKey` / `parseMediaObjectKey` provide structural helpers only.
Response grant validation, authentication, S3 verification and conditional READY
transitions are implemented separately in checkpoint 2; validators alone do not prove them.

Media intent expiry is 1–300 seconds after creation. A READY record may be read
after that deadline; completion retries must return its original pinned version.
Future browser integration must deliberately canonicalize MIME parameters before
signing and send the identical canonical value to S3. Original browser forms may
contain spacing that is not accepted as canonical contract input.

Run `npm run test:media` for the focused contract suite. The obsolete frontend
adapter was replaced in checkpoint 3. Types alone do not perform uploads.

Validation passed: 12 media contract tests, 18 cassette regression tests, root
typecheck (including Amplify definitions), production build, and diff checks.
The existing frontend bundle-size/dynamic-import warnings remain. Architect review
found no remaining contract blockers. No AWS operations, new dependencies, or
frontend/API behavior changes occurred; the user's env-example edit is untouched.
That checkpoint introduced contracts only; backend integration is described below.

## Checkpoint 2 pickup
- `backend/src/routes/media.ts` exposes the three POST endpoints using the existing
  Cognito access-token verifier before the 4 KiB request parser. Upload creation
  returns 201; completion/playback return 200. No client ownership fields are accepted.
- `mediaRuntime.ts` defaults disabled. Enable only after manual setup with
  `MEDIA_STORAGE_MODE=s3` and `PRIVATE_AUDIO_BUCKET`; reuse existing region, Cognito
  and cassette-table settings. See `backend/media.env.example`. DynamoDB cassette
  mode is required; the private bucket must differ from public `UPLOADS_BUCKET`.
  No startup AWS requests or production memory fallback are introduced.
- `mediaService.ts` coordinates the ledger and S3 ports. `aws/dynamoMedia.ts` uses
  consistent owner-scoped reads and conditional writes. Completion checks latest
  metadata, checks the captured version, then conditionally finalizes READY.
  Concurrent completion returns the validated winner; retries cannot repin bytes.
- `aws/privateMedia.ts` uses SDK v3 presigned POST (new runtime dependency
  `@aws-sdk/s3-presigned-post`), checksum-enabled HEAD, and version-specific GET.
  It requires bucket versioning Enabled and bounds grants by five minutes, intent
  deadline where applicable, and known signing-credential expiry. Signing uses a
  resolved credential snapshot. No general credentials reach the browser.
- Cassette Save/get/list authorize every private reference against its owner's
  READY ledger and pinned object. Foreign keys and mismatched reference metadata
  fail before S3 access. Same-owner copies may reuse media. Jamendo-only saves
  continue when media is disabled. Existing revision checks remain unchanged.
- List authorization runs at most four checks concurrently with a budget of 100
  distinct files per response. Pages stop at whole-cassette boundaries; continuation
  follows the last returned cassette so remaining items are not skipped.
- No physical deletion, GC or expiry rules were added. No frontend code changed,
  live Lambda was not deployed, and actual LabRole/S3 permissions remain unverified.
  The user-edited `backend/.env.example` remains outside the commit.

Validation: 26 media API/storage tests, 12 media contracts, 23 cassette frontend,
18 cassette contracts, 16 cassette API, 10 legacy boundary, 6 Explore, and 3 package
tests passed offline (114 total). Root typecheck and production build passed.
The generated Lambda ZIP passed its offline smoke with media configured: health
200, unauthenticated cassette/media routes 401, legacy routes 404, zero AWS network
requests. Existing frontend bundle warnings remain. Architect review found no
remaining checkpoint blockers; live behavior is reserved for checkpoint 5.

## Checkpoint 3 pickup
- `frontend/src/api/mediaClient.ts` implements `api.media` with fresh Cognito access
  tokens, no-store requests, account-generation guards and strict response checks.
  It validates scoped S3 destinations, policy metadata, expiry, pinned playback
  URLs and returned references before the browser uses them.
- `audio/apiAudioStorage.ts` composes the API with WebCrypto and abortable XHR
  multipart upload from `audioTransport.ts`. No new dependencies, identity pool,
  browser AWS provider or Amplify Storage configuration. The old
  `amplifyAudioStorage.ts` is removed. SHA-256 covers original bytes; MIME/codec
  metadata is canonicalized without converting audio.
- `audio/audioStorage.ts` exposes the existing upload/playback interface. An upload
  resolves only after server completion. Ambiguous verification failures retain
  the media ID for `retryCompletion()` without another transfer. Expired/rejected
  intents allow a new upload; cancellation may still leave private bytes.
- `auth/mediaContextStore.ts` tracks account generations independently of cassette
  state. Leaving a confirmed session, switching accounts, or same-owner relogin
  invalidates old work; passive same-owner refresh does not.
- `AudioInput` retains clips on failure, offers verification retry and explicit
  adoption, cancels late callbacks and microphone work, and clears audio on account
  changes. Track adoption is idempotent by object key. Forgetting is local only.
- `audio/playbackController.ts` caches URLs only in memory, aborts superseded
  requests and distinguishes replacements under the same track ID. `useTapeDeck`
  renews on play/resume/active seek near expiry and retries one renewal after a
  private-media error. Paused seek does not start playback. Unload/account changes
  clear sources and pending requests. No signed capability is saved in a draft.
- `frontend/src/audio/README.md` describes interfaces and retention. The user's
  requested [S3 console setup steps](S3_CONSOLE_SETUP.md) are prepared. They do not
  claim deployment or live verification. Existing backend environment edits and
  the separate audio-storage worktree remain untouched.

Validation: all 96 focused frontend tests passed (33 audio/client/recorder/playback,
30 authentication, 9 account, 24 cassette client/store), along with root typecheck
and production build. The actual SDK-generated offline upload grant is accepted;
policy expiry and API expiry are compared as instants despite different timestamp
formats. Architect review found no remaining blockers. Existing frontend bundle
size/dynamic-import warnings remain. These results do not cover actual browser
microphone/media behavior, S3 access, or a deployed frontend/backend.

## Deployment and merge verification — 2026-11-14

- The user followed the console guide, deployed the Lambda package, and attached
  all three media POST routes to Lambda in API Gateway. The frontend runs locally.
- Agent-run unsigned HTTP checks against the configured API passed: health 200,
  all three media routes 401, preflight 204 with localhost origin, POST and the
  Authorization/Content-Type headers allowed. These establish routing/auth/CORS,
  not authenticated S3 access.
- After those checks, the user confirms the instructed upload → add to cassette →
  save → reload → play flow works. This is user-reported verification; the agent
  did not receive tokens or independently inspect private S3 objects/ledger rows.
- Additional live checks remain: target-browser microphone recording, URL renewal,
  cancellation, verification retry, two-account private-reference denial, and
  invalid upload/replay/version cases. The earlier offline tests cover these
  service boundaries but do not replace deployed checks. Never request credentials
  or bearer grants in chat.
- Local `main` was fast-forwarded to `origin/main` at `88973c8`, then merged into
  `feat/s3-integration` without conflicts. Upstream autosave, visibility controls
  and custom stickers are preserved. Visibility/publication calls remain upstream
  stubs; this private-audio work does not publish audio to Explore.
- Post-merge validation passed: root typecheck, production build and 133 tests
  (33 audio, 27 cassette frontend, 19 cassette schema, 16 cassette API, 26 media API,
  12 media contracts). Existing frontend build warnings remain. The user's backend
  env-example edit is unchanged and excluded from commits.

The user performs any further console changes; agents must not provision or
modify resources. Do not claim the remaining live checks have passed.

## Sources
AWS [POST fields](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/RESTObjectPOST.html)
and [POST policies](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html)
document checksum and byte-range constraints. [GetObject versions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
require the appropriate version-read permission. Existing presigned links may be
reused until expiry; see [AWS presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
