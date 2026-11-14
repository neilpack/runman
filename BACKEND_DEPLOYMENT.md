# Manual Learner Lab API deployment

Goal: expose the existing Cognito-protected cassette API through API Gateway and
Lambda, using the existing DynamoDB table and precreated LabRole. **Step 4 prepares
code and instructions only. The user performs console changes.** No agent has
created, deployed, or verified these AWS resources.

## 1. Confirm the prerequisites

- Start the Learner Lab and select **Oregon (`us-west-2`)**.
- Confirm `runman-cassettes` is **Active**, with string partition key `PK` and
  string sort key `SK`. See [database console setup](DATABASE_CONSOLE_SETUP.md).
- Use the existing Cognito user pool/public app client. Obtain the two public IDs
  from your ignored `frontend/cognito-config.json`; create no replacement pool.
- In IAM, review the existing **LabRole**, without changing policies. It must trust
  Lambda, be passable by your lab session, permit CloudWatch logging, and permit
  `dynamodb:GetItem`, `Query`, `PutItem`, `UpdateItem`, and `DeleteItem` on the table.
  Cassette metadata needs no `Scan` or S3 permission. If review is unavailable or
  deployment/data access is denied, stop and resolve the lab permission with your
  instructor. Do not create users, roles, or broad policies as a workaround.

## 2. Build the upload package locally

From the repository root, with dependencies installed:

```powershell
npm run test:deployment
npm run package:backend
```

The second command builds the backend and creates:

- `backend/dist/runman-api.zip` — **only `lambda.mjs` at the archive root**.
- `backend/dist/runman-api.manifest.json` — archive/entry SHA-256, size, runtime,
  and handler. Keep it for comparison; do not upload it as function code.

The command inspects the exact archive, extracts its entry into an isolated
temporary directory, and runs HTTP API 2.0 smoke checks with networking prohibited.
Health must return 200, unsigned cassette requests 401, and legacy item methods
404, even with local-example flags set. It does not use your environment files,
AWS credentials, real Cognito tokens, or configuration IDs. Dist output is ignored.

Smoke runs on the locally installed Node version; the bundle targets Node 22.
This is not a test inside the AWS Lambda runtime or proof of IAM/database access.
Do not upload the repository, `.env`, public config JSON, or `node_modules`.
[AWS ZIP packaging reference](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html).

## 3. Create/configure Lambda yourself

1. Open **Lambda → Create function → Author from scratch** (an Event Function).
2. Name it `runman-api`; select **Node.js 22.x**, **arm64** architecture.
3. Expand **Change default execution role → Use an existing role → LabRole**.
   Do not accept an option that creates a new execution role. Create the function.
4. In **Code → Upload from → .zip file**, upload `backend/dist/runman-api.zip`.
5. In **Runtime settings → Edit**, set the handler to **`lambda.handler`**.
   It is not `index.handler` or `dist/lambda.handler`.
6. In **Configuration → General configuration**, set **512 MB**, **15 seconds**.
   Leave the function outside a VPC; it needs internet access for Cognito public
   signing keys and Jamendo. No layer or function URL is needed.
7. In **Configuration → Environment variables**, enter:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `CASSETTE_STORAGE_MODE` | `dynamodb` |
   | `CASSETTES_TABLE` | `runman-cassettes` |
   | `COGNITO_USER_POOL_ID` | Existing pool ID |
   | `COGNITO_USER_POOL_CLIENT_ID` | Existing public app-client ID |
   | `CASSETTE_CURSOR_SECRET` | Privately generated stable random secret |
   | `CORS_ORIGINS` | Exact frontend origin(s), comma-separated |
   | `JAMENDO_CLIENT_ID` | Your team's Jamendo client ID for music search |

Generate the cursor secret privately, as described in the database guide. Keep
the same secret across instances and code uploads; rotation invalidates old page
cursors. Never publish it or put it into frontend build settings. Leave
`ENABLE_LEGACY_EXAMPLES`, `ITEMS_TABLE`, and `UPLOADS_BUCKET` unset.

**Do not add `AWS_REGION` in the Lambda console:** it is reserved and supplied by
the runtime. Do not add temporary AWS access keys or session tokens; Lambda gets
credentials through LabRole. The local backend still needs explicit region and
authorized temporary credentials when run outside Lambda.
[AWS environment-variable rules](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html).

## 4. Create API Gateway yourself

1. Open **API Gateway → Create API → HTTP API → Build** (not REST API).
2. Add a **Lambda integration** for `runman-api` in `us-west-2`; name the API
   `runman-api`. Confirm its Lambda proxy **payload format version is `2.0`**.
3. Add these routes, each using that integration:

   | Method | Path |
   | --- | --- |
   | GET | `/api/health` |
   | GET | `/api/cassettes` |
   | GET | `/api/cassettes/{id}` |
   | PUT | `/api/cassettes/{id}` |
   | DELETE | `/api/cassettes/{id}` |
   | GET | `/api/music/search` |
   | GET | `/api/explore/songs` |
   | GET | `/api/explore/songs/trending` |
   | GET | `/api/explore/songs/{id}/audio` |
   | GET | `/api/explore/profiles` |
   | GET | `/api/explore/profiles/{username}` |

   The Explore routes were added by the newer main branch. Add them when manually
   deploying this updated bundle; existing deployed code is not updated by Git.
   Without an approved public catalog bucket, deployed Explore returns an empty
   catalog rather than local demo data. S3 setup remains separate.

4. Use the **`$default` stage**, with automatic deployment. Remove any catch-all
   route created by a wizard; do not expose `/api/items`.
5. Leave Gateway route authorization **NONE** for this implementation. Express
   independently verifies the Cognito access token on every cassette request;
   health and music search are intentionally public. Do not remove backend auth.
6. Configure **CORS**: exact frontend origin(s), allowed headers `Authorization`
   and `Content-Type`, methods `GET`, `PUT`, `DELETE`, `OPTIONS`, credentials off.
   Add localhost only if you will use that exact local origin. Do not use wildcard
   origins. API Gateway handles unauthenticated preflight; no separate OPTIONS
   Lambda route is needed with these explicit routes.
7. Confirm the console added the function's resource-policy permission allowing
   this API to invoke Lambda. This is separate from LabRole. If it was denied,
   stop rather than creating an integration role or granting unrestricted invoke.

Gateway CORS overrides integration CORS headers; configure its allowlist as well
as Express `CORS_ORIGINS`.
[HTTP API integration](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html),
[CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html),
[invoke permissions](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway.html).

## 5. Point the frontend at the API

Copy the API's invoke origin, for example
`https://<api-id>.execute-api.us-west-2.amazonaws.com`, into the frontend's private
local environment or hosting build variable **`VITE_API_URL`**. With `$default`,
include no stage suffix, `/api`, or trailing slash. Rebuild/restart the frontend;
Vite embeds this public URL at build time. Keep the existing public Cognito config.

## 6. User-run live verification (checkpoint 5)

Status, 2026-11-14: public health/authentication/CORS checks passed. The user reports
save/reload, stale-save conflicts, and second-account library/editor isolation work.
See [the verification record](DATABASE_IMPLEMENTATION.md#step-5-live-verification--2026-11-14)
for attribution and additional live checks that have not been performed.

- Open `/api/health`: expect 200. Unsigned `/api/cassettes`: expect 401, not 503.
- Sign in, create a library-only tape, choose **Save to account**, then reload the
  page and confirm its full appearance and ordered tracks return. Inspect the
  matching `USER#<sub>` / `CASSETTE#<id>` item in DynamoDB.
- Use two sessions to verify stale updates/deletes conflict, and a second account
  cannot list/read/change the first account's tape. Check pagination and CORS from
  the actual frontend origin. Do not paste tokens into chat or repository files.
- Uploaded/recorded tracks must remain in local drafts and receive explicit save
  refusal until separate server-side audio authorization integrates. Metadata
  deletion must not delete S3 files.

A 503 usually means cassette configuration is incomplete or storage access failed;
check region, table name, LabRole permissions and CloudWatch logs. A Gateway 500
can indicate missing Lambda invoke permission; a Lambda import error can indicate
wrong ZIP layout/handler. Keep request tokens and secrets out of diagnostic output.
The old `backend/template.yaml` and Amplify Gen 2 scaffolds remain reference only;
do not run their deployment commands unchanged. After preparation, wait for the
user's deployment/live-verification confirmation; agents perform no AWS mutations.
