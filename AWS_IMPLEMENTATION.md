# RunMan AWS implementation handoff

## Goal
By November 14, 2026, 4 PM, deploy an HTTPS demo where a verified user can create a cassette, add Jamendo tracks or their own audio, save it, reload it, and play it. A second account must not access the first account's data or files.

## Confirmed decisions
- Amplify Hosting + Amplify Gen 2; Cognito, Amplify Data/DynamoDB, and private S3 storage. Region: `us-west-2`, subject to account availability.
- Email/password accounts with email verification and password reset; owner-only cassette and audio access.
- Explicit **Save cassette** button and unsaved-changes indicator.
- Browser recording/playback/effects; direct audio storage, no server-side conversion. Browser-enforced 25 MB/file demo limit; this is not a backend security boundary.
- GitHub `main` automatically deploys one shared demo environment. Local frontend uses that backend initially.
- $50 allocation. Retain data after judging; document cleanup, do not automatically delete it.
- Defer sharing, social login, anonymous cloud saves, custom domain, and per-developer/preview backends.

## Starting point
Read `AGENTS.md` first. The repo has `frontend/` (React/Vite), `backend/` (retained Express/Lambda/SAM examples), `shared/` (contracts), and `amplify/` (Cognito foundation). New cloud resources use Amplify; do not deploy duplicate SAM resources. Reinspect before editing; other agents may have progressed.

## Ordered tasks
Check a task only after its completion check passes. Claim it below before editing shared files.

- [ ] **1. Reconcile infrastructure.** Add Gen 2 definitions under `amplify/`; reuse the existing frontend and shared types. Inventory existing Express routes and SAM resources; document their migration to Amplify Data/storage. Preserve existing work until replacements function, and avoid deploying duplicate SAM and Amplify stacks. **Done:** one documented deployment path and working local configuration.
- [ ] **2. Identity.** Configure Cognito and frontend sign-up, verification, sign-in/out, and reset. **Done:** verified user signs in; signed-out cloud access is denied.
- [ ] **3. Persistence.** Define cassette/track contracts: label, colors, stickers, ordered sides, source, duration, Jamendo ID/attribution, or S3 object key. Apply backend owner rules; wire save/list/load/update/delete. **Done:** edits survive reload and another account cannot read or modify them.
- [ ] **4. Audio storage.** Define identity-scoped S3 permissions; add upload/recording, supported-format validation, size checks, and authorized playback. Persist object keys, not expiring URLs. Finish upload before saving references; handle failures/retries and remove unused files safely on deletion. **Done:** own audio plays after reload; cross-account file access fails.
- [ ] **5. Demo integration.** Connect cassette editor/library/player and Jamendo search with attribution. Show save/upload errors without losing edits. **Done:** complete create -> add track/record -> save -> reload -> play flow.
- [ ] **6. Deploy.** Connect GitHub `main`, configure monorepo build (`frontend/dist`), backend deployment, generated frontend configuration, and Jamendo client ID. Keep credentials out of Git and browser bundles. **Done:** a push deploys a usable HTTPS URL.
- [ ] **7. Verify and document.** Run `npm run typecheck` and `npm run build`; exercise two-account data/file isolation, recording permissions, oversize/unsupported files, and failed saves/uploads. Update README with actual setup, deployment, demo URL, known limitations, and cleanup. **Done:** record commands/results and deployed smoke-test evidence below.

## Agent handoff
Keep changes within the claimed task; coordinate edits to shared contracts, configuration, and lockfile. Follow `AGENTS.md` layering and contract conventions for any retained Express routes. Never put credentials in this document.

Update this block when stopping so the next agent can continue:

- **Completed:** identity checkpoint 1 definitions added locally: Cognito email/password and guest credentials disabled. Identity task remains incomplete; no UI integration or AWS provisioning performed.
- **Claimed task / agent:** checkpoint 1 implemented by backend-aws; awaiting review/user go-ahead.
- **Changed files:** `amplify/`, `.nvmrc`, root package/lockfile and ignores, README, AGENTS.md, backend agent profile, this handoff.
- **Checks and results:** dependency installation, `npm run typecheck` (workspaces + Amplify), `npm run build` (Lambda + frontend), and `git diff --check` passed. TypeScript remains 5.9.3. Audit reported 46 dependency advisories (4 moderate, 38 high, 4 critical), including Amplify CLI code-generation dependencies; some have no advertised fix. Review before cloud deployment; no broad automatic fixes applied.
- **Blockers:** Amplify CLI fails by default on this machine's Node 25.2.1 (`localStorage.getItem` in `@typescript/vfs`). A process-local `NODE_OPTIONS=--no-experimental-webstorage` version check passed (`1.10.0`); Node 24 remains the project target and needs CLI verification before deployment. Live AWS access/email flows not yet verified. Existing `/api/items` is still public and must not be used for private data.
- **Next action:** checkpoint 1 source review and local validation complete; wait for user approval before checkpoint 2 (identity UI/configuration). Later checkpoints restrict legacy example exposure and provision/test shared Cognito.
