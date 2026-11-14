# RunMan

**A re-invented portable cassette player for the web.** Design your own cassettes, fill them with tracks or your own recordings, and drag them into RunMan to listen.

Built for **iHack 2026** (BYU-Idaho CSE Department Computing Society) — Theme: *Re-Invent*, Category: **Innovating Yesterday**.

---

## Features

- **Cassette library:** a shelf of cassette tapes you can drag and drop into the RunMan player to listen.
- **Custom tracks:** search a music library API and add tracks to your cassettes.
- **Cassette styling:** color, add stickers, and label each cassette however you like.
- **Recording:** record your own audio onto a cassette with your microphone.

### Stretch goals

- Side A / Side B with tape flipping
- Tape length limits (e.g., C60 = 30 minutes per side)
- Shareable mixtape links
- J-card liner notes
- Analog effects (rewind/fast-forward sounds, tape hiss, wow and flutter)

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | React + Vite |
| Drag and drop | dnd-kit |
| Cassette visuals | SVG components; react-konva for stickers |
| Audio playback and effects | Web Audio API (Howler.js optional) |
| Recording | MediaRecorder API |
| Music library | Jamendo API (Creative Commons music) |
| Backend | Retained Express local examples; private APIs are separate work |
| Database | DynamoDB originally planned; outside this authentication checkpoint |
| File storage (recordings, uploads) | Private S3 client/backend implemented; manual deployment and live checks pending |
| Auth | Standalone Cognito user pool + public SPA client; branded forms using Amplify Auth SDK |
| Hosting | Static build only; Learner Lab hosting permissions not yet confirmed |

---

## Prerequisites

### Shared tooling

Use **Node.js 24 LTS** (`.nvmrc`) and run `npm ci` from the repo root to install
the locked dependencies for all workspaces.

| Work | Installed tooling |
|---|---|
| Legacy infrastructure reference | Root Amplify backend/CLI and CDK dev dependencies retained for reference/typecheck; do not deploy in Learner Lab |
| Frontend authentication | `aws-amplify` configured for an existing Cognito user pool, without identity-pool credentials |
| Sign-in components | `@aws-amplify/ui-react` |
| Existing backend AWS helpers | AWS SDK v3 DynamoDB/S3 clients, document client, and S3 presigner |
| Music search and audio | Browser `fetch`, audio/Web Audio, and MediaRecorder APIs; no extra library required |

For local development, no Jamendo setup is required: the backend uses Jamendo's documented
read-only test client ID when `JAMENDO_CLIENT_ID` is unset. For deployment, set your own
`JAMENDO_CLIENT_ID` in the backend environment. The backend proxies Jamendo searches so the
client ID is not included in the browser bundle. The frontend calls
`GET /api/music/search?q=...`.
AWS runtime access also needs generated backend outputs and Amplify configuration;
packages alone do not provision resources. Identity implementation is a separate change.
Do not put AWS credentials in frontend code or commit generated outputs.

AWS CLI is installed separately from npm dependencies. Cloud provisioning is a
later checkpoint, not part of installing tooling or running the frontend.

Every team member needs:

- [Node.js 24 LTS](https://nodejs.org/) (`.nvmrc` pins major 24)
- [Git](https://git-scm.com/downloads)
- [VS Code](https://code.visualstudio.com/) (recommended), with [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) and [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) only for a later approved optional lab CLI workflow; not needed for local UI or Console access
- Chrome or Edge (for DevTools and microphone support)

Accounts:

- A GitHub account with access to this repo
- AWS Academy Learner Lab console access through the course session; no IAM Identity Center SSO or shared root login
- Jamendo client ID (one per team) from the [Jamendo developer portal](https://devportal.jamendo.com/)

Verify your setup:

```bash
node -v
git --version
```

---

## Getting Started

### 1. Clone and install

```bash
git clone <repo-url>
cd runman
npm ci
```

### 2. Learner Lab access

Local UI/builds need no AWS credentials. The current lab permits Cognito user
pools/app clients, but no custom IAM roles. Use Academy session/Console access
for the later approved pool setup; optional CLI access uses the lab's expiring
access key, secret key, and session token outside the repository. See
[authentication setup](AUTH_DEPLOYMENT.md). Do not configure SSO or embed LabRole
credentials in the browser.

### 3. Environment variables

Create `backend/.env` from `backend/.env.example` (do not commit it), then set:

```
JAMENDO_CLIENT_ID=your_client_id_here
```

### 4. Standalone Cognito configuration (checkpoint 4A)

The approved Learner Lab path uses a standalone user pool and a public SPA client
with **no client secret**, no identity pool, and no custom IAM roles. Prefer
`us-west-2`; the local adapter also permits the lab's `us-east-1`. The previous
Gen 2/backend-provisioning plan is superseded for this lab. `amplify/` and SAM
remain reference only: do not deploy them unchanged for this auth path or start a sandbox.

For a pool/client already created through the approved lab Console, copy
`frontend/cognito-config.example.json` to ignored `frontend/cognito-config.json`
and replace its fake region/pool/client IDs with the public values. This is manual
config, not generated outputs, and there is no fallback to `amplify_outputs.json`.
The adapter validates allowed regions/IDs and explicitly configures only
`Auth.Cognito` before rendering. It does not configure AWS credentials, API, or storage.
The raw JSON is embedded in the browser bundle: never put secrets in it even if
unknown fields are rejected. Restart/rebuild after changing the file.

Root `amplify.yml` now contains only static install/check/build steps and no AWS
provisioning. Hosting availability and config delivery remain undecided; a fresh
checkout lacks the ignored file and intentionally builds with sign-in unavailable.
See [authentication setup](AUTH_DEPLOYMENT.md) for future pool/client settings and
live checks. The supplied public IDs are configured locally; actual account/email
flows and app-client settings have not been verified by the implementation agent.

The cassette library at `/library` and editor at `/cassettes/:id/edit` support
guest drafts and signed-in account libraries. Status and About remain public.
The branded `/login` form uses Cognito SRP through the
Amplify SDK for sign-up, email confirmation/resend, password reset, and sign-in.
Same-session sign-up confirmation completes SDK-managed SRP auto-sign-in and then
opens `/library`. If that temporary SDK context expired/reloaded, confirmation
returns to login with a clear message; passwords are not saved by the app.
Welcome/login redirect confirmed sessions to `/library`; dashboard and login share
one SDK-backed session store, with no custom session cookie. It waits for a
settled authenticated identity and offers sign-out; account changes reset its local
state. Passive focus/token-refresh checks preserve a still-valid mounted account;
sign-out, failure, and account transitions remove private content. Missing,
malformed, or unusable configuration shows a sign-in setup message
without mounting the sign-in flow or private content. The app still builds/runs
without outputs and never simulates authenticated cloud access.

The signed-in dashboard displays identity status and local audio preview. In the
tape editor, **Save to account** calls the Cognito-protected cassette API; edits
otherwise remain local drafts scoped by account. The library loads saved tapes,
offers pagination, and copies only explicitly selected old browser/guest tapes
into new account drafts. Conflicts preserve edits and offer confirmed reload or
a new copy. Uploads and recordings use the authenticated media API and private S3
storage after manual deployment; local preview remains available without it.
See [the S3 handoff](S3_IMPLEMENTATION.md) and [console setup](S3_CONSOLE_SETUP.md).

For durable saves, create the DynamoDB table yourself and configure the backend
using [the console setup guide](DATABASE_CONSOLE_SETUP.md). Cassette API storage
defaults to disabled; explicit memory mode is local and ephemeral. The frontend
does not contain AWS credentials. No resources are provisioned by this code.
See [the implementation handoff](DATABASE_IMPLEMENTATION.md) for scope and pickup.
For manual Lambda + API Gateway setup using the existing LabRole, follow
[backend deployment preparation](BACKEND_DEPLOYMENT.md). `npm run package:backend`
creates the ignored upload ZIP and runs offline handler checks; it deploys nothing.
Run `npm run test:cassette-frontend` for offline client/store tests. The user has
confirmed live save/reload, stale-save conflict, and account separation; public API
and CORS checks also passed. See the handoff for the precise tested scope and
remaining direct-API/pagination checks. Audio authorization remains separate.

The retained Express `/api/items` example has no authentication or per-user ownership
and is **disabled by default**. For local examples only, set both `NODE_ENV=development`
and `ENABLE_LEGACY_EXAMPLES=true` in `backend/.env` (the dev script does not set
`NODE_ENV` for you). Leave `ITEMS_TABLE` blank for the in-memory store. Never put
private cassette data in this example or publish the SAM scaffold alongside Amplify.

All example methods/subpaths return 404 unless that exact local opt-in is active.
Production/unset modes and AWS execution markers deny it even with the flag enabled;
the Lambda entry point always disables examples independently of environment values.
An unsafe opt-in is ignored rather than stopping the server, so `/api/health` stays
public and available. Private tape data uses the separate Cognito-protected
`/api/cassettes` API and never passes through these example endpoints.

### 5. Run the app

```bash
npm run dev
```

---

## Local checks

```bash
npm run typecheck             # all workspaces plus Amplify definitions
npm run typecheck:amplify     # infrastructure definitions only; no AWS deployment
npm run build                # retained Lambda bundle plus frontend
npm run test:auth            # configuration and private-render boundary tests
npm run test:legacy-api      # example exposure, local memory CRUD, and Lambda guard
```

Use Node.js **24 LTS** for development and optional CI. The legacy Gen 2 CLI has a
Node 25 incompatibility, but that CLI is not used for this standalone user-pool
path. Legacy definitions remain typechecked without deployment. Focused
tests use Node's test runner through the installed `tsx` tooling and server rendering;
they verify configuration failure and private-content boundaries, not live Cognito
flows, browser interactions, or backend authorization.
Legacy API tests run isolated local HTTP servers and invoke the exported Lambda
handler with API Gateway events, using sanitized environments and no AWS requests.

---

## Cassette Data Model

Agreed shape for a cassette object, so everyone can build against it in parallel:

```js
{
  id: "string",
  label: "string",
  colors: { shell: "#hex", label: "#hex" },
  stickers: [{ id, src, x, y, rotation, scale }],
  sideA: [{ id, title, artist, source: "jamendo" | "upload" | "recording", url, duration }],
  sideB: [ /* same shape as sideA */ ]
}
```

---

## Team Roles

| Role | Responsibilities | Owner |
|---|---|---|
| Player + audio engine | Playback, controls, side flip, effects | |
| Cassette designer | SVG cassette, colors, stickers, labels | |
| Library + drag and drop + data | Shelf UI, DynamoDB save/load | |
| Music sources + recording | Jamendo search, file upload, mic recording, deployment, pitch | |

---

## Event Timeline

- **Fri, Nov 13 — 4:00 PM:** Registration opens
- **Sat, Nov 14 — 4:00 PM:** Code submission
- **Sat, Nov 14 — 4:00–6:00 PM:** Demonstration, judging, dinner
- **Sat, Nov 14 — 7:00–8:00 PM:** Awards ceremony

Location: Science and Technology Building, BYU-Idaho

---

## Resources

### Frontend
- [React docs](https://react.dev/)
- [Vite docs](https://vite.dev/guide/)
- [dnd-kit docs](https://docs.dndkit.com/)
- [react-konva docs](https://konvajs.org/docs/react/)
- [Howler.js](https://howlerjs.com/)

### Browser audio
- [Web Audio API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MediaRecorder API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [getUserMedia (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

### Music and sound
- [Jamendo API v3.0 docs](https://developer.jamendo.com/v3.0/docs)
- [Jamendo developer portal](https://devportal.jamendo.com/)
- [Freesound API docs](https://freesound.org/docs/api/) (sound effects)

### AWS
- [Cognito browser app clients](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html)
- [Cognito email verification/recovery delivery](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html)
- [Amplify UI reference (retained tooling)](https://ui.docs.amplify.aws/react/connected-components/authenticator)
- [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) (set an alert to protect credits)

---

## Music Attribution

Tracks from Jamendo are Creative Commons licensed, and each track has its own license terms. RunMan displays the artist name and license for every Jamendo track played.

---

## License

TBD
