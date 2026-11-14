# S3 audio integration handoff

## Goal and boundary
Allow signed-in users to upload/record audio, save complete tapes, reload, and play
their own audio. Work on `feat/s3-integration`, which includes the cassette PR's
code. Existing live cassette saves work for Jamendo tracks. **Checkpoint 1 is
complete locally and verified; checkpoint 2 needs approval.** The user makes all AWS
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
2. **Backend:** authenticated routes, S3 helpers and media repository with injected
   offline tests. Validate private references during cassette save; issue playback
   grants only for owned READY media. Preserve conditional cassette revisions and
   read-only/public Explore namespace boundaries. Never fetch caller-provided URLs.
3. **Frontend:** replace the identity-pool adapter with authenticated API + direct
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
No existing app flow, dependency, or AWS resource has changed in checkpoint 1.

## Checkpoint 1 pickup
`shared/src/index.ts` exports `mediaPersistence.ts` and `mediaValidation.ts`.
The proposed future endpoints are POST `/api/media/uploads` with
`{source,contentType,sizeBytes,sha256}` and POST `/api/media/complete` /
`/api/media/playback` with exactly `{mediaId}`. Routes are not implemented yet.
Upload responses contain a transient nested `upload:{url,fields,expiresAt}` grant;
completion returns `StoredAudioReference`; playback returns a temporary URL/expiry.

Pure validators cover those client requests and the PENDING/READY internal ledger.
They reject unknown/server-owned fields, accessor/non-JSON input, malformed UUIDs,
noncanonical checksum/MIME, invalid byte counts, owner/key mismatches, invalid
versions and time ordering. Requests are bounded to 4 KiB and ledger records to
16 KiB. `mediaObjectKey` / `parseMediaObjectKey` provide structural helpers only.
Response grant validation, authentication, S3 verification and conditional READY
transitions belong to checkpoint 2; no validator proves those operations happened.

Media intent expiry is 1–300 seconds after creation. A READY record may be read
after that deadline; completion retries must return its original pinned version.
Future browser integration must deliberately canonicalize MIME parameters before
signing and send the identical canonical value to S3. Original browser forms may
contain spacing that is not accepted as canonical contract input.

Run `npm run test:media` for the focused contract suite. Keep the cassette-save
private-audio guard and obsolete adapter unchanged until their approved integration
checkpoints; adding types does not make audio upload or save work yet.

Validation passed: 12 media contract tests, 18 cassette regression tests, root
typecheck (including Amplify definitions), production build, and diff checks.
The existing frontend bundle-size/dynamic-import warnings remain. Architect review
found no remaining contract blockers. No AWS operations, new dependencies, or
frontend/API behavior changes occurred; the user's env-example edit is untouched.
Stop here and request approval before backend checkpoint 2.

## Sources
AWS [POST fields](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/RESTObjectPOST.html)
and [POST policies](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html)
document checksum and byte-range constraints. [GetObject versions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
require the appropriate version-read permission. Existing presigned links may be
reused until expiry; see [AWS presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
