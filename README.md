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
| Backend | AWS Amplify Gen 2 |
| Database | Amazon DynamoDB |
| File storage (recordings, uploads) | Amazon S3 |
| Auth | Amazon Cognito (email/password, verification, recovery) |
| Hosting | AWS Amplify Hosting |

---

## Prerequisites

### Shared tooling

Use **Node.js 24 LTS** (`.nvmrc`) and run `npm ci` from the repo root to install
the locked dependencies for all workspaces.

| Work | Installed tooling |
|---|---|
| AWS infrastructure | Root dev dependencies: `@aws-amplify/backend`, `@aws-amplify/backend-cli`, `aws-cdk-lib`, `constructs`, `@types/node` |
| Frontend AWS access | `aws-amplify` for auth, data, and storage |
| Sign-in components | `@aws-amplify/ui-react` |
| Existing backend AWS helpers | AWS SDK v3 DynamoDB/S3 clients, document client, and S3 presigner |
| Music search and audio | Browser `fetch`, audio/Web Audio, and MediaRecorder APIs; no extra library required |

Set `VITE_JAMENDO_CLIENT_ID` in `frontend/.env.local` (see the example file).
AWS runtime access also needs generated backend outputs; packages alone do not
provision resources. The frontend configures Amplify before rendering.
Do not put AWS credentials in frontend code or commit generated outputs.

AWS CLI is installed separately from npm dependencies. Cloud provisioning is a
later checkpoint, not part of installing tooling or running the frontend.

Every team member needs:

- [Node.js 24 LTS](https://nodejs.org/) (`.nvmrc` pins major 24)
- [Git](https://git-scm.com/downloads)
- [VS Code](https://code.visualstudio.com/) (recommended), with [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) and [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- Chrome or Edge (for DevTools and microphone support)

Accounts:

- A GitHub account with access to this repo
- AWS access on the team account (IAM or IAM Identity Center user — don't share the root login)
- Jamendo client ID (one per team) from the [Jamendo developer portal](https://devportal.jamendo.com/)

Verify your setup:

```bash
node -v
git --version
aws --version
```

---

## Getting Started

### 1. Clone and install

```bash
git clone <repo-url>
cd runman
npm ci
```

### 2. Configure AWS credentials

```bash
aws configure        # or: aws configure sso
```

See [Amplify Gen 2: Configure AWS for local development](https://docs.amplify.aws/react/start/account-setup/).

### 3. Environment variables

Create `frontend/.env.local` (do not commit it):

```
VITE_JAMENDO_CLIENT_ID=your_client_id_here
```

### 4. Shared Amplify backend (provisioning is a later checkpoint)

`amplify/` currently defines Cognito email/password authentication, with guest
credentials disabled. Frontend identity integration is implemented; no backend has
been provisioned or live authentication verified by this checkpoint. DynamoDB,
S3, and their ownership rules are later tasks.

The demo will use **one shared backend in `us-west-2`**, deployed from `main` through
Amplify Hosting. Do not run a personal `ampx sandbox` or deploy the existing SAM
template alongside it: both create cloud resources.

After the shared deployment exists, obtain its generated frontend configuration
from the repo root (replace the app ID; this reads deployment outputs):

```bash
npx ampx generate outputs --app-id <amplify-app-id> --branch main --out-dir frontend
```

Use your team AWS profile with region `us-west-2`. Keep generated
`amplify_outputs.json` and `.amplify/` out of Git; never put AWS credentials in
frontend configuration. The frontend reads `frontend/amplify_outputs.json` at
build/startup through a raw-file glob, validates the auth configuration, and
configures Amplify once before React renders. After obtaining or replacing outputs,
restart the dev server or rebuild the deployed frontend.

Home and About remain public. Dashboard uses Amplify Authenticator for email/password
sign-up, email confirmation/resend, password reset, and sign-in. It waits for a
settled authenticated identity and offers sign-out; account changes reset its local
state. Missing, malformed, or unusable configuration shows a sign-in setup message
without mounting the sign-in flow or private content. The app still builds/runs
without outputs and never simulates authenticated cloud access.

The signed-in dashboard currently displays identity status only. Cassette saving
and audio storage are not implemented. Test real verification/reset email delivery,
session reload, sign-out, and account switching after shared Cognito provisioning.

The retained Express `/api/items` example has no authentication or per-user ownership
and is **disabled by default**. For local examples only, set both `NODE_ENV=development`
and `ENABLE_LEGACY_EXAMPLES=true` in `backend/.env` (the dev script does not set
`NODE_ENV` for you). Leave `ITEMS_TABLE` blank for the in-memory store. Never put
private cassette data in this example or publish the SAM scaffold alongside Amplify.

All example methods/subpaths return 404 unless that exact local opt-in is active.
Production/unset modes and AWS execution markers deny it even with the flag enabled;
the Lambda entry point always disables examples independently of environment values.
An unsafe opt-in is ignored rather than stopping the server, so `/api/health` stays
public and available. This retires the public example API; it does not implement
private cassette authorization, which will use Amplify Data ownership rules.

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

Use Node.js **24 LTS** for development and CI. On the current Node 25.2.1 machine,
the Amplify CLI smoke check fails in `@typescript/vfs` (`localStorage.getItem is not
a function`), although typecheck/build pass; do not use Node 25 for deployment.
The CLI still needs verification under Node 24 before cloud provisioning.
A version-only check on Node 25 succeeded with process-local
`NODE_OPTIONS=--no-experimental-webstorage`; this does not validate cloud deployment.
`amplify/package.json` scopes ESM to the infrastructure directory without changing the existing root
package's module behavior. Backend packages/CLI are root dev dependencies; frontend
Amplify runtime/UI packages are installed and wired to generated outputs. Focused
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
- [AWS Amplify Gen 2 docs (React)](https://docs.amplify.aws/react/)
- [Amplify Data (DynamoDB)](https://docs.amplify.aws/react/build-a-backend/data/)
- [Amplify Storage (S3)](https://docs.amplify.aws/react/build-a-backend/storage/)
- [Amplify Auth (Cognito)](https://docs.amplify.aws/react/build-a-backend/auth/)
- [Amplify Hosting](https://docs.amplify.aws/react/deploy-and-host/)
- [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) (set an alert to protect credits)

---

## Music Attribution

Tracks from Jamendo are Creative Commons licensed, and each track has its own license terms. RunMan displays the artist name and license for every Jamendo track played.

---

## License

TBD
