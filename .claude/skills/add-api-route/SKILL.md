---
name: add-api-route
description: Add a new typed API endpoint end-to-end in runman — shared types, backend service and route, and the frontend API client. Use when asked to add an endpoint, resource, or API call.
---

# Add an API route

Use `items` as the reference implementation throughout:
`shared/src/index.ts` → `backend/src/services/itemsService.ts` → `backend/src/routes/items.ts`
→ `backend/src/app.ts` → `frontend/src/api/client.ts`.

## Steps

1. **Types** — in `shared/src/index.ts`, add the entity type and any request/response types
   (e.g. `Run`, `CreateRunRequest`).

2. **Service** — create `backend/src/services/<name>Service.ts`:
   - Define a store interface.
   - Implement a DynamoDB version using `dynamo` from `../aws/clients.js` and an in-memory version.
   - Choose based on a new config value (e.g. `config.aws.runsTable`), added in
     `backend/src/config.ts` and `backend/.env.example`.

3. **Route** — create `backend/src/routes/<name>.ts` with an Express `Router`. Validate input and
   throw `HttpError(400, ...)` for bad requests and `HttpError(404, ...)` for missing records.
   Use `.js` extensions in relative imports (ESM).

4. **Register** — in `backend/src/app.ts`: `app.use('/api/<name>', <name>Router);`

5. **AWS resources** (if DynamoDB is used) — in `backend/template.yaml`, add a table, a
   `DynamoDBCrudPolicy` for it on `ApiFunction`, and pass its name as an env var.

6. **Client** — add typed methods to the `api` object in `frontend/src/api/client.ts`.

7. **Verify** — from the repo root:
   - `npm run typecheck`
   - `npm run build -w backend`
   - Optionally, start `npm run dev:backend` and `curl` the new endpoint.
