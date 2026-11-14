# Learner Lab authentication: checkpoints 4A and 4B

## Current boundary
4A prepares local integration only. Keep Amplify's SDK/Authenticator, but connect
it directly to a standalone Cognito user pool and public browser client. No pool,
client, role, identity pool, hosting connection, or live authentication has been
created or verified. **4B creation and live tests require another go-ahead.**

The $50 AWS Academy Learner Lab allows the confirmed Cognito user-pool/client
operations in `us-west-2` or `us-east-1`; prefer `us-west-2`. It does not allow
custom IAM role creation. This authentication path does not use Gen 2/CDK/SAM.
Do not deploy the retained scaffolds unchanged, start a sandbox, or create a backend
deployment role. Other LabRole-based deployments require separate review. Amplify
Hosting availability is unconfirmed. Audio belongs to another chat.

## Lab access (future approved session)
Start the Academy Learner Lab session and use its AWS Console link. This is not
IAM Identity Center SSO. If an approved CLI workflow is later needed, use the
lab-provided temporary credential method, if available, and configure it outside
this repository. Refresh according to the lab instructions and credential expiry.
Never paste them into chat, Git, `.env` browser variables, or JSON public config.
The precreated `LabRole` is for supported server-side services, not browser access.
No installation, login, profile write, or AWS request is performed by 4A.

## 4B user-pool/client settings to review before creation

| Setting | Required value |
|---|---|
| Region | `us-west-2` preferred; `us-east-1` also supported by the local adapter |
| Sign-in and registration | Email/password; self-registration enabled; email required and automatically verified |
| Verification | Email code, including resend; no automatic confirmation shortcut |
| Password policy | Minimum 8, requiring lowercase, uppercase, number, and special character (matches UI metadata) |
| Recovery | Verified email for password reset |
| Email delivery | Cognito default sender; no custom SES identity or custom sender Lambda |
| MFA / social providers | Disabled for this agreed demo; no SMS role or external provider setup |
| App type | SPA/public browser client; **no client secret** |
| Explicit auth flows | `ALLOW_USER_SRP_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`; keep refresh-token rotation disabled for this flow |
| Client attribute permissions | Read email and email verification; write required email; no custom attributes needed |
| Domain / OAuth login | Not required: Authenticator uses Cognito APIs directly |
| Identity pool / IAM roles | None for browser authentication; do not create or embed them |

Confirm in the console that the actual app client has no secret: its ID alone
cannot prove that. If lab permissions reject an operation, stop and report the
exact failure; do not add roles, policies, or switch to a broader deployment path.

## Public configuration and local build
After approved pool/client creation, copy
`frontend/cognito-config.example.json` to ignored `frontend/cognito-config.json`
and replace the fake IDs. Only these public fields are accepted:

```json
{
  "region": "us-west-2",
  "userPoolId": "us-west-2_ExampleOnly",
  "userPoolClientId": "examplebrowserclientonly"
}
```

This is manually supplied config, not generated Amplify outputs. Its raw contents
are embedded in the browser bundle: **never put secrets in the file**, even though
the validator rejects unknown fields. There is no fallback to `amplify_outputs.json`.
The adapter explicitly builds `Auth.Cognito` with no identity-pool, credentials,
API, or storage configuration; this grants no access to private backend resources.

Restart the dev server or rebuild after changing IDs. Missing/invalid config keeps
sign-in unavailable and public pages usable. The example IDs are fake, not a live
pool. Local `npm run build` and the frontend-only `amplify.yml` recipe execute no
AWS provisioning commands. A clean hosted checkout has no ignored config and
intentionally builds an unconfigured app. Config delivery and an allowed static
host must be reviewed later; 4A does not establish a live Hosting deployment.

## 4B live checks after creation is approved
Record the pool/client public IDs, region, tested commit, and outcomes without
passwords or tokens. Verify sign-up, rejection before email confirmation,
confirmation/resend, password reset/new-password sign-in, reload/session refresh,
sign-out, and switching between two accounts without previous-account UI.
A later approved static host must support HTTPS and SPA routing for `/dashboard`.
Cassette/file authorization is outside this authentication checkpoint.

References: [Cognito public app clients](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html),
[Cognito email delivery](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html).
