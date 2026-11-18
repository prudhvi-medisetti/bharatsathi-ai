# BharatSathi AI — FastAPI AI Gateway

This server is the secure AI boundary between the React application and Gemini.

## Run locally

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env  # Windows
# or: cp .env.example .env
uvicorn app:app --reload --port 8000
```

Before using protected Firebase, email, recovery, or document endpoints, configure `backend/.env`:

- `FIREBASE_PROJECT_ID` and exactly one of `FIREBASE_SERVICE_ACCOUNT_FILE` or `FIREBASE_SERVICE_ACCOUNT_JSON`. Keep the service-account file private and outside source control.
- `FIREBASE_STORAGE_BUCKET` for document verification and downloads.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM` for branded transactional messages. `SMTP_FROM` controls the visible display name; the SMTP provider must authorize the sender domain.
- `RECOVERY_CODE_PEPPER` with a random server-only secret of at least 32 characters. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
- `APP_ENV=development` and `PUBLIC_APP_URL=http://localhost:5173` locally. In production use `APP_ENV=production` and the deployed HTTPS origin; production rejects localhost.
- `CORS_ORIGINS` with the exact frontend origins.
- `GEMINI_API_KEY` is optional; without it the API uses deterministic, scheme-grounded matching.

The health endpoint reports configuration readiness without exposing credentials:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

## Production notes

- Keep the Gemini key server-side; never add it to `VITE_*` variables.
- Configure Firebase Admin service-account credentials and `FIREBASE_STORAGE_BUCKET`. Document download and notification APIs always require a verified Firebase ID token; unlike chat, they never use demo identity. Missing Admin configuration returns `503`.
- Set `CORS_ORIGINS` to the deployed Firebase Hosting domains.
- For deployment, Render/Railway/Fly.io or a Python-capable VM can host this FastAPI service. Firebase Hosting can remain the frontend host.
- SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`) is required to send branded verification, email-change, account-recovery, document, and application messages. Keep all credentials server-side.
- Email verification is delivered only through the branded backend mailer; it does not fall back to Firebase's default email template. Configure Firebase Admin credentials and SMTP, then set `APP_ENV=development` and `PUBLIC_APP_URL=http://localhost:5173` locally. In production set `APP_ENV=production` and `PUBLIC_APP_URL` to the deployed HTTPS app origin (defaults to `https://bharatsathi-ai-1aed0.web.app`). Production mode rejects localhost URLs. The email button links to the app's verification route with a real Firebase-generated one-time action code, which the Firebase client SDK validates with `applyActionCode`; the backend never marks an account verified directly.
- Email changes use the `/email-change` route under `PUBLIC_APP_URL`; the frontend handler reads the one-time token from the URL fragment and POSTs it to the matching confirmation endpoint. The initiation token is valid for 30 minutes by default, resend attempts are rate-limited, and initiation requires a Firebase ID token with `auth_time` no older than five minutes. Tokens are random and only salted hashes are stored in the Admin-only `_private_email_change_requests` collection.
- `DOCUMENT_PIN_TTL_SECONDS` defaults to 600 (allowed range 60–3600); `DOCUMENT_PIN_MAX_ATTEMPTS` defaults to 5 (allowed range 1–10). PINs are random six-digit values. Firestore stores only a salted PBKDF2 hash, salt, expiry, attempt policy, and lock state; the PIN itself is emailed and is never added to document metadata.
- The signed document download URL is returned only after account authentication, ownership/path validation, PIN verification, and Storage existence checks. It is a GET URL expiring in five minutes; it must not be persisted or treated as a permanent link.
- The Admin SDK uses `_private_document_access_pins`, `_private_notification_sends`, `_private_email_change_requests`, `_private_account_recovery_codes`, and `_private_official_document_verifications`. Firestore client security rules deny client reads/writes to the recovery-code collection; other private collections are also denied by the rules' default-deny behavior. The official-verification record is trusted only when maintained by a trusted server/Admin process with `officialServiceConfirmed: true` and a non-empty `serviceName`; no verification provider or external document/OCR API is called.
- Normal email change uses a strict two-address sequence: verify the current address, verify the proposed address, then update Firebase Auth and `users/{uid}.email`. Only the explicit “I no longer have access to my current email” flow accepts the one-time recovery code; it still verifies the new address before changing Firebase Auth. Recovery codes are generated with Web Crypto, stored server-side only as salted PBKDF2/HMAC hashes, rate-limited, expire by policy, and are invalidated after successful recovery. The registration screen displays a newly issued code once and requires the user to confirm they saved it.
- Firestore client rules require the initial profile email to match the Firebase Auth token and disallow clients from changing that field later. Only the trusted backend's Admin SDK updates `users/{uid}.email` after the confirmation flow completes.
- If cross-service compensation cannot safely restore Firebase Auth after a Firestore write failure, the request is marked `recovery_required` and requires support. This is not an alternate client-side bypass.

## Protected API contracts

Document/application endpoints and email-change initiate/resend/cancel require `Authorization: Bearer <Firebase ID token>`. A missing/invalid token returns `401`; missing Firebase Admin configuration returns `503`. Email-change confirmation endpoints instead require the one-time token in the JSON body.

- `DELETE /api/v1/account/data` — requires a recently re-authenticated Firebase ID token. The backend derives the UID from that verified token, deletes the user's Storage prefix, Firestore records and private account metadata, then the client deletes the Firebase Authentication account.
- `POST /api/v1/documents/{document_id}/access-pin` — validates document ownership and its private Storage path, then emails the account a one-time PIN. Personal-vault records use `users/{uid}/documents/{documentId}/{fileName}` and do not require an application; an optional application association must belong to the same user and match its `schemeId`. Legacy application-path records remain supported. Returns `{"status":"sent","expires_in":600,"max_attempts":5}`. Requires SMTP and a Storage bucket.
- `POST /api/v1/documents/{document_id}/download-url` with `{"pin":"123456"}` — validates ownership and the same supported personal-vault or legacy Storage path, uses the stored validated `storagePath` (and `storageBucket` when present, which must match the configured bucket), consumes the PIN once, and returns `{"download_url":"...","expires_in":300}`. Bad PIN is `400`, expired PIN `410`, lockout `429`; missing bucket/file is `503`/`404`.
- `POST /api/v1/applications/{application_id}/notify-status` — emails and creates an in-app notification for the record's current supported user-managed status. Honors `applicationNotificationsEnabled` and `applicationDecisionNotificationsEnabled` when set. Repeated status/timestamp notifications return `{"status":"duplicate"}`; disabled preferences return `{"status":"skipped","reason":"..."}`.
- `POST /api/v1/documents/{document_id}/notify-status` — emails and creates an in-app notice for a current verified, mismatch, or needs-review record status. A verified status is described as user-managed unless the private Admin-maintained official-verification record confirms it.
- `POST /api/v1/auth/email-change/initiate` with `{"new_email":"..."}` — requires a recently authenticated Firebase ID token and a currently verified Firebase email, checks availability, and sends a hashed one-time confirmation link to the current account email. Returns `{"status":"pending_old_confirmation","expires_in":1800}`.
- `GET /api/v1/auth/email-change/status` — requires a Firebase ID token and returns only `{"state":"pending_old|pending_new|completed|...","new_email":"...|null","expires_in":123}` for the signed-in UID; no request returns `{"state":"none","new_email":null,"expires_in":0}`.
- `POST /api/v1/auth/email-change/confirm-old` with `{"token":"..."}` — consumes the current-address token and sends a second confirmation link to the proposed address. Returns `{"status":"old_email_confirmed","next_step":"confirm_new_email","expires_in":1800}`. Confirmation links place the token in the URL fragment; the frontend must submit it in the JSON body.
- `POST /api/v1/auth/email-change/confirm-new` with `{"token":"..."}` — after both address confirmations, updates Firebase Auth and the Firestore profile. Returns `{"status":"completed","notification_status":"sent|partial|skipped"}`. This token endpoint does not require the prior session, because the one-time token proves control of the new address.
- `POST /api/v1/auth/email-change/resend` with `{"stage":"old"|"new"}` and a recently authenticated Firebase ID token — rotates and resends only the pending stage's token. Returns `{"status":"sent","stage":"old|new","expires_in":1800}`.
- `POST /api/v1/auth/email-change/cancel` with a recently authenticated Firebase ID token — invalidates a pending request and sends cancellation notices when SMTP is available. Returns `{"status":"cancelled","notification_status":"sent|partial|skipped"}`.
- `GET /api/v1/auth/recovery-code/status` — requires Firebase ID token and reports recovery-code state only; it never returns the code.
- `POST /api/v1/auth/recovery-code` with `{"recovery_code":"<43-character Web-Crypto code>"}` — requires a recently authenticated Firebase session and stores only a keyed, salted PBKDF2 hash. The code is returned to the browser only by the browser's in-memory registration flow.
- `POST /api/v1/auth/email-change/recovery/initiate` with `{"new_email":"...","recovery_code":"..."}` — only called by the explicit lost-current-email UI. Reserves the code, rate-limits attempts, and emails a Firebase-account update confirmation to the new address. Firebase Auth remains unchanged until that link is confirmed.
- `POST /api/v1/documents/{document_id}/notify-upload` — requires a Firebase ID token, verifies ownership and any optional application metadata, confirms the file exists in the configured Storage bucket, honors the document email preference, and sends a deduplicated branded upload confirmation. It does not send the file or a Storage URL by email.

The Document Center is a personal vault: users select a document type and upload without choosing an application or satisfying a scheme checklist. The client uploads to Firebase Storage first and confirms the completed resumable upload with Storage metadata before writing the Firestore `documents` record. New records use the private path and can omit the application fields:

```json
{
  "userId": "<firebase uid>",
  "documentId": "<document id>",
  "fileName": "<single path-segment file name>",
  "storagePath": "users/<uid>/documents/<documentId>/<fileName>",
  "storageBucket": "<configured bucket, optional>"
}
```

When a user optionally links an application, `applicationId`, `schemeId`, and `schemeName` are stored and validated against an application owned by that same user.
The backend does not provide a general upload endpoint. `document_id` in the protected document routes may be either the Firestore `documents` record ID or its `documentId` field.

Status emails contain escaped HTML and a plain-text alternative. Tracker statuses are explicitly described as user-managed, not as government decisions. No file attachments, Storage URLs, document contents, OCR data, or sensitive document data are sent to external APIs.

## Local verification checklist

Run the focused backend unit tests from the project root:

```powershell
.\backend\.venv\Scripts\python.exe -m unittest backend.test_security_flows
```

These are real-service integration checks and require a Firebase service account, configured Firebase Authentication/Firestore/Storage, an authorized SMTP sender, and test email inboxes. Without those credentials, the server can start and report missing configuration, but the protected workflows cannot be completed end-to-end.

1. Copy `backend/.env.example` to `backend/.env`, fill the Firebase, SMTP, and recovery secret values, and run `uvicorn app:app --reload --port 8000`. In another terminal run `npm run dev`; set `VITE_API_BASE_URL=http://localhost:8000` in the frontend environment.
2. Register a test account and verify the branded email. Confirm `users/{uid}.email` is set and try Google sign-in to ensure it remains unchanged.
3. Exercise both normal two-address email change and recovery-code change. Confirm the old and new addresses receive the appropriate branded messages.
4. Upload a test PDF/JPEG/PNG from Document Center with the application left as `None`. Confirm a private Storage object and Firestore document record are created without an application/checklist, then verify the upload notification (if enabled) and separate access-PIN email. Confirm no file contents or Storage link are in the email.
5. For production-link validation use `APP_ENV=production` and `PUBLIC_APP_URL=https://bharatsathi-ai-1aed0.web.app`. A localhost public URL must fail validation; never use production users to test mail links.
