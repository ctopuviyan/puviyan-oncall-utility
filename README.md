# Puviyan On-Call Utility

Internal tool for reviewing and correcting production Puviyan Firestore data.

## What It Covers

- Search app users from `informations`.
- Review daily `walking` and `cycling` documents by date range.
- Review lifetime `impact/lifetime` and `mobility/lifetime`.
- Review reward state from `users/{uid}/badgeProgress` and `users/{uid}/redeemedRewards`.
- Update whitelisted production documents with an audit trail in `oncallAuditLogs`.

## Local Setup

```bash
npm install
cp .env.example .env
```

Set either:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/prod-service-account.json
```

or:

```bash
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

Then:

```bash
npm run dev
```

Open `http://localhost:8787`.

If search does not return users, check `/api/health`. It should show
`"credentials":"configured"`. After adding or changing `.env`, restart the
server.

## Safety Notes

- This app uses Firebase Admin SDK, so do not expose it without authentication.
- Use Cloud Run IAM authentication for deployed internal access, or set
  `ONCALL_USERNAME` and `ONCALL_PASSWORD` if the service is intentionally public.
- Every write requires a correction reason and creates an `oncallAuditLogs` document.
- Writes are restricted to supported user data paths.

## Cloud Run Deployment

Deploy this as an internal Cloud Run service. Prefer a dedicated runtime service
account with Firestore read/write access instead of placing a Firebase key file
inside the image.

IAM-protected deployment environment variables:

```bash
FIREBASE_PROJECT_ID=puviyan-prod
CLOUD_RUN_IAM_AUTH=true
```

Recommended Cloud Run settings:

- Source: this repository.
- Build type: Dockerfile.
- Port: `8080`.
- Authentication: require authentication.
- Runtime service account: dedicated on-call utility service account.
- IAM role for the runtime service account: Firestore/Datastore user access for
  the target project.

Console flow:

1. Open Google Cloud Console for the production Firebase/GCP project.
2. Go to Cloud Run, then create a service.
3. Choose this repository and branch, using the Dockerfile.
4. Set the environment variables above.
5. Set the container port to `8080`.
6. Deploy and grant `roles/run.invoker` only to approved on-call accounts.

For local browser access to an IAM-protected Cloud Run deployment, use:

```bash
gcloud run services proxy puviyan-oncall-utility-prod \
  --region us-central1 \
  --project puviyan-prod \
  --port 8788
```

Then open `http://localhost:8788`.

If the service is intentionally made public, unset `CLOUD_RUN_IAM_AUTH`, set
`ONCALL_USERNAME` and `ONCALL_PASSWORD` from Secret Manager, and keep a strong
password. Do not put the password directly in shell history.
