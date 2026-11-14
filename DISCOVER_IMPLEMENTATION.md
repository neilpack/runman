# Discover songs: global plays and add-to-tape

Branch: `feat/discover-song-plays`, in the main worktree, based on `f93d08b`.
The user approved counting 30 seconds of actual listening, or completion for songs
shorter than 30 seconds; rank both Jamendo and listener-shared songs. Private
recordings must stay out of Discover.

## Architecture

- Reuse the existing cassette DynamoDB table and Cognito middleware. Authenticated
  POST `/api/explore/plays/start` accepts only `{playId,song:{provider,id}}`;
  POST `/api/explore/plays/progress` accepts only `{playId,listenedMs}`. Bodies are
  limited to 4 KiB after authentication. Owners and counters are server controlled.
- Per-play rows: `PK=USER#<verified sub>`, `SK=LISTEN#<UUID>`, with canonical song,
  creation time, revision, cumulative listened milliseconds and counted flag.
  Sessions expire logically after 24 hours; no automatic Dynamo TTL is configured.
- Global rows: `PK=DISCOVER#STATS`, `SK=jamendo#<id>` or `explore#<id>`, with public
  metadata, `playCount` and `listenedMs`. A transaction conditionally advances the
  session revision and atomically adds only new milliseconds and, once, one play.
  Repeated or reordered progress cannot double count. Concurrent writes retry.
- Resolve Jamendo metadata by ID using the server's existing client ID and content
  filter, never client-supplied titles/URLs/durations. Community metadata comes
  from the public catalog. An owned uploaded/recorded track resolves to its stable
  public song ID only if already shared; private audio is ineligible. Unpublished
  community stats cannot appear by themselves in song lists.
- The browser samples actual media advancement bounded by monotonic elapsed time.
  Pauses, stalls, seeks and fast-forwarding do not manufacture listening time.
  Progress flushes about every 10 listened seconds and on pause/end/track change.
  Short endings tolerate 500 ms of metadata/sample rounding. Replay gets a new ID.
  Counters include signed-in listeners, not guests. Analytics are best effort,
  back off for 15 seconds on failures and never block playback. Account changes
  cancel old work; bearer tokens and signed media URLs are never stored in stats.
- Server progress is bounded by session elapsed time (2-second transport allowance),
  track duration and six hours. This is usage analytics, not proof of audibility or
  a fraud-resistant royalty/billing system. Parallel scripted sessions are not
  prevented; final updates can be lost on browser termination or offline failure.
- Discover joins community catalog entries with global stats and adds verified
  Jamendo entries encountered through playback. It does not import the entire
  Jamendo catalog. Most played and default song lists sort by plays, then listened
  time, recency and ID. Searches retain relevance ordering. Songs show plays and
  listened minutes. Catalog/stat partitions remain hackathon-sized, bounded to
  2,000 rows; no GSI, scans, roles, buckets or new table are provisioned.
- Add-to-tape loads the account's saved library, supports further library pages,
  side A/B and a named new tape. It preserves Jamendo vs community identity and
  stable playback selectors, checks duplicate/capacity/100-track limits, and uses
  the serialized cassette saver. Conflicts keep the draft and offer Retry save /
  Open tape; success is reported as saved only after cloud acknowledgement.
  Guest adds are explicitly local. Switching accounts closes stale pickers.

## Retaining shared uploads and recordings after withdrawal

- When the original owner makes their last public tape using an upload/recording
  private, deletes it or removes that track, retain the song row with `listed:false`.
  It leaves Discover lists/search/rankings; its S3 object and listening totals remain.
  Another recipient making their own tape private does not change the original's
  listing. Republishing the original audio restores its stable song ID and totals.
- Existing `EXPLORE#ADD#<songId>` / `<verified sub>` rows now also grant lasting
  playback. Server-side cassette saves establish these grants for community tracks,
  including copies of public tapes; a conditional transaction requires the song
  still be listed when a new grant is created. Repeated adds do not increment again.
  Grants survive tape removal and failed/conflicting saves so retries keep access.
- Hidden audio requires signed-in POST `/api/explore/songs/:id/playback`.
  The server checks original ownership or a prior grant before issuing a fresh URL.
  Optional `?cassetteId=<id>` supports older saves without add markers: the server
  reads that verified account's existing tape, never trusts the incoming track list.
  Re-saving those older references is supported. New accounts cannot add hidden
  songs by submitting copied IDs. Anonymous GET `/songs/:id/audio` excludes hidden
  entries, so old public URLs no longer bypass withdrawal. Already-issued S3 URLs
  remain usable until their normal expiry; guests do not receive lasting access.
- The signed-in Walkman obtains a fresh playback URL for saved community tracks;
  it cancels stale responses after account changes and stores no signed URL in tapes.
  The original owner's private uploads/recordings and Jamendo keep their existing
  playback paths. A retained song is not a second S3 copy. This does not recover
  catalog entries already deleted by an older deployed backend; the owner must
  republish that original audio once to restore those references.
- Implementation: `sharedSongAccess.ts`, the cassette save authorizer, catalog
  repository add grants, Explore playback route and `sharedSongClient.ts`.
  No new tables, indexes, IAM roles or environment variables.

Relevant files: shared `listening.ts`; backend `listeningService.ts`,
`listeningRepository.ts`, `dynamoListening.ts`, Explore router/source; frontend
`listeningClient.ts`, `listeningTracker.ts`, `listeningRuntime.ts`, tape deck,
preview player, Songs/ExplorePage, `tapeAdder.ts` and AddToTapeDialog.

## Manual deployment (user only)

1. Build the current backend with `npm run package:backend` and upload
   `backend/dist/runman-api.zip` to the existing Lambda. Preserve LabRole,
   `lambda.handler`, existing cassette/Cognito/region configuration and
   `JAMENDO_CLIENT_ID`. No new environment variables are needed.
2. On the existing API Gateway HTTP API, attach these POST routes to the same
   Lambda proxy integration (payload 2.0): `/api/explore/plays/start` and
   `/api/explore/plays/progress`, plus `/api/explore/songs/{id}/playback` for
   retained uploads/recordings. Keep Express Cognito verification; gateway
   authorization NONE matches the existing setup. Deploy if not automatic.
3. Retain exact frontend CORS origins, POST, Authorization and Content-Type in
   Gateway and `CORS_ORIGINS`. Existing role/table access must support Query,
   GetItem, conditional PutItem and transactional Put/Update operations (already
   used by Explore adds). If the lab denies them, ask the instructor; do not
   create IAM roles or broad policies. No console table/index changes are needed.
4. Run/rebuild this branch's frontend. Signed-out POSTs should return 401. Sign in
   and play four known tracks on a tape for at least 30 seconds each. Confirm
   `LISTEN#` and `DISCOVER#STATS` rows and the counts on Discover. Each track counts
   separately; replay adds another play; pauses/seeks alone do not count.
5. Verify two accounts aggregate the same canonical song, short complete songs,
   discover preview plays, unshared recording privacy, add to an existing tape,
   named new tape, save conflict/retry, reload and playback. Rankings refresh
   after a count/focus and every 15 seconds; other Lambda instances may retain
   their 15-second catalog cache briefly.
6. In account A publish a tape with an upload and a recording. In account B add
   both to a saved tape. Make A's tape private, refresh and replay B's tape. It must
   still play both tracks while Discover no longer lists them. In account C,
   hidden-song playback and new saves using those IDs must fail. Test sign-out
   and account changes; guests cannot play the withdrawn audio.

Agents made no AWS changes and have not verified live global counts. Run
`npm run test:discover`, `npm run test:explore`, `npm run test:cassette-frontend`,
`npm run test:audio`, root typecheck and build for offline validation.
Implementation validation passed: 166 tests across those four suites plus
`test:cassette-api` and `test:media-api`, root
typecheck, production build and backend ZIP packaging with offline handler smoke
checks. Browser interaction and the deployed AWS integration still need the
manual checks above. The frontend build retains bundle-size/dynamic-import warnings.
Jamendo ID resolution follows its [official tracks API](https://developer.jamendo.com/v3.0/tracks).
