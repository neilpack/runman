# AGENTS.md — AI agent, subagent & skills guide

This is the single source of truth for AI coding agents (Claude Code, and any tool that reads
`AGENTS.md`) working in this repo. `CLAUDE.md` imports this file, so update **this** file, not that one.

Humans: if you add a subagent or skill, document it in the tables below.

---

## Project overview

**runman** is a hackathon project. It's an npm-workspaces monorepo:

| Path        | What it is                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| `frontend/` | React 19 + TypeScript + Vite + React Router. UI/UX pages.                  |
| `backend/`  | Node + Express 5 API. Runs locally and on AWS Lambda (via `serverless-http`). |
| `shared/`   | `@runman/shared`: TypeScript types shared by frontend and backend.        |
| `.claude/`  | Claude Code subagents (`agents/`) and skills (`skills/`).                  |

## Commands

Run from the repo root.

| Command                | Does                                                   |
| ---------------------- | ------------------------------------------------------ |
| `npm install`          | Install all workspaces                                 |
| `npm run dev`          | Backend on :4000 + frontend on :5173 together          |
| `npm run typecheck`    | `tsc` across all workspaces. **Run before finishing a task.** |
| `npm run build`        | Lambda bundle (`backend/dist/`) + frontend (`frontend/dist/`) |
| `npm run sticker -- <name>` | Add a Reicon icon to the cassette sticker tray (`--filled`, `--search <term>`) |

## Conventions

- **TypeScript everywhere**, `strict` on. No `any` unless unavoidable.
- **API contract lives in `shared/src/index.ts`.** When you add or change an endpoint, update the
  types there first, then the backend route, then `frontend/src/api/client.ts`.
- **All API routes are under `/api`.** Register new routers in `backend/src/app.ts`.
- **Backend layering:** `routes/` (HTTP only) → `services/` (business logic + storage) → `aws/` (SDK clients/helpers).
  Routes never call the AWS SDK directly.
- **Env vars are read only in `backend/src/config.ts`.** Add new ones there and to `backend/.env.example`.
- **AWS SDK v3 only** (`@aws-sdk/*`), never v2 (`aws-sdk`). Reuse clients from `backend/src/aws/clients.ts`.
- **Services must work without AWS** where practical (see the in-memory fallback in
  `itemsService.ts`) so teammates without credentials can still run the app.
- **Frontend:** pages in `src/pages/` (`XxxPage.tsx`), reusable UI in `src/components/`,
  hooks in `src/hooks/`. Import with the `@/` alias. Style with the CSS variables in
  `src/styles/global.css` rather than hard-coded colors.
- Throw `HttpError(status, message)` from routes for client errors; the error middleware formats it.
- Never commit `.env` files, AWS credentials, or `dist/` output.

## Ownership / parallel work

To avoid merge conflicts during the hackathon, keep changes inside your area where possible.
Files that **everyone** touches — edit them in small, separate commits:

- `shared/src/index.ts` (API types)
- `backend/src/app.ts` (route registration)
- `frontend/src/router.tsx` and `NAV_LINKS` in `frontend/src/components/Layout.tsx`

---

## Subagents (`.claude/agents/`)

Subagents are specialized Claude instances with their own prompt and tool access. Claude Code
picks them automatically based on their `description`, or you can ask for one by name
("use the backend-aws agent to …"). Format: a Markdown file with YAML frontmatter
(`name`, `description`, optional `tools`, `model`), followed by the system prompt.

| Agent          | File                              | Use it for                                                    |
| -------------- | --------------------------------- | ------------------------------------------------------------- |
| `frontend-ui`  | `.claude/agents/frontend-ui.md`   | Building/restyling React pages and components                 |
| `backend-aws`  | `.claude/agents/backend-aws.md`   | API routes, services, DynamoDB/S3, SAM template changes       |
| `code-reviewer`| `.claude/agents/code-reviewer.md` | Read-only review of a change before you push/merge            |

**Adding a subagent:** create `.claude/agents/<name>.md`, keep the `description` specific
(it's what triggers auto-selection), restrict `tools` to what it needs, and add a row above.

## Skills (`.claude/skills/`)

Skills are reusable step-by-step playbooks. Each is a folder with a `SKILL.md`
(frontmatter `name` + `description`, then instructions). Claude loads one when a task matches
its description; you can also invoke it directly as `/<skill-name>`.

| Skill           | Path                                    | What it does                                         |
| --------------- | --------------------------------------- | ---------------------------------------------------- |
| `add-api-route` | `.claude/skills/add-api-route/SKILL.md` | Adds a typed endpoint end-to-end (shared → backend → client) |
| `add-page`      | `.claude/skills/add-page/SKILL.md`      | Adds a new routed React page with nav link           |

**Adding a skill:** create `.claude/skills/<skill-name>/SKILL.md`, optionally with helper
scripts or templates in the same folder, and add a row above.

## Other Claude config

- `.claude/settings.json` — (not created yet) shared project settings such as permission
  allowlists. If the team adds one, commit it.
- `.claude/settings.local.json` — your personal overrides. Git-ignored.
- MCP servers, if the team adds any, go in `.mcp.json` at the repo root; document them here.
