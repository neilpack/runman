# runman

> One-line pitch goes here: what runman does and who it's for.

Hackathon project. React frontend + Node/Express backend on AWS (Lambda, API Gateway, DynamoDB, S3).

## Quick start

Requires Node 22+.

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000/api/health

No AWS account needed for local dev. Without `ITEMS_TABLE` set, the backend uses an in-memory store.

## Repo layout

```
runman/
├── frontend/            React 19 + Vite + TypeScript + React Router
│   └── src/
│       ├── pages/       One file per route (HomePage, DashboardPage, …)
│       ├── components/  Reusable UI (Layout, Button, Card)
│       ├── api/         Typed client for the backend
│       ├── hooks/       Shared React hooks (useAsync)
│       ├── styles/      global.css: design tokens + base styles
│       └── router.tsx   Route table
├── backend/             Express 5 API, runs locally or on AWS Lambda
│   ├── src/
│   │   ├── routes/      HTTP handlers (health, items)
│   │   ├── services/    Business logic + storage (DynamoDB or in-memory)
│   │   ├── aws/         AWS SDK v3 clients + S3 helpers
│   │   ├── middleware/  Error handling
│   │   ├── app.ts       Express app (shared by local + Lambda)
│   │   ├── index.ts     Local dev server
│   │   └── lambda.ts    Lambda handler
│   └── template.yaml    AWS SAM: Lambda + HTTP API + DynamoDB + S3
├── shared/              @runman/shared: API types used by both sides
├── .claude/
│   ├── agents/          Claude Code subagents
│   └── skills/          Claude Code skills
├── AGENTS.md            Conventions + subagent/skill docs for AI agents
└── CLAUDE.md            Points Claude Code at AGENTS.md
```

## Scripts (run from root)

| Command                | Description                                  |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Run backend + frontend together              |
| `npm run dev:frontend` | Frontend only                                |
| `npm run dev:backend`  | Backend only                                 |
| `npm run typecheck`    | Type-check every workspace                   |
| `npm run build`        | Build Lambda bundle + frontend static site   |

## Environment

Copy the examples and fill them in. `.env` files are git-ignored.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

## AWS

### Using real AWS resources locally

1. Install the [AWS CLI](https://aws.amazon.com/cli/) and run `aws configure --profile runman`.
2. In `backend/.env`, set `AWS_PROFILE=runman`, `AWS_REGION`, and `ITEMS_TABLE` / `UPLOADS_BUCKET`
   (use the names from the deploy outputs below).

### Deploying the backend

Requires the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).

```bash
cd backend
npm run sam:build
npm run sam:deploy     # first time: guided, saves samconfig.toml
```

The deploy prints `ApiUrl`. Set it as `VITE_API_URL` in the frontend, then
`npm run build -w frontend` and host `frontend/dist/` anywhere static (S3 + CloudFront, Amplify, Vercel, …).

## Working with AI agents

See [AGENTS.md](AGENTS.md) for the codebase conventions and the list of Claude subagents and skills.

## Team

| Name | Area |
| ---- | ---- |
|      |      |
