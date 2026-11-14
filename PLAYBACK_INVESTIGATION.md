# Uploaded audio replay investigation

## Report and scope

The user reports an uploaded MP3 sometimes plays initially, then the deck displays
CAN'T PLAY after ejecting and reinserting the cassette. Work is on
`feat/fix-uploaded-audio-replay`, based on main through `f8354ed` (including the new
previous/next controls). No AWS configuration, saved references or stored audio
are changed by this fix.

## Confirmed player defects

- `useTapeDeck` decided whether to assign `audio.src` before awaiting URL
  resolution. It then ignored the returned URL if that earlier decision said the
  track was loaded. Track/cache state is not proof that the actual reusable media
  element has the same healthy source, particularly after interrupted renewal.
- A rejected `audio.play()` went directly to the generic failure handler. Only
  the native `error` event triggered a bounded private-URL renewal. These two
  failure paths could therefore behave differently, and failed source/cache state
  could survive for the next attempt.
- Source assignment was immediately followed by seeking without waiting for
  metadata, and success/loading state was tracked separately from the element's
  readiness. An ejected empty deck also compared two undefined track IDs as equal.
- All failures were flattened into CAN'T PLAY, hiding whether the cause was a
  browser playback-policy denial, network failure, decoding failure, or API error.

These defects can explain unreliable retry/replay. They do not prove which exact
browser/S3 error occurred for the user's MP3: browser automation access was
unavailable, and private authenticated network responses were not inspected.

## Fix and regression coverage

`audio/mediaPlayback.ts` reconciles the resolved URL with the actual media
element, explicitly reloads changed/failed/cleared sources (including identical
signed URLs), applies the seek after metadata, and cancels pending work/listeners
on eject, account change or a superseding operation. Healthy same-source resumes
avoid reloading. The hook uses one bounded renewal for media failures from either
play rejection or the native error event, prevents competing retries, invalidates
failed cache entries, and displays safe, specific failure messages without logging
signed URLs.

Seven new media-element regressions cover repeated eject/reinsert, failed same-URL
reload, refreshed URL application, healthy resume, late events after cancellation,
promise/native failures, and diagnostic classification. Run `npm run test:audio`.
These use an injected media element; actual MP3/browser playback still needs the
user's repeated play/eject/reinsert check. This is a frontend-only update: no
Lambda upload or S3 permission change is required.

Validation: 40 audio tests and 27 cassette frontend tests passed, including the
seven new regressions. Root typecheck and production build passed; existing
frontend bundle-size/dynamic-import warnings remain. Unrelated concurrent profile
and cassette edits in the shared working folder are outside this playback fix.
