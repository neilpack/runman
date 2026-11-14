# Tape recording implementation

Branch: `feat/tape-recording`. Worktree: `.worktrees/tape-recording`.
Base: `origin/main` at `d7196dc`, including the persistent/floating Walkman.
The original working folder and other worktrees are unchanged.

## Problems and changes

- MediaRecorder already captured elapsed duration, but the AudioInput preview
  replaced it with zero when WebM metadata returned Infinity/NaN. Upload then
  retried the same missing metadata and stopped before reaching S3. Recordings
  now retain their captured duration for preview, capacity checks and persistence.
- Recording duration uses a monotonic clock and ends when Stop is requested,
  excluding delayed final-chunk/stop-event processing. File-only metadata lookups
  have cancellation, a timeout and object-URL cleanup. Capacity is checked again
  before an upload starts.
- Only LibraryPage opened a recorder. Floating Walkman REC went to a hook that
  simply stopped playback. REC now opens one shared DeckProvider recorder from
  either Walkman and starts the microphone request. Stop previews the clip;
  Upload uses the existing authenticated media intent/direct POST/completion flow.
- The destination cassette, side and account context are captured when REC is
  pressed. Ejecting, changing sides, deleting the tape or switching accounts closes
  the recorder and releases the microphone. Adoption checks the current account,
  latest tape capacity and 100-track limit; retries do not duplicate a reference.
- After upload, the recording is added to the local draft and the existing
  serialized cassette saver persists it. Save failures retain the ready reference
  and offer Retry saving cassette / Open tape editor. No successful-upload cleanup
  or physical deletion is claimed. The shared recorder is portalled above pages
  and includes Escape, focus restoration and tab containment.

Existing backend routes already support `source: recording`. No backend API,
database schema, dependencies or AWS resources needed changes.

## Validation and pickup

Run `npm run test:audio`, `npm run test:cassette-frontend`, `npm run typecheck`,
and `npm run build` from this worktree. Tests cover unknown WebM duration,
elapsed capture time, upload/finalize/adoption, account changes, capacity,
idempotence, failed-save retention/retry and metadata lookup cleanup.

Validation passed: 60 audio tests, 31 cassette frontend/publishing tests, root
typecheck and production build. Existing frontend bundle/dynamic-import warnings
remain. Browser microphone and authenticated live S3 checks remain user-run.

For local testing, this worktree has ignored copies of only public Cognito IDs
and the existing public API URL. Stop the other frontend server first, then run
`npm run dev -w frontend -- --port 5173 --strictPort` here. Using the same port
preserves the existing CORS configuration; this task does not replace the server
running from the original checkout.

Live checks still need the user's browser/microphone: editor record → Stop →
preview → Upload; Library and floating REC → allow mic → Stop → Upload → saved;
reload/play; deny/cancel permission; close while recording/uploading; switch
accounts; and retry a failed cassette save. Offline tests do not establish actual
microphone codec behavior or live S3 upload success.
