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
npm install
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
credentials disabled. No backend has been deployed or connected to the UI by this
checkpoint. DynamoDB, S3, and their ownership rules are later tasks.

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
frontend configuration. The next identity checkpoint will load these outputs and
show a setup message when they are absent. Local scaffolding still runs without
AWS access, but it does not simulate authenticated cloud access.

The retained Express `/api/items` example is not authenticated and has no per-user
ownership. Do not use it for private cassette data or publish the SAM example;
restricting that example is a later checkpoint.

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
```

Use Node.js **24 LTS** for development and CI. On the current Node 25.2.1 machine,
the Amplify CLI smoke check fails in `@typescript/vfs` (`localStorage.getItem is not
a function`), although typecheck/build pass; do not use Node 25 for deployment.
The CLI still needs verification under Node 24 before cloud provisioning.
A version-only check on Node 25 succeeded with process-local
`NODE_OPTIONS=--no-experimental-webstorage`; this does not validate cloud deployment.
`amplify/package.json` scopes ESM to the infrastructure directory without changing the existing root
package's module behavior. Backend packages/CLI are root dev dependencies; frontend
Amplify runtime/UI packages are installed, with configuration and identity UI still pending.

### Shared AWS and music tooling

Run `npm install` from the repo root to install every workspace's dependencies.

| Work | Package/API |
|---|---|
| Frontend auth, data, and stored audio | `aws-amplify` (`aws-amplify/auth`, `aws-amplify/data`, `aws-amplify/storage`) |
| Sign-in components | `@aws-amplify/ui-react` |
| Infrastructure | Root Amplify backend/CLI and CDK dependencies |
| Retained Express AWS helpers | Existing AWS SDK v3 DynamoDB/S3 packages in `backend/` |
| Jamendo requests and playback/recording | Browser `fetch`, audio/Web Audio, and MediaRecorder APIs; no extra package required |

Set `VITE_JAMENDO_CLIENT_ID` in `frontend/.env.local`. AWS operations will also need
the shared backend's generated outputs and Amplify configuration; installing packages
does not provision or connect cloud resources. Never include AWS credentials in browser code.

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
