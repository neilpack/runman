# Create the cassette database yourself

Goal: create one DynamoDB table for private tape metadata. Audio files belong in
S3 through the separate audio implementation. The frontend Save flow calls the
authenticated backend API; creating a table alone does not configure or deploy
that backend.

## 1. Create the table

1. Start your AWS Academy Learner Lab and open its AWS console.
2. Select **Oregon (`us-west-2`)**, matching the existing Cognito pool.
3. Open **DynamoDB → Tables → Create table**.
4. Enter these exact settings (key names are case-sensitive):

   | Setting | Value |
   | --- | --- |
   | Table name | `runman-cassettes` |
   | Partition key | `PK`, type **String** |
   | Sort key | `SK`, type **String** |
   | Table class | **DynamoDB Standard** |
   | Capacity mode | **On-demand** |
   | Encryption | **Owned by Amazon DynamoDB** (AWS owned key) |

5. Use **Customize settings** if needed to confirm capacity mode and encryption.
   Leave secondary indexes absent, Streams and TTL off, and other settings at
   their defaults. Do not create a customer-managed encryption key or IAM role.
6. Choose **Create table** and wait for status **Active**.

Only `PK` and `SK` are defined at table creation. The API will write `payload`,
`revision`, `schemaVersion`, `createdAt`, and `updatedAt` as item attributes. Do
not create a table for each user or tape, or enter literal `USER#...` as a key name.

See AWS's [table creation guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/getting-started-step-1.html)
and [encryption guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/encryption.tutorial.html).

## 2. Configure the backend after creation

Set these **server-only** values in your ignored backend environment, preserving
existing settings. See `backend/cassettes.env.example` for the complete template.

```dotenv
AWS_REGION=us-west-2
CASSETTE_STORAGE_MODE=dynamodb
CASSETTES_TABLE=runman-cassettes
COGNITO_USER_POOL_ID=<existing user pool ID>
COGNITO_USER_POOL_CLIENT_ID=<existing public app client ID>
CASSETTE_CURSOR_SECRET=<a privately generated random secret>
```

Use the existing Cognito IDs from your ignored `frontend/cognito-config.json`;
no new pool, app client, or identity pool is needed. Generate a cursor secret
locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Keep it stable across API instances and restarts; changing it invalidates old
pagination cursors. Keep its output private and out of source control.

The AWS SDK also needs authorized server credentials. For local development use
the lab's current temporary session through your local AWS credential provider;
include the session token and refresh the session when it expires. Never put
temporary keys in the frontend, a committed file, or chat. Do not create IAM users
or custom roles. A later deployed API must use the pre-created **LabRole**, subject
to review of its existing DynamoDB permissions. The table itself needs no execution
role selection.

Restart the backend after configuration. Storage mode `memory` is an explicit,
ephemeral local-development option, not a connection to the table. Default mode
`disabled` refuses cassette requests. Table or credential errors never trigger a
memory fallback.

## 3. What to verify later

After configuring and starting the backend, sign in, create a tape, and choose
**Save to account** in the editor. Then open
**DynamoDB → Tables → runman-cassettes → Explore table items**. The backend should
have written `PK=USER#<verified Cognito sub>` and `SK=CASSETTE#<tape id>` with the
document metadata. Use a second signed-in account to verify it cannot list, read,
update, or delete that tape. A second stale save should return a revision conflict.

Keep the table empty until an authorized API request writes a real tape. Do not
add fabricated owner records to work around authentication. If you receive
`AccessDenied`, check the selected region, active lab session, and existing role
permissions; do not broaden IAM permissions or deploy the retained SAM/Amplify
scaffolds to work around lab restrictions.

Backend hosting/API Gateway configuration and S3 authorization remain later
checkpoints. Verify local Save/refresh against the manually configured backend
before preparing a hosted deployment. Agents do not create or change AWS resources.
