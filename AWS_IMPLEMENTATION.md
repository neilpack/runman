# RunMan AWS authentication handoff

## Goal
Connect the React app to Cognito email/password identity, verification and reset,
with a private dashboard session boundary. The original product goal includes
saved cassettes and audio playback; those features and their authorization remain
outside this authentication chat.

## Confirmed lab architecture (supersedes the original Gen 2 plan)
- AWS Academy Learner Lab, $50 allocation; `us-west-2` preferred, `us-east-1` also allowed.
- Standalone Cognito user pool and public SPA app client, **no client secret**.
- Amplify Auth SDK remains; the branded forms use shared session guards. Managed
  Authenticator tooling stays installed but is not a second runtime login flow.
  No Cognito identity pool or browser AWS credentials.
- Email sign-in/self-registration, email code verification/resend, password reset,
  default Cognito sender, and the documented 8-character/all-classes password policy.
- No custom IAM roles. This authentication path does not use Gen 2/CDK/SAM, a
  sandbox, custom sender Lambda, or SES setup. Retained scaffolds are reference
  only and must not be deployed unchanged; other LabRole-based deployments need separate review.
- Academy Console/session access and optional expiring lab credentials replace the
  earlier SSO assumption. `LabRole` is for supported server-side services, never browser access.
- Public IDs are manually supplied in ignored `frontend/cognito-config.json`; example
  IDs are fake. The file is browser-bundled, accepts only region/pool/client IDs,
  and must never contain secrets. No fallback to generated Amplify outputs.
- Hosting permission and safe config delivery are not yet confirmed. `amplify.yml`
  performs only static install/check/build steps; a fresh checkout builds with
  sign-in unavailable because the real public-config file is not committed/injected.

## Current source boundaries
Read `AGENTS.md` first. `frontend/` has once-before-render configuration, branded
SDK login flows, shared private-session guards, sign-out, and a dashboard with local audio preview from the separate audio work.
`backend/` retains examples: `/api/items` defaults off, requires exact development
opt-in, and is always denied by AWS markers or the Lambda entry point. Health is
public. `shared/` keeps API contracts. Local builds never provision AWS resources.

## Authentication checkpoints
- [x] **1:** source foundation and local tooling; legacy Gen 2 definitions now reference only.
- [x] **2:** SDK UI/session integration and private-render boundary tests.
- [x] **3:** restrict legacy example API; local memory CRUD preserved behind opt-in.
- [x] **4A:** local-only standalone Cognito adapter, public config example, static-only
  build recipe, and lab-compatible instructions. No pool/client created by the agent.
- [ ] **4B — user-approved, supplied pool/client configured locally:** branded SDK
  flows and shared session are connected. The user still needs to verify actual
  client settings and exercise real sign-up, unconfirmed-login rejection,
  confirmation/resend, password reset, reload/token refresh, sign-out/account switching.
- [ ] **Later approved hosting:** establish a lab-permitted static host, public-config
  delivery, HTTPS/SPA routing, and deploy a reviewed build. Do not assume Amplify Hosting access.

## Product backlog outside this chat
Private cassette saves, explicit Save/unsaved indicator, Jamendo attribution,
recordings/uploads, and browser playback remain product requirements. Private
backend/file authorization must be designed and tested by the responsible work;
this user-pool-only integration grants no storage/API privileges. Sharing, social
login, anonymous saves, custom domain, and server-side audio conversion remain deferred.
Keep data after judging unless cleanup is explicitly requested.

## Agent handoff
- **Completed:** branded Cognito login/signup/confirmation/resend/reset connected to the supplied ignored public config. Shared SDK token/user session replaces cookie checks; confirmed welcome/login sessions land at `/library`; dashboard uses the same keyed guard and sign-out state. Library/editor remain public local prototypes. Live credential/email flows remain unverified.
- **Agent:** backend-aws; source review and local checks complete.
- **Changed files:** frontend branded login, shared session/flow modules and hook, dashboard guard, welcome/router/bootstrap/styles, focused tests/test script, and status docs. No dependency, backend/API, audio, or resource changes.
- **Checks:** root typecheck/build, 30 strict-typechecked auth/config/session/flow tests, and diff checks passed. Main bundle is about 537 KB with Vite's size warning; managed Authenticator duplication was removed. No cloud/login/email tests performed.
- **Signup redirect fix:** same-session email confirmation now completes SDK-managed SRP auto-sign-in, verifies the SDK session, and uses the existing `/library` redirect. Expired/reloaded SDK auto-sign-in context falls back to normal login; no app password persistence or AWS changes.
- **Concurrent merge:** preserved remote audio commit `cbf2a6f` without changing its audio code. After integration, root typecheck/build, nine auth tests, and nineteen audio tests passed. Cloud audio remains unconnected by this user-pool-only configuration; see the imported audio notes below.
- **Blockers:** supplied pool public signing metadata is reachable, but app-client settings,
  default-sender email delivery, and actual credential/session flows remain unverified.
  Local AWS CLI is absent but not required for the Console path.
- **Next:** let the user test the branded login against the existing pool. Do not create accounts or enter user passwords/codes as the agent; no duplicate pool or AWS changes required by this code task.
- **Audio handoff:** another chat owns branch `feat/audio-storage`, worktree
  `.worktrees/audio-storage`; this chat must not coordinate or modify that work.

## Imported audio handoff (prior architecture)
Preserved from remote commit `cbf2a6f`; these are historical audio implementation notes, not current lab deployment instructions. Local dashboard preview is preserved. The cloud adapter still requires identity-pool/storage credentials and is not connected by the current user-pool-only authentication configuration. The other chat owns adapting that integration; no audio code is changed here.


- User authorized audio step 1 implementation on `feat/audio-storage`; deployment remains prohibited. This supersedes the earlier planning-only note below.
- Audio owns `amplify/storage/`, `frontend/src/audio/`, and audio tests. Shared edits are limited to registering `storage` alongside the existing `auth` in `amplify/backend.ts` and adding an independent `StoredAudioReference` contract. Preserve concurrent auth/data resources when integrating.
- Contract proposal for persistence: store `StoredAudioReference` on uploaded/recorded tracks; retain cassette IDs across saves. Keys use Cognito **identity pool IDs**, not user pool `sub`. No cassette schema or authentication implementation changes in this task.
- Local verification: `npm run test:audio` (10 tests), `npm run typecheck` (including Amplify), `npm run build`, `npm run test:auth` (6 tests), `npm run test:legacy-api` (9 tests), and `git diff --check` passed. Build retains the existing Vite auth chunk warning. No AWS calls or deployment were made.
- Audio continuation: added browser microphone recording, file preview and reusable `AudioInput` upload/adoption control. Dashboard is local-preview-only until cassette persistence exists. Unmount cancels active work and clears playback/microphone resources through the existing keyed auth session; authentication files remain unchanged.
- Continuation checks: `npm run test:audio` now passes 19 tests; `npm run test:auth` passes 6 tests; `npm run typecheck`, `npm run build`, and `git diff --check` pass. The existing large auth chunk warning remains. Actual browser microphone/permission UI and AWS integration have not been exercised.
- Remaining integration: mount upload control in the future cassette editor, cassette save/delete coordination and durable cleanup retries, and live browser/two-account isolation/URL expiry checks. These are not claimed complete by this implementation.
