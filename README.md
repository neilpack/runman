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
| Auth (optional) | Amazon Cognito |
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

Set `JAMENDO_CLIENT_ID` in `backend/.env` (see `backend/.env.example`). The backend proxies
Jamendo searches so the client ID is not included in the browser bundle. The frontend calls
`GET /api/music/search?q=...`.
AWS runtime access also needs generated backend outputs and Amplify configuration;
packages alone do not provision resources. Identity implementation is a separate change.
Do not put AWS credentials in frontend code or commit generated outputs.

The Amplify CLI crashes under this machine's Node 25.2.1 in `@typescript/vfs`;
use Node 24 LTS and verify the CLI before deployment. AWS CLI is installed separately
from npm dependencies. Commands below that create a cloud sandbox belong to the
later deployment workflow, not installing this tooling.

Every team member needs:

- [Node.js (LTS)](https://nodejs.org/)
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

Create a `.env.local` file in the project root (do not commit it):

```
VITE_JAMENDO_CLIENT_ID=your_client_id_here
```

### 4. Start a personal cloud sandbox

```bash
npx ampx sandbox
```

This deploys your own temporary backend (DynamoDB, S3, etc.) so you don't affect teammates.

### 5. Run the app

```bash
npm run dev
```

---

## Project Setup (already done — for reference)

```bash
npm create vite@latest runman -- --template react
cd runman
npm create amplify@latest
npm install aws-amplify @aws-amplify/ui-react
npm install @dnd-kit/core
npm install konva react-konva
npm install howler        # optional
```

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
