# Shared authentication deployment

## Goal and current boundary
Deploy the existing Cognito email/password backend and React identity UI together,
then verify actual confirmation/reset emails and session behavior. This document
and `amplify.yml` prepare that step; no AWS resources have been created or live
authentication verified. Account access and deployment go-ahead are still required.
Audio work belongs to another chat and is outside this deployment change.

## Before connecting AWS
Review this feature branch and merge the approved authentication changes into
`main`. The build rejects every other branch. Do not merge or deploy automatically
as part of preparation. Use the team AWS account; do not share credentials in chat.

The AWS Console route below does not require a local AWS CLI, local credentials,
or a local Node installation. Those tools are needed only for optional local AWS
operations. This machine currently lacks configured CLI access; cloud access has
not been verified.

The team uses **IAM Identity Center (SSO)**. For a future local CLI workflow, first
install AWS CLI v2 through an approved setup step, then run:

```bash
aws configure sso --profile runman
aws sso login --profile runman
aws sts get-caller-identity --profile runman
```

Use the team's supplied SSO start/issuer URL, SSO region, account, and approved role
at the prompts. The **SSO region can differ from the resource region**; choose
`us-west-2` as the profile's default resource region. Check returned account/role
metadata before deployment. Use SSO temporary credentials, not static access keys.
These commands are instructions only; no CLI installation, login, or profile write
has been performed. Console-only deployment remains available through team SSO.

## Console settings (after approval)
Open Amplify Hosting in **US West (Oregon), `us-west-2`**, then Create new app and
connect the GitHub repository. Review these fields before **Save and deploy**:

| Field | Value |
|---|---|
| Repository / branch | `neilpack/runman` / `main` |
| My app is a monorepo | Enabled |
| App root | `frontend` |
| `AMPLIFY_MONOREPO_APP_ROOT` | `frontend` (console normally sets this) |
| Build image | Amazon Linux 2023, with Node 24 available |
| Build specification | Repository root `amplify.yml`; do not replace it with detected frontend-only commands |
| Backend deployment role | Gen 2 deployment service role with `AmplifyBackendDeployFullAccess`, or the team's equivalent approved permissions |
| Branch/PR automation | Only `main`; no auto-created branch environments or PR backend previews |
| Secrets / resource IDs | None to paste into frontend code or this repo; Amplify supplies `AWS_APP_ID` and `AWS_BRANCH` |

Do not set AWS access keys, `NODE_ENV`, or legacy-example flags as Hosting variables.
Jamendo configuration is not required for this authentication checkpoint.

The build selects Node 24, installs the root lockfile (including infrastructure
dev dependencies), typechecks/tests, then deploys **only root `amplify/`**. The
pipeline writes `frontend/amplify_outputs.json` before Vite builds `frontend/dist`.
Only that dist directory is published. Outputs are generated, ignored by Git, and
not cached. No SAM backend or personal sandbox is deployed. The pipeline deploys
all definitions in root `amplify/`; review the approved `main` commit to confirm
those definitions remain within this authentication checkpoint before deploying.
`npm run build` remains a local build and does not invoke AWS.

## Browser routes
Under Hosting > Rewrites and redirects, add **200 rewrites** for `/dashboard`,
`/dashboard/`, `/about`, and `/about/`, each targeting `/index.html`. Keep static
assets unchanged and do not proxy or rewrite `/api/*` to the retained Express API.
These rules are console settings, not part of the build-spec YAML. Refreshing or
opening a dashboard URL directly must still load the React sign-in boundary.

The Home page still has a retained local-API health example; its unavailable status
on Hosting is not a Cognito failure. The Express health endpoint is not deployed
by this auth-only configuration.

## Verify after the first approved deployment
Record the Hosting URL, branch/commit, backend region, and pass/fail results here
without tokens or passwords:

- Confirm the build used Node 24 and generated outputs before the frontend build.
- Open Home/About and directly reload `/dashboard`; signed-out users see sign-in.
- Sign up with a test email; verify confirmation/resend and rejection before confirmation.
- Sign in, reload, sign out, then sign in with a second account; no previous account UI remains.
- Complete password reset by email and confirm the new password works.
- Confirm no extra branch backend or SAM stack was created. Cassette/file isolation
  is a later data/storage check and must not be claimed as verified here.

Optional local outputs retrieval after deployment: use the existing README command
with the displayed Amplify App ID and authorized AWS profile, then restart/rebuild
the frontend. Console deployment itself needs no local credentials.

References: [monorepo build settings](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html),
[Node selection](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-general.html),
[Gen 2 CLI](https://docs.amplify.aws/react/reference/cli-commands/),
[backend service role](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-service-role.html),
[SPA rewrites](https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html).
