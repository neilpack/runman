# Cassette database handoff

## Goal and current scope
Privately save and restore the complete cassette look and ordered track metadata
for the signed-in owner. Steps 1 and 2 define and implement the authenticated API;
step 3 connects frontend Save/Load with account-scoped drafts. AWS resources are
created manually by the user. The current UI supports library, uploaded, and
recorded tracks; local drafts preserve inline `audioReference` metadata.
The user will create the table using [the console guide](DATABASE_CONSOLE_SETUP.md);
agents must not create or modify AWS resources for this checkpoint.

## Approved schema
Future on-demand DynamoDB table, preferred region `us-west-2`; one item per tape:

```text
PK = USER#<verified Cognito sub>
SK = CASSETTE#<stable cassette id>
schemaVersion = 1
revision = positive integer
createdAt / updatedAt = canonical server ISO timestamps
payload = complete CassettePayload
```

`shared/src/index.ts` exports DTOs, pure validators, and UI adapters from
`cassettePersistence.ts`, `cassetteValidation.ts`, and `cassetteAdapters.ts`.
Keep side B partial: missing style fields inherit A, missing B stickers mean none.
Do not flatten defaults or reorder tracks. UUIDs and legacy alphanumeric IDs work;
IDs may contain letters/digits/hyphens/underscores, max 128. Track IDs are unique
across a cassette; sticker IDs are unique separately on each side. Sticker kinds
are bounded identifiers, not inline SVG or a hardcoded catalog whitelist.

Library tracks use provider `jamendo` plus required canonical source ID. Public
HTTPS audio/artwork/license snapshots are optional; signed/expiring/token-bearing
URLs are rejected. The UI adapter narrowly upgrades Creative Commons `/licenses/`
HTTP links to HTTPS. Legacy library tracks without source IDs return explicit
errors and remain local; no tracks are silently dropped.

Uploads/recordings use provider `s3` and the existing `StoredAudioReference` shape;
never persist blobs, data URLs, local previews, or temporary playback URLs. The
adapter restores the current upload/recording source and inline audio reference,
and retains a separate reference map for older callers. Legacy recording-plus-map
uploads remain supported. **Shape validation proves neither ownership nor object existence.**
Step 2 must refuse private-audio references until server-side audio authorization
and existence checks integrate; owning the cassette cannot authorize a foreign
object key. No identity-pool key prefix is assumed by this schema.

## Validation defaults
- At most **100 tracks total** and **100 stickers per side**.
- At most **256 KiB UTF-8 JSON for `CassettePayload`**, measured identically on
  save and restore. Server envelope/keys have ample headroom below DynamoDB's
  400 KiB item limit; the JSON estimate is not an exact DynamoDB billing-size calculation.
- Name up to 120 characters (blank allowed); track title/artist 256; title must
  be nonblank, artist may be blank. Sticker kind 80; URLs/cursor 2048; object key 1024.
- Duration 0–86,400 seconds; sticker x/y 0–100, rotation −360–360, scale 0.1–5.
  Hex colors only; finite numbers; supported enums; audio bytes 1–25,000,000.
- Unknown fields and client-supplied owner/keys/revision/schema/timestamps
  are rejected with `{path, message}` issues. Audio content type/source must match
  its reference. Object keys are structural only. HTTPS checks are syntactic,
  not DNS/provider/existence checks; the future server must not fetch arbitrary URLs.

## API contract and ownership
- `PUT /api/cassettes/:id`: `SaveCassetteRequest`, with path ID equal to payload ID.
  `expectedRevision: 0` means conditional create; positive means conditional update.
  Server increments revision, retains original createdAt, and sets updatedAt.
- `GET /api/cassettes/:id` / successful PUT return `CassetteResponse` without PK/SK/owner.
- `GET /api/cassettes?limit=&cursor=` returns items and optional opaque nextCursor.
  Limit 1–100; default 25. Query only the verified user's PK,
  ascending SK (deterministic stable-ID order), **never Scan**. Cursors are
  HMAC-signed and bound to owner/query/page size; never accept caller-selected keys.
- `DELETE /api/cassettes/:id` requires positive expectedRevision; stale writes/deletes
  must conflict rather than overwrite. No last-write-wins behavior.
  Delete removes only the owner's cassette metadata, even for an existing private-
  audio-bearing record; it never deletes or authorizes any S3 object. File cleanup
  belongs to the later audio integration.
- Middleware verifies Cognito access JWT signature/issuer/client/token use/
  expiry and derives owner from verified `sub`. No caller-selected owner or browser
  AWS credentials. Later deployment uses an approved precreated LabRole, not new roles.

## Five approval-gated steps
1. **Complete:** contracts, strict validation, adapters/tests, this handoff; repair the
   baseline config regression while preserving Jamendo and the dirty env example.
2. **Complete:** JWT ownership middleware, private API/routes/repository and
   conditional revisions/pagination; reject durable audio until authorization integrates.
3. **Complete locally:** frontend explicit Save + unsaved indicator and account-scoped
   local drafts. Edits persist locally; only explicit Save sends them to the API.
   Offer explicit selection/import for old local drafts into the signed-in account,
   retain originals, and never silently claim/import them as cloud-owned.
4. **Complete locally:** LabRole-only API deployment preparation. The user creates
   the database themselves using `DATABASE_CONSOLE_SETUP.md`; agents do not provision it.
5. **Core live checks confirmed:** user-run deployment and reported save/reload,
   stale-save conflict, and account separation. Public API/CORS checks passed.
   Direct cross-account write/delete attempts, stale deletes, live pagination, and
   private-audio rejection remain additional live checks; audio integration is separate.

## Progress / pickup
Step 1 source and local checks are complete: `npm run test:cassettes` (17 tests),
`npm run test:legacy-api` (10 tests), root typecheck/build, and diff checks passed.
The existing frontend chunk-size warning remains. Config repair restores `readConfig`
and the exact development opt-in gate, retaining Jamendo's public local test client
only outside production/AWS execution. The user-modified `backend/.env.example`
was neither read nor edited.

Step 2 is complete locally: `npm run test:cassette-api` (16 tests),
`npm run test:cassettes` (17 tests), `npm run test:legacy-api` (10 tests), root
typecheck, production build, and diff checks passed. All AWS tests use mocks;
JWT tests use generated local RSA keys and cached JWKS. Live AWS remains untested.
Runtime entry points:
`routes/cassettes.ts` → `services/cassettesService.ts` → `aws/dynamoCassettes.ts`.
`middleware/cassetteAuth.ts` verifies access JWTs with `aws-jwt-verify`.
`services/cassetteRepository.ts` contains the repository port and explicit local
memory implementation. `services/cassetteCursor.ts` signs pagination cursors.

Copy variable names from `backend/cassettes.env.example` into the ignored backend
environment as described in the console guide. Storage is disabled by default;
`memory` requires exact development mode and no AWS markers; `dynamodb` requires
the existing table. Both enabled modes require valid Cognito and cursor settings.
No database/config error switches to memory. Cassette JSON parsing is bounded at
300 KiB and runs after authentication; the payload limit remains 256 KiB.

Step 3 is complete locally: `npm run test:cassette-frontend` (21 client/store tests),
`npm run test:auth` (30 tests), root typecheck/build, final frontend build, and diff
checks passed. The existing frontend chunk-size warning remains. Browser preview
was unavailable in this session; no live AWS connection was tested.
`frontend/src/api/client.ts`
exposes `api.cassettes`, backed by the injectable authenticated client in
`api/cassetteClient.ts`. `cassettes/store.ts` owns draft/revision/conflict state;
`cassettes/runtime.ts` connects it synchronously to the existing session store.
`hooks/useCassettes.ts` exposes both the tapes and sync status. Library and editor
controls provide explicit import, Save, confirmed reload, copy, and conditional delete.

Draft keys are scoped by pool/client/sub; guest drafts have a separate key. The
old `runman.cassettes.v1` and guest tapes are offered only for selected import into
fresh account drafts. Originals remain untouched; import does not upload. Never
store auth tokens in drafts. Every API operation obtains an active account-matched
access token; account generations and abort signals guard stale responses. A
late save acknowledgement preserves edits made after clicking Save. Conflicts and
network failures preserve the draft and its original expected revision.

Once the user creates the table and configures an authorized running backend,
frontend saves reach DynamoDB. A successful local build does not prove the live
backend/table connection. Memory mode remains ephemeral development storage.
Recorded/uploaded tracks remain local until audio authorization integrates; no
tracks are silently omitted to make a tape saveable. No AWS resources have been
created or changed by agents.

Step 4 is prepared in [BACKEND_DEPLOYMENT.md](BACKEND_DEPLOYMENT.md). Run
`npm run test:deployment` and `npm run package:backend` to create an ignored ZIP
with only root `lambda.mjs`, a SHA-256 manifest, and offline uploaded-handler smoke
verification. Handler is `lambda.handler`, runtime `nodejs22.x`; manual console
deployment uses existing LabRole and explicit HTTP API 2.0 routes. Runtime supplies
AWS_REGION and role credentials; never paste temporary keys into Lambda or frontend.
The old SAM template remains undeployed reference. User-owned provisioning and live
two-account validation are checkpoint 5, not part of this preparation.

Merged origin/main through `b1db48b` (including account, filters and uploaded-track
UI). Compatibility fixes preserve uploaded/recorded draft tracks and matching
sources while keeping private-audio API saves blocked pending authorization.
Favorite selection and library filters reflect pagination rather than claiming
the loaded page is the whole library. Latest verification: 127 tests across
schema (18), cassette API (16), frontend (22), auth (30), audio (19), account (9),
legacy API (10), packaging (3); root typecheck/build and offline ZIP smoke passed.
An independent ZIP reader verified the one-entry archive and both SHA-256 hashes.
At packaging time no live AWS tests had run; local Node smoke alone does not prove
Lambda runtime/IAM access. See the subsequent live verification below.

## Step 5 live verification — 2026-11-14

The user deployed the resources through the console. An initial cassette 503 was
resolved by correcting Lambda variable spelling/values and adding missing cassette
settings; local `.env` configuration does not configure Lambda automatically.

Agent-run read-only HTTP checks passed: `/api/health` 200, unsigned
`/api/cassettes` 401, `/api/items` 404, allowed-origin preflight 204 with the expected
PUT/Authorization/Content-Type allowance, and disallowed-origin preflight without
an allow-origin header. Tested allowed frontend origin: `http://localhost:5173`.

The user confirmed a signed-in tape save appeared in DynamoDB, then reported the
requested page reload, two-tab stale-save conflict, and second-account list/editor
isolation tests worked. These authenticated tests were user-run, not independently
executed by the agent. No passwords, access tokens, or AWS keys were requested.

Do not infer live coverage of direct cross-account PUT/DELETE, stale DELETE,
multi-page pagination, or private-audio rejection from those confirmations. Those
paths have offline coverage but still need targeted live testing if required.
Audio/S3 authorization remains a separate follow-up; agents made no AWS resource
changes. Preserve the user's uncommitted backend environment-example edit.

## Merge pickup for S3 work

Main through `a5801af` adds Explore community songs and real deck playback. Merge
resolution keeps context-scoped cassette auth/drafts and restores editor focus
without resetting the selected tape on each edit. Explore `source: community`
tracks are retained in local drafts; cloud save returns an explicit validation
issue until their public-song persistence contract is added. Do not silently drop
them or reinterpret them as Jamendo/private uploads. The subsequent
[S3 integration](S3_IMPLEMENTATION.md) adds private-reference authorization and
frontend uploads/playback. The user deployed the backend and confirms the core
upload/save/reload/play flow; additional live isolation/renewal checks remain.
Private audio uses a separate bucket from public Explore. The separate
audio-storage worktree is unchanged. Earlier checkpoint notes above describe the
database-only implementation before this integration.

## Visibility, community tracks and profile item — 2026-11-14

Audit after #32 (public/private), #34 (custom stickers) and #22/#29 (account/Explore):

- **Visibility now persists.** `payload.visibility` (`private`|`public`, optional) and
  `visibility` on `s3` (upload/recording) tracks are accepted. Before this, any tape or
  own song switched to public failed cloud save ("Unknown or server-owned field").
  Library/community tracks never carry visibility; the adapter drops it.
- **Community (Explore) tracks now persist** as `source: community`, `provider: explore`,
  required `sourceId` (ID pattern) and `hasAudio`. The origin-dependent audio URL is not
  stored; `cassetteFromDocument(doc, { communityAudioUrl })` rebuilds it on restore
  (the frontend store passes `api.publicSongAudioUrl`). Media authorization only runs for
  `provider: s3`.
- **Custom stickers** were already covered (`customStickers` in the payload, 5 slots,
  bounded strokes/coords). No change needed; worst case fits the 256 KiB payload cap.
- **Profile item:** `PK=USER#<sub>`, `SK=PROFILE`, `{ schemaVersion: 1, updatedAt,
  favoriteTape: TapeSnapshot | null }` in the same table. `GET`/`PUT /api/profile`
  (Cognito access token, last write wins, same storage settings as cassettes; 503 when
  disabled). It never matches the `CASSETTE#` query prefix. Frontend favorites save here,
  cache in localStorage, migrate a device-only favorite on first load, and stay local only
  when the server answers 503. Username/avatar remain Cognito attributes.
- **Lambda/API Gateway:** a deployed HTTP API needs explicit `GET /api/profile` and
  `PUT /api/profile` routes (plus CORS PUT) before this works live. Not deployed by agents.

Superseded below: publishing is now in DynamoDB (see "Explore publishing").

## Explore publishing — 2026-11-14

Public tapes, songs and profiles now live in the cassettes table (contract and layout in
`shared/src/explorePublishing.ts`). All reads are `Query` on fixed partitions, never `Scan`:

| PK | SK | Holds |
| --- | --- | --- |
| `EXPLORE#PROFILE` | `<sub>` | username, avatar, favorite tape snapshot |
| `EXPLORE#USERNAME` | lowercase name | `ownerId`; transaction-claimed so names stay unique |
| `EXPLORE#SONG` | songId | title/artist/duration, owner, private `audio` reference, `addCount` |
| `EXPLORE#TAPE` | tapeId | `PublicTape` (look + Jamendo/Explore tracks only) |
| `EXPLORE#ADD#<songId>` | `<sub>` | one row per listener, dedupes `addCount` |

- IDs are server-derived hashes of (owner, audio object key) / (owner, cassette id); writes are
  conditioned on the owner, so nobody can overwrite or delete another account's rows.
- Songs require the caller's own READY media (`media.authorize`). Audio is not copied: the stable
  `/api/explore/songs/:id/audio` URL presigns the owner's version-pinned private object through
  the media service. Without the media runtime, song publishing answers 503.
- Tapes drop private uploads; public uploads appear only once published as songs, as
  `community` tracks. No private object key ever reaches a public tape.
- A profile (chosen username) is required before songs/tapes (409). The frontend publishes it on
  first share and re-sends it on account edits only if already published (`ifPublished`).
- Explore source: `dynamodb` storage mode → catalog `dynamodb`; `memory` → in-memory catalog plus
  sample data; otherwise the previous S3/sample/empty behavior. Listings are cached 15 s per
  instance and invalidated on that instance's writes.
- Limits/known gaps: each partition is read up to 2000 rows (hackathon scale; hot partitions);
  unpublishing a song removes it everywhere even if it is on another public tape; there is no
  browse UI for public tapes yet (`api.exploreTapes` / `api.publicTape` exist); `EXPLORE#ADD#…`
  rows stay after a song is unpublished; LabRole needs `dynamodb:TransactWriteItems` and `Query`
  on the table.
