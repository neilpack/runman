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

## Persistent diagnostics

The user's later retest still fails; the exact live cause is not confirmed. The
library now retains a Playback error details panel after a terminal failure.
Choose Copy error details after the S3 check finishes. The same safe JSON appears
in the console with the prefix `[runman playback diagnostics]`.

Reports distinguish playback-URL API/validation failures, media startup and errors
during playback. They include status/code, browser family/major version, MIME,
byte count, ready/network state, retry state and native media error code. They
exclude raw exception messages/stacks, filenames, user IDs, object keys, tokens,
and signed URLs. Reports stay in memory and clear on new playback, tape/account
changes, dismissal or unmount.

For terminal private-media failures, a bounded diagnostic GET requests bytes 0–0
of the same authorized S3 object. It reports HTTP status and allowlisted S3 error
codes, or network/CORS ambiguity. It stops after response headers for successful
audio and bounds error-body reads; URLs and S3 messages are not reported. It does
not bypass S3 access controls. It times out after eight seconds. Media startup
also reports a TimeoutError after twenty seconds instead of hanging indefinitely.

The report is needed before claiming the remaining MP3 problem is fixed. This
diagnostic update requires only the local frontend, not an AWS deployment.

Diagnostics validation: 48 audio tests, root typecheck and production build pass.
Tests cover secret redaction, API classification, ranged GET success/error/CORS,
external-destination rejection, bounded error reads and media startup timeout.

## Confirmed live failure: frontend expiry validation

The user supplied a safe report with stage `playback-url`, frontend-generated
status 502, code `grant-window-invalid`, `sourceAttached: false`, and media
ready/network state zero. This confirms playback stopped at client response
validation before attaching the S3 URL; this specific failure was not an MP3
decoder or media-element failure.

The client compared Lambda's absolute expiry with browser `Date.now() + 300s`
without a clock-skew allowance. A real SDK-signed 300-second grant reproduces the
same rejection when the browser is just 1.5 seconds behind. A public API Date
header comparison cannot establish the exact Lambda-to-browser skew or inspect
this private grant; those were not independently measured.

The fix checks AWS signing dates/durations instead: GET `X-Amz-Expires` must be
1–300 seconds, the declared expiry must agree with that signed window (allowing
the backend's subsecond rounding), and POST policy expiry is checked against its
signing date. Fresh no-store API requests use a browser-local cache deadline
starting at request start, subtracting one second for signing-date rounding;
this conservatively includes the entire request duration without comparing two
wall clocks. S3 still enforces real expiration. Missing/malformed/overlong grants
remain rejected. Safe numeric timing details are available if validation fails.

Three added regressions reproduce skewed GET/POST failures before the change and
check skew-tolerant playback cache timing plus malformed/overlong grant rejection.
All 51 audio tests pass. After the correction, the user confirms the existing
uploaded MP3 plays. That is user-reported live playback, not an agent inspection
of private S3 data. The safe diagnostic panel remains available for future errors.
