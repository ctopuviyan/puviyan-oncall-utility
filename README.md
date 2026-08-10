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
- Set `ONCALL_USERNAME` and `ONCALL_PASSWORD` outside local-only use.
- Every write requires a correction reason and creates an `oncallAuditLogs` document.
- Writes are restricted to supported user data paths.
