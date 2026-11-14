# RunMan AWS authentication handoff

## Goal
Connect the React app to Cognito email/password identity, verification and reset,
with a private dashboard session boundary. The original product goal includes
saved cassettes and audio playback; those features and their authorization remain
outside this authentication chat.

## Confirmed lab architecture (supersedes the original Gen 2 plan)
- AWS Academy Learner Lab, $50 allocation; `us-west-2` preferred, `us-east-1` also allowed.
- Standalone Cognito user pool and public SPA app client, **no client secret**.
- Amplify SDK and Authenticator stay; no Cognito identity pool or browser AWS credentials.
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
Read `AGENTS.md` first. `frontend/` has once-before-render configuration, lazy-loaded
Authenticator, private-session guards, sign-out, and an identity-only dashboard.
`backend/` retains examples: `/api/items` defaults off, requires exact development
opt-in, and is always denied by AWS markers or the Lambda entry point. Health is
public. `shared/` keeps API contracts. Local builds never provision AWS resources.

## Authentication checkpoints
- [x] **1:** source foundation and local tooling; legacy Gen 2 definitions now reference only.
- [x] **2:** SDK UI/session integration and private-render boundary tests.
- [x] **3:** restrict legacy example API; local memory CRUD preserved behind opt-in.
- [x] **4A:** local-only standalone Cognito adapter, public config example, static-only
  build recipe, and lab-compatible instructions. No pool/client created.
- [ ] **4B — requires user go-ahead:** review and create the standalone pool/public
  client through the lab Console, verify no client secret and SRP/refresh flows,
  fill public config, then exercise real sign-up, unconfirmed-login rejection,
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
- **Completed:** checkpoint 4A source prepared locally; live identity remains unverified.
- **Agent:** backend-aws; source and local checks complete, awaiting review/user go-ahead for 4B.
- **Changed files:** frontend config adapter/example/tests/ignore, static `amplify.yml`,
  lab docs/instructions, and comment-only warnings on legacy infrastructure references.
  No dependency changes, audio work, or resource creation.
- **Checks:** root typecheck/build, nine strict-typechecked auth tests, YAML/static-only
  no-provisioning assertions, ignore/example checks, and `git diff --check` passed.
  Actual SDK configuration has no identity-pool/credential/API/storage settings.
  Existing Vite auth-chunk size warning remains; no cloud/live-flow checks performed.
- **Blockers:** 4B requires a separate creation go-ahead and actual lab Console access.
  Pool/client settings, default-sender email delivery, and live session flows remain unverified.
  Local AWS CLI is absent but not required for the Console path.
- **Next:** report 4A results and wait before any 4B creation/live tests.
- **Audio handoff:** another chat owns branch `feat/audio-storage`, worktree
  `.worktrees/audio-storage`; this chat must not coordinate or modify that work.
