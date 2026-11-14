# Private audio: manual Learner Lab setup

Goal: prepare private S3 storage for uploads and recordings. You perform these
steps in the AWS console; agents do not change AWS resources. Public Explore
storage is separate. Frontend/backend code must also be deployed before testing.

## 1. Create the private bucket

Start the Learner Lab, open the AWS console, and select **Oregon (us-west-2)**,
matching the existing Lambda, Cognito pool and DynamoDB table.

Open **S3 → General purpose buckets → Create bucket**:

| Setting | Value |
| --- | --- |
| Bucket type | General purpose |
| Bucket name | A unique name, e.g. `runman-private-audio-your-team-2026` |
| Region | `us-west-2` |
| Object Ownership | ACLs disabled / Bucket owner enforced |
| Block Public Access | Keep all four settings enabled |
| Bucket Versioning | Enable |
| Default encryption | Server-side encryption with Amazon S3 managed keys (SSE-S3) |
| Object Lock | Disabled |

Create the bucket. Do not enable static website hosting or add public permissions.
Do not reuse Explore's `UPLOADS_BUCKET`. No folders need to be created manually.

Under **Properties**, confirm versioning is **Enabled**, not Suspended. Wait
15 minutes after first enabling it before uploads; AWS documents a propagation
window. The backend rejects unversioned objects.
[Bucket creation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html),
[versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/manage-versioning-examples.html).

## 2. Configure browser CORS

Open the bucket → **Permissions → Cross-origin resource sharing (CORS) → Edit**.
For local development, paste:

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173"],
    "AllowedMethods": ["POST", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "range", "x-amz-*"],
    "ExposeHeaders": ["ETag", "x-amz-version-id", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

Add the actual hosted frontend origin to `AllowedOrigins` when deployed, e.g.
`https://your-app.example.com`. Origins have no path or trailing slash. Ports
must match; `localhost` and `127.0.0.1` are different origins. Do not add OPTIONS
to this S3 configuration. CORS does not grant access to private objects.
[S3 CORS configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html).

## 3. Check the existing LabRole

Open **Lambda → runman-api → Configuration → Permissions**. Confirm its execution
role is the existing **LabRole**. Inspect its effective permissions if the lab
allows this. The backend requires:

| Resource | Required actions |
| --- | --- |
| `arn:aws:s3:::YOUR-BUCKET` | `s3:GetBucketVersioning` |
| `arn:aws:s3:::YOUR-BUCKET/private/*` | `s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion` |

Existing DynamoDB and logging permissions must remain. These are permission
requirements, not instructions to create or modify IAM roles/policies. If the
lab denies an operation, ask the instructor to confirm permitted LabRole access.
Do not work around it with public access or browser AWS keys. With existing
same-account LabRole permissions, no additional bucket Allow policy is needed.
[S3 operation permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html).

## 4. Configure the existing Lambda

In **Configuration → Environment variables → Edit**, preserve existing values and add:

```text
MEDIA_STORAGE_MODE=s3
PRIVATE_AUDIO_BUCKET=YOUR-EXACT-BUCKET-NAME
```

The bucket variable contains only the name, without `s3://`, ARN or URL. Keep
`CASSETTE_STORAGE_MODE=dynamodb`, the existing `CASSETTES_TABLE`, Cognito IDs,
cursor secret and `CORS_ORIGINS`. If Explore is configured, keep `UPLOADS_BUCKET`
pointing to its separate public-catalog bucket.

Do not add `AWS_REGION` to Lambda: the runtime supplies it. Do not add AWS access
keys/session tokens. LabRole supplies server credentials. For local backend
development, use the same region and authorized temporary lab credentials in
your ignored local configuration; never frontend configuration.

## 5. Deploy the current backend and expose media routes

Build from `feat/s3-integration`:

```powershell
npm run package:backend
```

Upload `backend/dist/runman-api.zip` to the existing Lambda using **Code → Upload
from → .zip file**. Keep handler `lambda.handler` and the existing execution role.
See [the backend deployment guide](BACKEND_DEPLOYMENT.md) for package details.

In the existing **API Gateway HTTP API → Routes**, add all three routes, each
using the existing `runman-api` Lambda integration with payload version 2.0:

```text
POST /api/media/uploads
POST /api/media/complete
POST /api/media/playback
```

Keep route authorization NONE as in the existing API: Express verifies Cognito
access tokens itself. Preserve existing routes. Under Gateway **CORS**, add
`POST` to existing allowed methods; retain exact frontend origins, headers
`Authorization` and `Content-Type`, and credentials off. Save. If the stage does
not auto-deploy, deploy your changes. Lambda `CORS_ORIGINS` must match too.

## 6. Preserve versions and verify after frontend deployment

Do not add lifecycle expiration rules, including deletion of noncurrent versions.
The app pins finalized audio to a specific version; deleting it breaks tapes.
Do not manually change READY records or remove their S3 objects. Cleanup is a
separate feature; cancelled/unused uploads can remain stored.

After deploying the frontend integration, sign in, upload a short clip, add it to
a cassette, Save to account, reload and play. Confirm S3 has an object under
`private/<user-sub>/media/<id>` with a non-null Version ID and DynamoDB has a READY
`MEDIA#<id>` record. Also test a second account cannot use the first account's
reference. No new table or Cognito identity pool is needed.

An unsigned request to a media route should return 401; this checks routing/auth
only. A 503 can mean missing configuration, disabled versioning or LabRole access
failure. Browser CORS errors need the exact origin allowed in S3 and API Gateway.
These instructions are preparation; no live S3 integration has been verified by
the agent. Never paste credentials, access tokens or signed upload/playback URLs
into chat, logs or Git.
