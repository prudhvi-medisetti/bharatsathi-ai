from __future__ import annotations

import json
import os
import re
import asyncio
import hashlib
import hmac
import html
import logging
import secrets
import smtplib
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

APP_NAME = "BharatSathi AI API"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
logger = logging.getLogger(__name__)
_verification_email_last_sent: dict[str, float] = {}

origins = [
    item.strip()
    for item in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174",
    ).split(",")
    if item.strip()
]
app = FastAPI(title=APP_NAME, version="1.0.0", description="Secure AI gateway for BharatSathi AI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_firebase_initialized = False


def _maybe_init_firebase() -> None:
    global _firebase_initialized
    if _firebase_initialized:
        return
    service_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    service_file = os.getenv("FIREBASE_SERVICE_ACCOUNT_FILE", "").strip()
    if not service_json and not service_file:
        return
    project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    if not project_id:
        raise RuntimeError("FIREBASE_PROJECT_ID is required for Firebase Admin.")
    try:
        import firebase_admin
        from firebase_admin import credentials
        if service_json:
            service_account = json.loads(service_json)
            cred = credentials.Certificate(service_account)
        else:
            certificate_path = Path(service_file).expanduser()
            if not certificate_path.is_absolute():
                certificate_path = Path(__file__).resolve().parent / certificate_path
            if not certificate_path.is_file():
                raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_FILE does not exist.")
            service_account = json.loads(certificate_path.read_text(encoding="utf-8"))
            cred = credentials.Certificate(str(certificate_path))
        account_project = str(service_account.get("project_id") or "").strip()
        if account_project and account_project != project_id:
            raise RuntimeError("FIREBASE_PROJECT_ID does not match the Firebase service account.")
        if not firebase_admin._apps:
            options = {"projectId": project_id}
            bucket = os.getenv("FIREBASE_STORAGE_BUCKET", "").strip()
            if bucket:
                options["storageBucket"] = bucket
            firebase_admin.initialize_app(cred, options)
        elif firebase_admin.get_app().project_id != project_id:
            raise RuntimeError("The initialized Firebase Admin app uses a different project.")
        _firebase_initialized = True
    except Exception as exc:
        if isinstance(exc, RuntimeError):
            raise
        raise RuntimeError(f"Firebase Admin initialization failed: {exc}") from exc


def _firebase_config_missing() -> list[str]:
    missing: list[str] = []
    if not (
        os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
        or os.getenv("FIREBASE_SERVICE_ACCOUNT_FILE", "").strip()
    ):
        missing.append("FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_FILE")
    if not os.getenv("FIREBASE_PROJECT_ID", "").strip():
        missing.append("FIREBASE_PROJECT_ID")
    return missing


def _smtp_config_missing() -> list[str]:
    missing = [
        name for name in ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM")
        if not os.getenv(name, "").strip()
    ]
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
        if not 1 <= port <= 65535:
            missing.append("SMTP_PORT (must be between 1 and 65535)")
    except ValueError:
        missing.append("SMTP_PORT (must be a number)")
    return missing


def verify_optional_firebase_token(authorization: str | None) -> dict[str, Any] | None:
    # Local/demo mode remains usable without a service account. In production,
    # configure Firebase Admin and require an ID token at the hosting layer.
    if not authorization:
        return None
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    if not (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip() or os.getenv("FIREBASE_SERVICE_ACCOUNT_FILE", "").strip()):
        return {"uid": "demo"}
    try:
        _maybe_init_firebase()
        from firebase_admin import auth
        return auth.verify_id_token(authorization.split(" ", 1)[1].strip())
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Firebase token verification failed: {exc}") from exc


def _has_custom_email_configuration() -> bool:
    return not _firebase_config_missing() and not _smtp_config_missing()


def require_firebase_token(authorization: str | None) -> dict[str, Any]:
    missing = _firebase_config_missing()
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"Firebase Admin configuration is incomplete. Set: {', '.join(missing)}.",
        )
    if not authorization:
        raise HTTPException(status_code=401, detail="A Firebase ID token is required.")
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization header.")
    try:
        _maybe_init_firebase()
        from firebase_admin import auth
        claims = auth.verify_id_token(authorization.split(" ", 1)[1].strip())
    except RuntimeError as exc:
        logger.error("Firebase Admin initialization failed for a protected endpoint")
        raise HTTPException(status_code=503, detail="Firebase Admin authentication is unavailable.") from exc
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Firebase ID token verification failed.") from exc
    if not claims.get("uid"):
        raise HTTPException(status_code=401, detail="Firebase ID token has no user identity.")
    return claims


def _firestore_client():
    try:
        _maybe_init_firebase()
        from firebase_admin import firestore
        return firestore.client()
    except Exception as exc:
        logger.exception("Firestore Admin client is unavailable")
        raise HTTPException(status_code=503, detail="Firebase Firestore is unavailable.") from exc


def _purge_account_data(db, bucket, uid: str) -> None:
    for blob in bucket.list_blobs(prefix=f"users/{uid}/"):
        blob.delete()

    references: dict[str, Any] = {}
    document_ids: set[str] = set()
    collection_names = ("savedSchemes", "applications", "documents", "activities", "notifications")
    for collection_name in collection_names:
        records = db.collection(collection_name).where("userId", "==", uid).stream()
        for record in records:
            references[record.reference.path] = record.reference
            if collection_name == "documents":
                data = record.to_dict() or {}
                for document_id in (record.id, data.get("documentId")):
                    if isinstance(document_id, str) and document_id:
                        document_ids.add(document_id)
            elif collection_name == "notifications":
                private_ref = db.collection("_private_notification_sends").document(record.id)
                references[private_ref.path] = private_ref

    private_collections = (
        "_private_document_access_pins",
        "_private_notification_sends",
        "_private_official_document_verifications",
    )
    for collection_name in private_collections:
        private_collection = db.collection(collection_name)
        for field in ("ownerUid", "uid", "userId"):
            for record in private_collection.where(field, "==", uid).stream():
                references[record.reference.path] = record.reference

    for document_id in document_ids:
        for reference in (
            _document_access_pin_ref(db, uid, document_id),
            db.collection("_private_official_document_verifications").document(document_id),
        ):
            references[reference.path] = reference

    for reference in (_email_change_ref(db, uid), _recovery_code_ref(db, uid)):
        references[reference.path] = reference

    all_references = list(references.values())
    for offset in range(0, len(all_references), 450):
        batch = db.batch()
        for reference in all_references[offset:offset + 450]:
            batch.delete(reference)
        batch.commit()

    db.recursive_delete(db.collection("users").document(uid))


def _load_firebase_account(uid: str):
    try:
        from firebase_admin import auth
        account = auth.get_user(uid)
    except Exception as exc:
        logger.exception("Could not load the authenticated Firebase account")
        raise HTTPException(status_code=502, detail="The authenticated account could not be loaded.") from exc
    if not account.email:
        raise HTTPException(status_code=400, detail="The Firebase account does not have an email address.")
    return account


def _load_owned_document(db, document_id: str, uid: str) -> tuple[Any, dict[str, Any], str, str]:
    if not document_id or "/" in document_id:
        raise HTTPException(status_code=404, detail="Document not found.")
    collection = db.collection("documents")
    try:
        snapshot = collection.document(document_id).get()
        if snapshot.exists:
            reference = snapshot.reference
        else:
            matches = list(collection.where("documentId", "==", document_id).limit(1).stream())
            if not matches:
                raise HTTPException(status_code=404, detail="Document not found.")
            snapshot = matches[0]
            reference = snapshot.reference
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Could not load a Firestore document record")
        raise HTTPException(status_code=502, detail="The document record could not be loaded.") from exc
    data = snapshot.to_dict() or {}
    if data.get("userId") != uid:
        raise HTTPException(status_code=403, detail="This document does not belong to the authenticated account.")
    stored_document_id = data.get("documentId")
    if not isinstance(stored_document_id, str) or not stored_document_id:
        stored_document_id = document_id if reference.id == document_id else ""
    application_id = data.get("applicationId")
    scheme_id = data.get("schemeId")
    scheme_name = data.get("schemeName")
    file_name = data.get("fileName")
    if (
        not stored_document_id or "/" in stored_document_id
        or not isinstance(file_name, str) or file_name in ("", ".", "..") or "/" in file_name or "\\" in file_name
    ):
        raise HTTPException(status_code=409, detail="The document metadata is incomplete or invalid.")
    if data.get("storagePath") != f"users/{uid}/documents/{stored_document_id}/{file_name}":
        if (
            not isinstance(application_id, str) or not application_id or "/" in application_id
            or not isinstance(scheme_id, str) or not scheme_id.strip()
            or data.get("storagePath") != f"users/{uid}/applications/{application_id}/documents/{stored_document_id}/{file_name}"
        ):
            raise HTTPException(status_code=409, detail="The document storage path is invalid.")
    if application_id is not None or scheme_id is not None or scheme_name is not None:
        if (
            not isinstance(application_id, str) or not application_id or "/" in application_id
            or not isinstance(scheme_id, str) or not scheme_id.strip()
            or (scheme_name is not None and not isinstance(scheme_name, str))
        ):
            raise HTTPException(status_code=409, detail="The optional application association is incomplete or invalid.")
        try:
            application_snapshot = db.collection("applications").document(application_id).get()
        except Exception as exc:
            logger.exception("Could not verify document application ownership")
            raise HTTPException(status_code=502, detail="The document application could not be checked.") from exc
        if not application_snapshot.exists:
            raise HTTPException(status_code=404, detail="The linked application was not found.")
        application = application_snapshot.to_dict() or {}
        if application.get("userId") != uid:
            raise HTTPException(status_code=403, detail="The linked application does not belong to the authenticated account.")
        if application.get("schemeId") != scheme_id:
            raise HTTPException(status_code=409, detail="The document scheme does not match its linked application.")
    stored_bucket = data.get("storageBucket")
    configured_bucket = os.getenv("FIREBASE_STORAGE_BUCKET", "").strip()
    if stored_bucket and configured_bucket and stored_bucket != configured_bucket:
        raise HTTPException(status_code=409, detail="The document Storage bucket does not match the configured bucket.")
    return reference, data, stored_document_id, data["storagePath"]


def _smtp_is_configured() -> bool:
    return not _smtp_config_missing()


def _require_smtp_configuration() -> None:
    missing = _smtp_config_missing()
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"SMTP email delivery is not configured. Set: {', '.join(missing)}.",
        )


def _send_branded_email(
    recipient: str,
    subject: str,
    heading: str,
    body_lines: list[str],
    *,
    cta_label: str | None = None,
    cta_url: str | None = None,
) -> None:
    safe_heading = html.escape(heading)
    safe_lines = "".join(
        f'<p style="margin:0 0 14px;color:#40516a;font-size:15px;line-height:1.7">{html.escape(line)}</p>'
        for line in body_lines
    )
    button = ""
    if cta_label and cta_url:
        button = (
            '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:25px 0 22px">'
            '<tr><td align="center" bgcolor="#153b72" style="border-radius:11px">'
            '<a href="'
            + html.escape(cta_url, quote=True)
            + '" target="_blank" style="display:inline-block;padding:15px 25px;border:1px solid #153b72;'
            'border-radius:11px;color:#ffffff;background:#153b72;font-family:Arial,Helvetica,sans-serif;'
            'font-size:14px;font-weight:bold;letter-spacing:.45px;text-decoration:none">'
            + html.escape(cta_label)
            + "</a></td></tr></table>"
        )
    html_content = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"><title>'
        + safe_heading
        + '</title></head><body style="margin:0;padding:0;background:#f3f6fa;'
        'font-family:Arial,Helvetica,sans-serif;color:#1b2b45">'
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0">'
        + safe_heading
        + ' — BharatSathi AI</div>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        'style="background:#f3f6fa"><tr><td align="center" style="padding:28px 12px">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        'style="width:100%;max-width:600px;border:1px solid #e3eaf2;border-radius:18px;'
        'background:#ffffff;overflow:hidden">'
        '<tr><td style="padding:22px 26px;border-bottom:1px solid #edf1f6">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>'
        '<td width="50" valign="middle"><table role="presentation" width="42" height="42" '
        'cellspacing="0" cellpadding="0" border="0" style="border:1px solid #dfe8f2;'
        'border-radius:13px;background:#f5f9ff"><tr><td align="center" valign="middle" '
        'style="color:#153b72;font-size:19px;font-weight:bold">B<span style="color:#ef8c31">.</span>'
        '</td></tr></table></td><td valign="middle">'
        '<div style="font-size:19px;font-weight:bold;letter-spacing:-.3px;color:#153b72">'
        'BharatSathi <span style="color:#19764f">AI</span></div>'
        '<div style="padding-top:4px;color:#60718a;font-size:11px;line-height:16px">'
        'Your Personal AI Government Benefits Assistant</div></td>'
        '<td align="right" valign="top" style="color:#e88832;font-size:16px;letter-spacing:2px">'
        '<span style="color:#e88832">━</span><span style="color:#b9c9de">━</span>'
        '<span style="color:#37865e">━</span></td></tr></table></td></tr>'
        '<tr><td style="padding:30px 28px 12px"><div style="margin-bottom:10px;color:#388260;'
        'font-size:10px;font-weight:bold;letter-spacing:1.4px">BHARATSATHI AI</div>'
        '<h1 style="margin:0 0 20px;color:#153b72;font-size:25px;line-height:1.25;'
        'letter-spacing:-.4px">'
        + safe_heading
        + "</h1>"
        + safe_lines
        + button
        + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        'style="margin:20px 0 0;border:1px solid #dceee2;border-radius:11px;background:#f1f8f3">'
        '<tr><td width="36" valign="top" style="padding:12px 0 12px 13px;color:#19764f;font-size:16px">'
        '🔐</td><td style="padding:12px 13px 12px 5px;color:#345a47;font-size:12px;line-height:19px">'
        'For your security, never share your password, one-time codes, or private account links.'
        '</td></tr></table>'
        '<p style="margin:22px 0 0;color:#718198;font-size:12px;line-height:18px">'
        'BharatSathi AI provides guidance to help you understand government benefits. '
        'Applications and decisions are handled by official government portals.</p>'
        '</td></tr><tr><td align="center" style="padding:17px 20px 21px;border-top:1px solid #edf1f6">'
        '<div style="color:#153b72;font-size:12px;font-weight:bold">BharatSathi AI</div>'
        '<div style="padding-top:4px;color:#60718a;font-size:10px;line-height:16px">'
        'Your Personal AI Government Benefits Assistant</div>'
        '<div style="padding-top:7px;color:#91a0b2;font-size:10px">'
        'Helping citizens discover, understand and access government benefits more easily.</div>'
        '<div style="padding-top:8px;color:#91a0b2;font-size:10px">'
        '© 2026 BharatSathi AI. All rights reserved.</div>'
        '</td></tr></table></td></tr></table></body></html>'
    )
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = os.environ["SMTP_FROM"]
    message["To"] = recipient
    text_lines = [heading, *body_lines]
    if cta_label and cta_url:
        text_lines.extend((f"{cta_label}: {cta_url}",))
    text_lines.extend((
        "For your security, never share your password, one-time codes, or private account links.",
        "BharatSathi AI — Your Personal AI Government Benefits Assistant",
    ))
    message.set_content("\n\n".join(text_lines))
    message.add_alternative(html_content, subtype="html")

    host = os.environ["SMTP_HOST"]
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.environ["SMTP_USERNAME"]
    password = os.environ["SMTP_PASSWORD"]
    if os.getenv("SMTP_USE_SSL", "").strip().lower() == "true":
        with smtplib.SMTP_SSL(host, port, timeout=20) as client:
            client.login(username, password)
            client.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=20) as client:
            client.ehlo()
            client.starttls()
            client.ehlo()
            client.login(username, password)
            client.send_message(message)


def _public_app_base_url() -> str:
    environment = os.getenv(
        "APP_ENV",
        os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "development")),
    ).strip().lower()
    is_production = environment in {"prod", "production"} or any(
        os.getenv(key, "").strip()
        for key in ("K_SERVICE", "RENDER", "RAILWAY_ENVIRONMENT", "FLY_APP_NAME")
    )
    configured_url = os.getenv("PUBLIC_APP_URL", "").strip()
    if not configured_url and is_production:
        configured_url = "https://bharatsathi-ai-1aed0.web.app"
    if not configured_url:
        configured_url = "http://localhost:5173"

    parsed = urlsplit(configured_url)
    if parsed.scheme not in ({"https"} if is_production else {"http", "https"}) or not parsed.netloc:
        raise ValueError("PUBLIC_APP_URL must be an absolute HTTPS URL in production.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("PUBLIC_APP_URL must not include credentials, a query, or a fragment.")
    if is_production and parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Production verification links cannot use localhost.")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def _verification_app_link(firebase_action_link: str, app_base_url: str) -> str:
    action_link = firebase_action_link
    for _ in range(3):
        query = parse_qs(urlsplit(action_link).query)
        code = query.get("oobCode", [None])[0]
        if code:
            return f"{app_base_url}/verify?{urlencode({'mode': 'verifyEmail', 'oobCode': code})}"
        action_link = query.get("link", [None])[0] or ""
        if not action_link:
            break
    raise ValueError("Firebase did not return a usable email verification action code.")


def _document_access_pin_ref(db, uid: str, document_id: str):
    key = hashlib.sha256(f"{uid}:{document_id}".encode("utf-8")).hexdigest()
    return db.collection("_private_document_access_pins").document(key)


def _document_pin_policy() -> tuple[int, int]:
    try:
        ttl = int(os.getenv("DOCUMENT_PIN_TTL_SECONDS", "600"))
        attempts = int(os.getenv("DOCUMENT_PIN_MAX_ATTEMPTS", "5"))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Document PIN policy is not configured correctly.") from exc
    if not 60 <= ttl <= 3600 or not 1 <= attempts <= 10:
        raise HTTPException(status_code=503, detail="Document PIN policy is outside the supported limits.")
    return ttl, attempts


def _utc_datetime(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _consume_document_pin(pin_ref, supplied_pin: str) -> str:
    from firebase_admin import firestore

    transaction = _firestore_client().transaction()
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def consume(tx):
        snapshot = pin_ref.get(transaction=tx)
        if not snapshot.exists:
            return "missing"
        data = snapshot.to_dict() or {}
        expires_at = _utc_datetime(data.get("expiresAt"))
        if not expires_at or expires_at <= now:
            tx.delete(pin_ref)
            return "expired"
        max_attempts = int(data.get("maxAttempts", 0))
        attempts = int(data.get("attempts", 0))
        if data.get("locked") is True or attempts >= max_attempts:
            return "locked"
        try:
            salt = bytes.fromhex(data["salt"])
            expected_hash = bytes.fromhex(data["pinHash"])
            iterations = int(data["iterations"])
        except (KeyError, TypeError, ValueError):
            tx.delete(pin_ref)
            return "missing"
        actual_hash = hashlib.pbkdf2_hmac("sha256", supplied_pin.encode("ascii"), salt, iterations)
        if not hmac.compare_digest(actual_hash, expected_hash):
            attempts += 1
            tx.update(pin_ref, {"attempts": attempts, "locked": attempts >= max_attempts})
            return "locked" if attempts >= max_attempts else "bad"
        tx.delete(pin_ref)
        return "ok"

    return consume(transaction)


def _claim_notification(db, dedupe_id: str, uid: str) -> str:
    from firebase_admin import firestore

    reference = db.collection("_private_notification_sends").document(dedupe_id)
    transaction = db.transaction()
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def claim(tx):
        snapshot = reference.get(transaction=tx)
        if snapshot.exists:
            data = snapshot.to_dict() or {}
            state = data.get("state")
            if state == "sent":
                return "duplicate"
            if state == "email_sent":
                return "email_sent"
            started_at = _utc_datetime(data.get("startedAt"))
            if started_at and now - started_at < timedelta(minutes=15):
                return "duplicate"
        tx.set(reference, {"ownerUid": uid, "state": "sending", "startedAt": now}, merge=True)
        return "send"

    return claim(transaction)


def _application_status(data: dict[str, Any]) -> str:
    statuses = {
        "applied": "Applied",
        "documents pending": "Documents Pending",
        "under review": "Under Review",
        "approved": "Approved",
        "rejected": "Rejected",
        "completed": "Completed",
    }
    return statuses.get(str(data.get("status") or "").strip().lower(), "")


def _timestamp_key(value: Any) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return "unknown" if value is None else str(value)


def _remaining_ttl(record: dict[str, Any], fallback: int) -> int:
    expires_at = _utc_datetime(record.get("expiresAt"))
    if not expires_at:
        return fallback
    return max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds()))


def _email_change_policy() -> tuple[int, int, int, int, int]:
    try:
        ttl = int(os.getenv("EMAIL_CHANGE_TOKEN_TTL_SECONDS", "1800"))
        resend_interval = int(os.getenv("EMAIL_CHANGE_RESEND_INTERVAL_SECONDS", "60"))
        max_resends = int(os.getenv("EMAIL_CHANGE_MAX_RESENDS", "5"))
        max_attempts = int(os.getenv("EMAIL_CHANGE_MAX_CONFIRM_ATTEMPTS", "5"))
        recent_auth = int(os.getenv("EMAIL_CHANGE_RECENT_AUTH_SECONDS", "300"))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Email-change security policy is not configured correctly.") from exc
    if not 300 <= ttl <= 3600 or not 30 <= resend_interval <= 600 or not 1 <= max_resends <= 10 or not 1 <= max_attempts <= 10 or not 60 <= recent_auth <= 900:
        raise HTTPException(status_code=503, detail="Email-change security policy is outside the supported limits.")
    return ttl, resend_interval, max_resends, max_attempts, recent_auth


def _email_change_ref(db, uid: str):
    key = hashlib.sha256(uid.encode("utf-8")).hexdigest()
    return db.collection("_private_email_change_requests").document(key)


def _new_email_change_token(request_id: str) -> tuple[str, str, str]:
    token = f"{request_id}.{secrets.token_urlsafe(32)}"
    salt = secrets.token_bytes(16)
    token_hash = hashlib.sha256(salt + token.encode("ascii")).hexdigest()
    return token, salt.hex(), token_hash


def _email_change_ref_for_token(db, token: str):
    request_id, separator, secret = token.partition(".")
    if not separator or not re.fullmatch(r"[a-f0-9]{64}", request_id) or len(secret) < 32:
        raise HTTPException(status_code=400, detail="The email-change token is invalid.")
    return db.collection("_private_email_change_requests").document(request_id)


def _email_token_matches(token: str, salt_hex: str, expected_hash: str) -> bool:
    if not isinstance(salt_hex, str) or not isinstance(expected_hash, str):
        return False
    try:
        salt = bytes.fromhex(salt_hex)
    except (TypeError, ValueError):
        return False
    actual = hashlib.sha256(salt + token.encode("utf-8")).hexdigest()
    return hmac.compare_digest(actual, expected_hash)


def _email_change_link(stage: str, token: str) -> str:
    base_url = _application_url("/email-change")
    parsed = urlsplit(base_url)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode({"stage": stage}), urlencode({"token": token})))


def _application_url(path: str) -> str:
    try:
        base_url = _public_app_base_url()
    except ValueError as exc:
        logger.exception("Public application URL is misconfigured")
        raise HTTPException(status_code=503, detail="PUBLIC_APP_URL is not configured correctly for this environment.") from exc
    return f"{base_url}/{path.lstrip('/')}"


def _require_storage_configuration() -> str:
    bucket = os.getenv("FIREBASE_STORAGE_BUCKET", "").strip()
    if not bucket:
        raise HTTPException(
            status_code=503,
            detail="Firebase Storage is not configured. Set FIREBASE_STORAGE_BUCKET.",
        )
    return bucket


def _require_recent_auth(
    claims: dict[str, Any],
    max_age_seconds: int,
    action: str = "changing your account email",
) -> None:
    try:
        auth_time = int(claims.get("auth_time", 0))
    except (TypeError, ValueError):
        auth_time = 0
    if auth_time <= 0 or auth_time > time.time() + 30 or time.time() - auth_time > max_age_seconds:
        raise HTTPException(status_code=401, detail=f"Sign in again before {action}.")


def _valid_email_address(value: str) -> str:
    email = value.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="Enter a valid new email address.")
    return email


def _start_email_change(
    db,
    uid: str,
    old_email: str,
    new_email: str,
    old_email_verified: bool,
    ttl: int,
    resend_interval: int,
    old_salt: str,
    old_hash: str,
) -> str:
    from firebase_admin import firestore

    reference = _email_change_ref(db, uid)
    transaction = db.transaction()
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def start(tx):
        snapshot = reference.get(transaction=tx)
        previous = snapshot.to_dict() or {} if snapshot.exists else {}
        previous_state = previous.get("state")
        previous_expiry = _utc_datetime(previous.get("expiresAt"))
        if previous_state in ("pending_old", "pending_new", "updating", "recovery_required") and (
            previous_state in ("updating", "recovery_required") or (previous_expiry and previous_expiry > now)
        ):
            return "active"
        last_start = _utc_datetime(previous.get("lastInitiatedAt"))
        if last_start and now - last_start < timedelta(seconds=resend_interval):
            return "rate_limited"
        window_start = _utc_datetime(previous.get("initiationWindowStart"))
        initiation_count = int(previous.get("initiationCount", 0))
        if not window_start or now - window_start >= timedelta(hours=1):
            window_start = now
            initiation_count = 0
        if initiation_count >= 5:
            return "rate_limited"
        tx.set(reference, {
            "uid": uid,
            "oldEmail": old_email,
            "newEmail": new_email,
            "oldEmailVerified": old_email_verified,
            "changeType": "standard",
            "state": "pending_old",
            "oldTokenSalt": old_salt,
            "oldTokenHash": old_hash,
            "newTokenSalt": None,
            "newTokenHash": None,
            "oldConfirmAttempts": 0,
            "newConfirmAttempts": 0,
            "oldResends": 0,
            "newResends": 0,
            "lastOldSentAt": now,
            "lastNewSentAt": None,
            "createdAt": now,
            "updatedAt": now,
            "expiresAt": now + timedelta(seconds=ttl),
            "lastInitiatedAt": now,
            "initiationWindowStart": window_start,
            "initiationCount": initiation_count + 1,
        })
        return "started"

    return start(transaction)


def _prepare_email_change_resend(
    db,
    reference,
    stage: str,
    token_salt: str,
    token_hash: str,
    resend_interval: int,
    max_resends: int,
) -> tuple[str, dict[str, Any] | None]:
    from firebase_admin import firestore

    transaction = db.transaction()
    now = datetime.now(timezone.utc)
    expected_state = "pending_old" if stage == "old" else "pending_new"
    sent_field = "lastOldSentAt" if stage == "old" else "lastNewSentAt"
    count_field = "oldResends" if stage == "old" else "newResends"
    hash_field = "oldTokenHash" if stage == "old" else "newTokenHash"
    salt_field = "oldTokenSalt" if stage == "old" else "newTokenSalt"

    @firestore.transactional
    def prepare(tx):
        snapshot = reference.get(transaction=tx)
        if not snapshot.exists:
            return "missing", None
        data = snapshot.to_dict() or {}
        if data.get("state") != expected_state:
            return "invalid_state", None
        expires_at = _utc_datetime(data.get("expiresAt"))
        if not expires_at or expires_at <= now:
            tx.update(reference, {"state": "expired", "oldTokenHash": None, "newTokenHash": None})
            return "expired", None
        last_sent = _utc_datetime(data.get(sent_field))
        if last_sent and now - last_sent < timedelta(seconds=resend_interval):
            return "rate_limited", None
        count = int(data.get(count_field, 0))
        if count >= max_resends:
            return "limit_reached", None
        updates = {
            hash_field: token_hash,
            salt_field: token_salt,
            sent_field: now,
            count_field: count + 1,
            "updatedAt": now,
        }
        attempts_field = "oldConfirmAttempts" if stage == "old" else "newConfirmAttempts"
        updates[attempts_field] = 0
        tx.update(reference, updates)
        data.update(updates)
        return "ready", data

    return prepare(transaction)


def _confirm_old_email_token(db, reference, token: str, new_salt: str, new_hash: str, max_attempts: int) -> tuple[str, dict[str, Any] | None]:
    from firebase_admin import firestore

    transaction = db.transaction()
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def confirm(tx):
        snapshot = reference.get(transaction=tx)
        if not snapshot.exists:
            return "missing", None
        data = snapshot.to_dict() or {}
        if data.get("state") != "pending_old":
            return ("expired" if data.get("state") == "expired" else "invalid_state"), None
        expires_at = _utc_datetime(data.get("expiresAt"))
        if not expires_at or expires_at <= now:
            tx.update(reference, {"state": "expired", "oldTokenHash": None, "newTokenHash": None})
            return "expired", None
        attempts = int(data.get("oldConfirmAttempts", 0))
        if attempts >= max_attempts:
            return "locked", None
        if not _email_token_matches(token, data.get("oldTokenSalt", ""), data.get("oldTokenHash", "")):
            attempts += 1
            tx.update(reference, {
                "oldConfirmAttempts": attempts,
                "updatedAt": now,
            })
            return ("locked" if attempts >= max_attempts else "bad"), None
        tx.update(reference, {
            "state": "pending_new",
            "oldTokenSalt": None,
            "oldTokenHash": None,
            "oldConfirmedAt": now,
            "newTokenSalt": new_salt,
            "newTokenHash": new_hash,
            "newConfirmAttempts": 0,
            "newResends": 0,
            "lastNewSentAt": now,
            "updatedAt": now,
        })
        return "confirmed", data

    return confirm(transaction)


def _claim_new_email_confirmation(db, reference, token: str, max_attempts: int) -> tuple[str, dict[str, Any] | None]:
    from firebase_admin import firestore

    transaction = db.transaction()
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def confirm(tx):
        snapshot = reference.get(transaction=tx)
        if not snapshot.exists:
            return "missing", None
        data = snapshot.to_dict() or {}
        if data.get("state") != "pending_new":
            return ("expired" if data.get("state") == "expired" else "invalid_state"), None
        expires_at = _utc_datetime(data.get("expiresAt"))
        if not expires_at or expires_at <= now:
            tx.update(reference, {"state": "expired", "oldTokenHash": None, "newTokenHash": None})
            return "expired", None
        attempts = int(data.get("newConfirmAttempts", 0))
        if attempts >= max_attempts:
            return "locked", None
        if not _email_token_matches(token, data.get("newTokenSalt", ""), data.get("newTokenHash", "")):
            attempts += 1
            tx.update(reference, {
                "newConfirmAttempts": attempts,
                "updatedAt": now,
            })
            return ("locked" if attempts >= max_attempts else "bad"), None
        tx.update(reference, {"state": "updating", "updatedAt": now})
        return "confirmed", data

    return confirm(transaction)


def _recovery_code_policy() -> tuple[int, int, int, int, str]:
    try:
        ttl = int(os.getenv("RECOVERY_CODE_TTL_SECONDS", "31536000"))
        max_attempts = int(os.getenv("RECOVERY_CODE_MAX_ATTEMPTS", "5"))
        attempt_interval = int(os.getenv("RECOVERY_CODE_ATTEMPT_INTERVAL_SECONDS", "5"))
        iterations = int(os.getenv("RECOVERY_CODE_HASH_ITERATIONS", "310000"))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Recovery-code security policy contains an invalid number.") from exc
    pepper = os.getenv("RECOVERY_CODE_PEPPER", "").strip()
    if not pepper or len(pepper) < 32:
        raise HTTPException(
            status_code=503,
            detail="Recovery-code service is not configured. Set RECOVERY_CODE_PEPPER to a random secret of at least 32 characters.",
        )
    if not 3600 <= ttl <= 31536000 or not 1 <= max_attempts <= 10 or not 1 <= attempt_interval <= 60 or not 100000 <= iterations <= 1000000:
        raise HTTPException(status_code=503, detail="Recovery-code security policy is outside the supported limits.")
    return ttl, max_attempts, attempt_interval, iterations, pepper


def _recovery_code_ref(db, uid: str):
    key = hashlib.sha256(f"account-recovery:{uid}".encode("utf-8")).hexdigest()
    return db.collection("_private_account_recovery_codes").document(key)


def _recovery_code_hash(uid: str, code: str, salt_hex: str, pepper: str, iterations: int) -> str:
    salt = bytes.fromhex(salt_hex)
    peppered_code = hmac.new(
        pepper.encode("utf-8"),
        f"{uid}:{code}".encode("ascii"),
        hashlib.sha256,
    ).digest()
    return hashlib.pbkdf2_hmac("sha256", peppered_code, salt, iterations).hex()


def _store_recovery_code(
    db,
    uid: str,
    code: str,
    ttl: int,
    iterations: int,
    pepper: str,
) -> tuple[str, int]:
    from firebase_admin import firestore

    reference = _recovery_code_ref(db, uid)
    salt = secrets.token_bytes(16).hex()
    code_hash = _recovery_code_hash(uid, code, salt, pepper, iterations)
    transaction = db.transaction()
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def store(tx):
        snapshot = reference.get(transaction=tx)
        data = snapshot.to_dict() or {} if snapshot.exists else {}
        state = data.get("state")
        expires_at = _utc_datetime(data.get("expiresAt"))
        if state == "reserved":
            return "reserved", 0
        if state == "locked":
            locked_until = _utc_datetime(data.get("lockedUntil"))
            if locked_until and locked_until > now:
                return "locked", int((locked_until - now).total_seconds())
        if state == "active" and expires_at and expires_at > now:
            try:
                expected_hash = _recovery_code_hash(
                    uid,
                    code,
                    str(data["salt"]),
                    pepper,
                    int(data["iterations"]),
                )
            except (KeyError, TypeError, ValueError):
                return "unavailable", 0
            if hmac.compare_digest(expected_hash, str(data.get("codeHash") or "")):
                return "already_issued", max(0, int((expires_at - now).total_seconds()))
            return "already_exists", max(0, int((expires_at - now).total_seconds()))

        tx.set(reference, {
            "uid": uid,
            "salt": salt,
            "codeHash": code_hash,
            "iterations": iterations,
            "state": "active",
            "attempts": 0,
            "lastAttemptAt": None,
            "lockedUntil": None,
            "createdAt": now,
            "expiresAt": now + timedelta(seconds=ttl),
            "reservedBy": None,
            "usedAt": None,
        })
        return "created", ttl

    return store(transaction)


def _start_email_change_recovery(
    db,
    uid: str,
    old_email: str,
    new_email: str,
    recovery_code: str,
    ttl: int,
    resend_interval: int,
    max_resends: int,
    max_attempts: int,
    attempt_interval: int,
    iterations: int,
    pepper: str,
    new_salt: str,
    new_hash: str,
) -> tuple[str, dict[str, Any] | None, int]:
    from firebase_admin import firestore

    recovery_ref = _recovery_code_ref(db, uid)
    change_ref = _email_change_ref(db, uid)
    transaction = db.transaction()
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def start(tx):
        recovery_snapshot = recovery_ref.get(transaction=tx)
        if not recovery_snapshot.exists:
            return "missing_code", None, 0
        recovery = recovery_snapshot.to_dict() or {}
        change_snapshot = change_ref.get(transaction=tx)
        previous = change_snapshot.to_dict() or {} if change_snapshot.exists else {}
        previous_state = previous.get("state")
        previous_expiry = _utc_datetime(previous.get("expiresAt"))
        if previous_state in ("pending_old", "pending_new", "updating", "recovery_required") and (
            previous_state in ("updating", "recovery_required")
            or (previous_expiry and previous_expiry > now)
        ):
            return "active_change", None, 0

        code_expiry = _utc_datetime(recovery.get("expiresAt"))
        if not code_expiry or code_expiry <= now:
            tx.update(recovery_ref, {
                "state": "expired",
                "salt": None,
                "codeHash": None,
                "reservedBy": None,
                "updatedAt": now,
            })
            return "expired_code", None, 0
        if recovery.get("state") == "used":
            return "used_code", None, 0
        if recovery.get("state") not in ("active", "reserved"):
            return "unavailable_code", None, 0
        if recovery.get("state") == "reserved" and recovery.get("reservedBy") != change_ref.id:
            return "unavailable_code", None, 0

        locked_until = _utc_datetime(recovery.get("lockedUntil"))
        if locked_until and locked_until > now:
            return "rate_limited", None, max(1, int((locked_until - now).total_seconds()))
        last_attempt = _utc_datetime(recovery.get("lastAttemptAt"))
        if last_attempt and now - last_attempt < timedelta(seconds=attempt_interval):
            return "rate_limited", None, max(1, int(attempt_interval - (now - last_attempt).total_seconds() + 0.999))

        attempts = 0 if locked_until else int(recovery.get("attempts", 0))
        try:
            candidate_hash = _recovery_code_hash(
                uid,
                recovery_code,
                str(recovery["salt"]),
                pepper,
                int(recovery.get("iterations") or iterations),
            )
        except (KeyError, TypeError, ValueError):
            return "unavailable_code", None, 0
        if not hmac.compare_digest(candidate_hash, str(recovery.get("codeHash") or "")):
            attempts += 1
            updates: dict[str, Any] = {"attempts": attempts, "lastAttemptAt": now, "updatedAt": now}
            result = "bad_code"
            if attempts >= max_attempts:
                updates.update({"attempts": 0, "lockedUntil": now + timedelta(minutes=15)})
                result = "rate_limited"
            tx.update(recovery_ref, updates)
            return result, None, 900 if result == "rate_limited" else 0

        last_initiated = _utc_datetime(previous.get("lastInitiatedAt"))
        if last_initiated and now - last_initiated < timedelta(seconds=resend_interval):
            return "rate_limited", None, max(1, int(resend_interval - (now - last_initiated).total_seconds() + 0.999))
        window_start = _utc_datetime(previous.get("initiationWindowStart"))
        initiation_count = int(previous.get("initiationCount", 0))
        if not window_start or now - window_start >= timedelta(hours=1):
            window_start = now
            initiation_count = 0
        if initiation_count >= max_resends:
            return "rate_limited", None, 3600

        record = {
            "uid": uid,
            "oldEmail": old_email,
            "newEmail": new_email,
            "oldEmailVerified": True,
            "changeType": "recovery",
            "state": "pending_new",
            "oldTokenSalt": None,
            "oldTokenHash": None,
            "newTokenSalt": new_salt,
            "newTokenHash": new_hash,
            "oldConfirmAttempts": 0,
            "newConfirmAttempts": 0,
            "oldResends": 0,
            "newResends": 0,
            "lastOldSentAt": None,
            "lastNewSentAt": now,
            "createdAt": now,
            "updatedAt": now,
            "expiresAt": now + timedelta(seconds=ttl),
            "lastInitiatedAt": now,
            "initiationWindowStart": window_start,
            "initiationCount": initiation_count + 1,
            "recoveryCodeRefId": recovery_ref.id,
        }
        tx.set(change_ref, record)
        tx.update(recovery_ref, {
            "state": "reserved",
            "reservedBy": change_ref.id,
            "reservedAt": now,
            "lastAttemptAt": now,
            "lockedUntil": None,
            "updatedAt": now,
        })
        return "started", record, 0

    return start(transaction)


class EmailChangeInitiateRequest(BaseModel):
    new_email: str = Field(min_length=3, max_length=254)


class EmailRecoveryInitiateRequest(BaseModel):
    new_email: str = Field(min_length=3, max_length=254)
    recovery_code: str = Field(min_length=43, max_length=43)


class RecoveryCodeRequest(BaseModel):
    recovery_code: str = Field(min_length=43, max_length=43)


class EmailChangeResendRequest(BaseModel):
    stage: str = Field(min_length=1, max_length=8)


class EmailChangeTokenRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    language: str = Field(default="en", max_length=20)
    profile: dict[str, Any] = Field(default_factory=dict)
    schemes: list[dict[str, Any]] = Field(default_factory=list, max_length=30)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=10)


class ChatResponse(BaseModel):
    answer: str
    language: str
    scheme_ids: list[str] = Field(default_factory=list)
    mode: str
    disclaimer: str


class DocumentPinRequest(BaseModel):
    pin: str = Field(min_length=1, max_length=32)


def _clean_scheme(scheme: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "id", "name", "category", "state", "benefit", "eligibility",
        "eligibilityRules", "documents", "applicationSteps",
        "officialUrl", "officialApplicationUrl", "sourceUrl", "verified", "tags",
        "profileMatch", "matchReasons",
    ]
    return {key: scheme.get(key) for key in keys if scheme.get(key) is not None}


def _local_fallback(
    message: str,
    language: str,
    schemes: list[dict[str, Any]],
    profile: dict[str, Any] | None = None,
) -> ChatResponse:
    profile = profile or {}
    profile_context = " ".join(
        str(profile.get(key, ""))
        for key in ("userType", "occupation", "education", "educationLevel", "employmentStatus", "state")
    )
    text = f"{message} {profile_context}".lower()
    scored: list[tuple[int, dict[str, Any]]] = []
    for scheme in schemes:
        haystack = " ".join([
            str(scheme.get("name", "")), str(scheme.get("category", "")),
            str(scheme.get("benefit", "")), " ".join(map(str, scheme.get("tags", []))),
        ]).lower()
        score = sum(1 for token in re.findall(r"[a-zA-Z0-9]{3,}", text) if token in haystack)
        if re.search(r"\b(for me|available to me|eligible for me|my profile)\b", text):
            if scheme.get("profileMatch") == "Strong Match":
                score += 3
            elif scheme.get("profileMatch") == "Possible Match":
                score += 2
            elif scheme.get("profileMatch") == "Needs Verification":
                score += 1
        if score:
            scored.append((score, scheme))
    scored.sort(key=lambda item: item[0], reverse=True)
    matches = [item[1] for item in scored[:3]]
    if matches:
        names = ", ".join(str(item.get("name")) for item in matches)
        answer = f"I found {len(matches)} potentially relevant scheme option(s): {names}. I can help you compare eligibility and required documents. Verify final criteria on the official scheme source."
    else:
        answer = "Tell me your state, education or occupation, approximate annual income, and whether you need support for education, jobs, farming, health, housing or business. I will narrow down relevant scheme records."
    return ChatResponse(
        answer=answer,
        language=language,
        scheme_ids=[str(item.get("id")) for item in matches if item.get("id")],
        mode="local-grounded-fallback",
        disclaimer="Preliminary guidance only. Government departments and official portals remain the final authority.",
    )


def _prompt(req: ChatRequest) -> str:
    language = req.language
    profile_fields = ("userType", "state", "educationLevel", "employmentStatus", "incomeRange", "ageGroup")
    safe_profile = {key: req.profile[key] for key in profile_fields if key in req.profile}
    profile = json.dumps(safe_profile, ensure_ascii=False)[:2000]
    schemes = json.dumps([_clean_scheme(item) for item in req.schemes], ensure_ascii=False)[:14000]
    history = json.dumps(req.history[-6:], ensure_ascii=False)[:5000]
    return f"""You are BharatSathi AI, a citizen-benefits assistant for India.
Answer the user's question using ONLY the supplied scheme records and profile-match annotations when making scheme-specific claims.
Do not invent scheme names, benefits, eligibility rules, deadlines, documents, or official URLs.
Treat each profileMatch as a preliminary deterministic check; do not infer or claim unprovided personal details.
Use the requested language code {language}. Keep the answer clear and practical for a citizen with limited digital literacy.
If the supplied records are insufficient, say what information is missing instead of guessing.
Never claim official approval or guaranteed eligibility. Call results preliminary guidance.
Never request Aadhaar numbers, OTPs, bank passwords, full bank account numbers, or other secrets.
When the user wants to apply, guide one step at a time and use conversation history to preserve the current step. Ask the user to confirm before moving to the next important step; do not list the whole process unless asked.
Use only the scheme's supplied documents, applicationSteps, and official URLs. Do not invent portal screens, form fields, upload locations, file formats, document alternatives, deadlines, or status.
Explain form fields only from visible text or supplied records. Treat OCR text as a description of a page, not proof that an action occurred. Never claim to have opened a portal, uploaded a file, clicked a button, or submitted an application.
Make clear that the official government portal handles the application and final submission. After submission, ask the user to save the acknowledgement/reference number; do not claim a government status lookup exists.
For voice-style responses, keep answers short and conversational. Preserve official scheme and document names. Answer in Telugu when the requested language is Telugu.
Return valid JSON with exactly these keys: answer, scheme_ids, language.
The scheme_ids array must contain only IDs from the supplied records.

PROFILE:
{profile}

SCHEME RECORDS:
{schemes}

RECENT CONVERSATION:
{history}

USER QUESTION:
{req.message}
"""


async def _gemini(req: ChatRequest) -> ChatResponse:
    if not GEMINI_API_KEY:
        return _local_fallback(req.message, req.language, req.schemes, req.profile)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": _prompt(req)}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
    }
    async with httpx.AsyncClient(timeout=35) as client:
        response = await client.post(url, params={"key": GEMINI_API_KEY}, json=payload)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini request failed: {response.status_code}")
    data = response.json()
    raw = "".join(part.get("text", "") for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []))
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Defensive extraction if the model returns fenced JSON.
        match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        parsed = json.loads(match.group(0)) if match else None
    if not isinstance(parsed, dict):
        return _local_fallback(req.message, req.language, req.schemes, req.profile)
    allowed_ids = {str(item.get("id")) for item in req.schemes if item.get("id")}
    ids = [str(item) for item in parsed.get("scheme_ids", []) if str(item) in allowed_ids]
    answer = str(parsed.get("answer", "")).strip()
    if not answer:
        return _local_fallback(req.message, req.language, req.schemes, req.profile)
    return ChatResponse(
        answer=answer,
        language=str(parsed.get("language") or req.language),
        scheme_ids=ids,
        mode="gemini-grounded",
        disclaimer="Preliminary guidance only. Verify final eligibility, documents and deadlines on the official government source.",
    )


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": APP_NAME,
        "gemini_configured": bool(GEMINI_API_KEY),
        "custom_email_configured": _has_custom_email_configuration(),
        "firebase_admin_configured": not _firebase_config_missing(),
        "smtp_configured": not _smtp_config_missing(),
        "recovery_code_configured": bool(os.getenv("RECOVERY_CODE_PEPPER", "").strip()),
        "model": GEMINI_MODEL,
    }


@app.delete("/api/v1/account/data")
async def delete_account_data(authorization: str | None = Header(default=None)) -> dict[str, str]:
    claims = require_firebase_token(authorization)
    _require_recent_auth(claims, 300, "deleting your account")
    bucket_name = _require_storage_configuration()
    try:
        from firebase_admin import storage as firebase_storage

        db = _firestore_client()
        bucket = firebase_storage.bucket(name=bucket_name)
        await asyncio.to_thread(_purge_account_data, db, bucket, str(claims["uid"]))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Account data cleanup could not be completed")
        raise HTTPException(
            status_code=503,
            detail="Account data cleanup did not complete. Your sign-in account is still active; retry deletion.",
        ) from exc
    return {"status": "deleted"}


@app.post("/api/v1/auth/verification-email")
async def send_verification_email(authorization: str | None = Header(default=None)) -> dict[str, str]:
    missing_configuration = [*_firebase_config_missing(), *_smtp_config_missing()]
    if missing_configuration:
        raise HTTPException(
            status_code=503,
            detail=f"Branded verification email delivery is not configured. Set: {', '.join(missing_configuration)}.",
        )
    claims = verify_optional_firebase_token(authorization)
    if not claims or not claims.get("uid"):
        raise HTTPException(status_code=401, detail="Sign in before requesting a verification email.")

    try:
        from firebase_admin import auth as firebase_auth
        account = firebase_auth.get_user(str(claims["uid"]))
    except Exception as exc:
        logger.exception("Could not load the authenticated account for email verification")
        raise HTTPException(status_code=502, detail="The account could not be checked. Please try again.") from exc

    if not account.email:
        raise HTTPException(status_code=400, detail="This account does not have an email address to verify.")
    if account.email_verified:
        raise HTTPException(status_code=409, detail="This email address is already verified.")
    try:
        app_base_url = _public_app_base_url()
    except ValueError as exc:
        logger.exception("Email verification app URL is misconfigured")
        raise HTTPException(status_code=503, detail="The branded verification email URL is not configured correctly.") from exc

    now = time.monotonic()
    previous_send = _verification_email_last_sent.get(account.uid)
    if previous_send is not None and now - previous_send < 60:
        wait_seconds = max(1, int(60 - (now - previous_send) + 0.999))
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {wait_seconds} seconds before requesting another verification email.",
        )
    _verification_email_last_sent[account.uid] = now

    try:
        firebase_action_link = await asyncio.to_thread(
            firebase_auth.generate_email_verification_link,
            account.email,
        )
        verification_url = _verification_app_link(firebase_action_link, app_base_url)
        display_name = (account.display_name or "").strip()
        welcome_message = "Welcome to BharatSathi AI 👋"
        await asyncio.to_thread(
            _send_branded_email,
            account.email,
            "BharatSathi AI — Verify Your Email",
            "Verify your email",
            [
                welcome_message,
                *( [f"Hi {display_name},"] if display_name else [] ),
                "You’re almost ready to access BharatSathi AI. Please verify your email address to activate your account.",
                "For your security, this verification link is intended only for you and may expire after a limited period.",
                "If you didn’t create a BharatSathi AI account, you can safely ignore this email.",
            ],
            cta_label="VERIFY MY EMAIL",
            cta_url=verification_url,
        )
    except Exception as exc:
        _verification_email_last_sent.pop(account.uid, None)
        logger.exception("Custom verification email delivery failed")
        raise HTTPException(status_code=502, detail="The verification email could not be delivered. Please try again.") from exc

    return {"status": "sent"}


@app.get("/api/v1/auth/recovery-code/status")
async def recovery_code_status(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    claims = require_firebase_token(authorization)
    _recovery_code_policy()
    db = _firestore_client()
    try:
        snapshot = _recovery_code_ref(db, str(claims["uid"])).get()
    except Exception as exc:
        logger.exception("Could not load recovery-code status")
        raise HTTPException(status_code=503, detail="Recovery-code status is temporarily unavailable.") from exc
    if not snapshot.exists:
        return {"state": "not_issued", "expires_in": 0}
    record = snapshot.to_dict() or {}
    state = str(record.get("state") or "unavailable")
    expires_in = _remaining_ttl(record, 0)
    if state == "active" and expires_in <= 0:
        state = "expired"
    locked_until = _utc_datetime(record.get("lockedUntil"))
    if state == "active" and locked_until and locked_until > datetime.now(timezone.utc):
        state = "locked"
    if state not in {"active", "reserved", "used", "expired", "locked"}:
        state = "unavailable"
    return {"state": state, "expires_in": expires_in if state in {"active", "reserved"} else 0}


@app.post("/api/v1/auth/recovery-code")
async def issue_recovery_code(
    request: RecoveryCodeRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    claims = require_firebase_token(authorization)
    ttl, _, _, iterations, pepper = _recovery_code_policy()
    _, _, _, _, recent_auth_seconds = _email_change_policy()
    _require_recent_auth(claims, recent_auth_seconds)
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", request.recovery_code):
        raise HTTPException(status_code=422, detail="The recovery code must be a cryptographically generated 32-byte URL-safe code.")
    uid = str(claims["uid"])
    account = _load_firebase_account(uid)
    if not account.email:
        raise HTTPException(status_code=400, detail="The Firebase account does not have an email address.")
    db = _firestore_client()
    try:
        state, expires_in = await asyncio.to_thread(
            _store_recovery_code,
            db,
            uid,
            request.recovery_code,
            ttl,
            iterations,
            pepper,
        )
    except Exception as exc:
        logger.exception("Could not store a hashed account recovery code")
        raise HTTPException(status_code=503, detail="Recovery-code storage is temporarily unavailable.") from exc
    if state == "reserved":
        raise HTTPException(status_code=409, detail="A recovery request is already in progress.")
    if state == "locked":
        raise HTTPException(status_code=429, detail=f"The recovery code is locked. Try again in {expires_in} seconds.")
    if state == "already_exists":
        raise HTTPException(status_code=409, detail="A recovery code has already been issued and cannot be displayed again.")
    if state == "unavailable":
        raise HTTPException(status_code=503, detail="Recovery-code storage is unavailable or inconsistent.")
    return {"status": state, "expires_in": expires_in}


@app.post("/api/v1/auth/email-change/initiate")
async def initiate_email_change(
    request: EmailChangeInitiateRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    claims = require_firebase_token(authorization)
    ttl, resend_interval, _, _, recent_auth_seconds = _email_change_policy()
    _require_recent_auth(claims, recent_auth_seconds)
    new_email = _valid_email_address(request.new_email)
    uid = str(claims["uid"])
    account = _load_firebase_account(uid)
    old_email = str(account.email).strip().lower()
    if not account.email_verified:
        raise HTTPException(status_code=403, detail="Verify your current Firebase email before requesting an email change.")
    if new_email == old_email:
        raise HTTPException(status_code=409, detail="The new email must differ from the current account email.")
    _require_smtp_configuration()
    try:
        from firebase_admin import auth as firebase_auth
    except Exception as exc:
        logger.error("Firebase Auth is unavailable during email availability check")
        raise HTTPException(status_code=503, detail="Firebase Auth is temporarily unavailable.") from exc
    try:
        firebase_auth.get_user_by_email(new_email)
    except firebase_auth.UserNotFoundError:
        pass
    except Exception as exc:
        logger.error("Could not check whether the requested email is available")
        raise HTTPException(status_code=502, detail="The new email address could not be checked.") from exc
    else:
        raise HTTPException(status_code=409, detail="The new email address is already associated with an account.")

    db = _firestore_client()
    reference = _email_change_ref(db, uid)
    token, token_salt, token_hash = _new_email_change_token(reference.id)
    continue_link = _email_change_link("old", token)
    result = await asyncio.to_thread(
        _start_email_change,
        db,
        uid,
        old_email,
        new_email,
        bool(account.email_verified),
        ttl,
        resend_interval,
        token_salt,
        token_hash,
    )
    if result == "active":
        raise HTTPException(status_code=409, detail="An email change is already in progress.")
    if result == "rate_limited":
        raise HTTPException(status_code=429, detail="Please wait before requesting another email change.")
    try:
        await asyncio.to_thread(
            _send_branded_email,
            old_email,
            "BharatSathi AI — Confirm Email Change",
            "Confirm your current email",
            [
                "A request was made to change the email address on your BharatSathi AI account.",
                f"Current email: {old_email}",
                f"Requested new email: {new_email}",
                "Confirm that you control this current email address. The account email will not change until the new address is also confirmed.",
                "If you did not make this request, sign in and cancel it. No account email has been changed.",
            ],
            cta_label="Confirm Current Email",
            cta_url=continue_link,
        )
    except Exception as exc:
        try:
            snapshot = reference.get()
            if snapshot.exists and (snapshot.to_dict() or {}).get("oldTokenHash") == token_hash:
                reference.update({
                    "state": "delivery_failed",
                    "oldTokenHash": None,
                    "oldTokenSalt": None,
                    "updatedAt": datetime.now(timezone.utc),
                })
        except Exception:
            logger.error("Could not clear an undelivered email-change token")
        logger.error("Initial current-email confirmation delivery failed")
        raise HTTPException(status_code=502, detail="The current-email confirmation could not be delivered.") from exc
    return {"status": "pending_old_confirmation", "expires_in": ttl}


@app.post("/api/v1/auth/email-change/recovery/initiate")
async def initiate_email_change_recovery(
    request: EmailRecoveryInitiateRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    claims = require_firebase_token(authorization)
    ttl, resend_interval, max_resends, _, recent_auth_seconds = _email_change_policy()
    _, recovery_attempts, attempt_interval, iterations, pepper = _recovery_code_policy()
    _require_recent_auth(claims, recent_auth_seconds)
    _require_smtp_configuration()
    new_email = _valid_email_address(request.new_email)
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", request.recovery_code):
        raise HTTPException(status_code=422, detail="Enter the recovery code shown when your account was registered.")
    uid = str(claims["uid"])
    account = _load_firebase_account(uid)
    old_email = str(account.email).strip().lower()
    if not account.email_verified:
        raise HTTPException(status_code=403, detail="The current Firebase account email must already be verified.")
    if new_email == old_email:
        raise HTTPException(status_code=409, detail="The new email must differ from the current account email.")
    try:
        from firebase_admin import auth as firebase_auth
        firebase_auth.get_user_by_email(new_email)
    except firebase_auth.UserNotFoundError:
        pass
    except Exception as exc:
        logger.exception("Could not check the recovery email address availability")
        raise HTTPException(status_code=502, detail="The new email address could not be checked.") from exc
    else:
        raise HTTPException(status_code=409, detail="The new email address is already associated with an account.")

    db = _firestore_client()
    change_ref = _email_change_ref(db, uid)
    token, token_salt, token_hash = _new_email_change_token(change_ref.id)
    new_link = _email_change_link("new", token)
    try:
        result, record, wait_seconds = await asyncio.to_thread(
            _start_email_change_recovery,
            db,
            uid,
            old_email,
            new_email,
            request.recovery_code,
            ttl,
            resend_interval,
            max_resends,
            recovery_attempts,
            attempt_interval,
            iterations,
            pepper,
            token_salt,
            token_hash,
        )
    except Exception as exc:
        logger.exception("Could not validate the recovery code or create a recovery email-change request")
        raise HTTPException(status_code=503, detail="Email recovery is temporarily unavailable.") from exc
    if result == "missing_code":
        raise HTTPException(status_code=404, detail="No recovery code is registered for this account.")
    if result == "expired_code":
        raise HTTPException(status_code=410, detail="The recovery code has expired. Sign in and create a new recovery code.")
    if result == "used_code":
        raise HTTPException(status_code=410, detail="The recovery code was already used. Sign in and create a new recovery code.")
    if result == "unavailable_code":
        raise HTTPException(status_code=409, detail="The recovery code is unavailable or already reserved for another request.")
    if result == "bad_code":
        raise HTTPException(status_code=400, detail="The recovery code is incorrect.")
    if result == "rate_limited":
        raise HTTPException(status_code=429, detail=f"Please wait {wait_seconds} seconds before trying recovery again.")
    if result == "active_change":
        raise HTTPException(status_code=409, detail="An email change is already in progress.")
    if result != "started" or record is None:
        raise HTTPException(status_code=503, detail="The recovery request could not be started.")

    try:
        await asyncio.to_thread(
            _send_branded_email,
            new_email,
            "BharatSathi AI — Verify Your New Email",
            "Verify your new email",
            [
                "A request was made to change the email address on your BharatSathi AI account using its recovery code.",
                f"New email: {new_email}",
                "Confirm this new address to finish the recovery. The Firebase account email remains unchanged until this link is used.",
                "If you did not make this request, secure your BharatSathi AI account and contact support.",
            ],
            cta_label="VERIFY NEW EMAIL",
            cta_url=new_link,
        )
    except Exception as exc:
        try:
            change_ref.update({"lastNewSentAt": None, "updatedAt": datetime.now(timezone.utc)})
        except Exception:
            logger.exception("Could not prepare an email recovery confirmation for resend")
        logger.exception("Recovery new-email confirmation delivery failed")
        raise HTTPException(status_code=502, detail="The new-email verification could not be delivered. You may resend it from your profile.") from exc
    return {"status": "pending_new_confirmation", "expires_in": ttl}


@app.get("/api/v1/auth/email-change/status")
async def email_change_status(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    claims = require_firebase_token(authorization)
    db = _firestore_client()
    reference = _email_change_ref(db, str(claims["uid"]))
    try:
        snapshot = reference.get()
    except Exception as exc:
        logger.error("Could not load email-change status")
        raise HTTPException(status_code=503, detail="Email-change status is temporarily unavailable.") from exc
    if not snapshot.exists:
        return {"state": "none", "new_email": None, "expires_in": 0}
    record = snapshot.to_dict() or {}
    state = str(record.get("state") or "unavailable")
    allowed_states = {"pending_old", "pending_new", "updating", "recovery_required", "completed", "cancelled", "expired", "delivery_failed"}
    if state not in allowed_states:
        state = "unavailable"
    remaining = _remaining_ttl(record, 0)
    if state in ("pending_old", "pending_new") and remaining <= 0:
        state = "expired"
    active_states = {"pending_old", "pending_new", "updating", "recovery_required"}
    new_email = record.get("newEmail")
    return {
        "state": state,
        "change_type": "recovery" if record.get("changeType") == "recovery" else "standard",
        "new_email": new_email if state in active_states and isinstance(new_email, str) else None,
        "expires_in": remaining if state in active_states else 0,
    }


@app.post("/api/v1/auth/email-change/resend")
async def resend_email_change_confirmation(
    request: EmailChangeResendRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    claims = require_firebase_token(authorization)
    ttl, resend_interval, max_resends, _, recent_auth_seconds = _email_change_policy()
    _require_recent_auth(claims, recent_auth_seconds)
    _require_smtp_configuration()
    stage = request.stage.strip().lower()
    if stage not in ("old", "new"):
        raise HTTPException(status_code=422, detail="stage must be 'old' or 'new'.")
    uid = str(claims["uid"])
    db = _firestore_client()
    reference = _email_change_ref(db, uid)
    token, token_salt, token_hash = _new_email_change_token(reference.id)
    continue_link = _email_change_link(stage, token)
    try:
        result, record = await asyncio.to_thread(
            _prepare_email_change_resend,
            db,
            reference,
            stage,
            token_salt,
            token_hash,
            resend_interval,
            max_resends,
        )
    except Exception as exc:
        logger.error("Could not prepare an email-change confirmation resend")
        raise HTTPException(status_code=503, detail="Email-change confirmation is temporarily unavailable.") from exc
    if result == "missing":
        raise HTTPException(status_code=404, detail="There is no email change to resend.")
    if result == "invalid_state":
        raise HTTPException(status_code=409, detail="That email-change confirmation stage is not pending.")
    if result == "expired":
        raise HTTPException(status_code=410, detail="The email-change request has expired.")
    if result == "rate_limited":
        raise HTTPException(status_code=429, detail="Please wait before requesting another confirmation email.")
    if result == "limit_reached":
        raise HTTPException(status_code=429, detail="The resend limit for this confirmation stage has been reached.")

    recipient = record["oldEmail"] if stage == "old" else record["newEmail"]
    heading = "Confirm your current email" if stage == "old" else "Confirm your new email"
    try:
        await asyncio.to_thread(
            _send_branded_email,
            recipient,
            "BharatSathi AI — Confirm Email Change",
            heading,
            [
                "Use the secure link to confirm this email address.",
                f"Current email: {record['oldEmail']}",
                f"Requested new email: {record['newEmail']}",
                "The account email changes only after both the current and new addresses are confirmed.",
            ],
            cta_label="Confirm Email",
            cta_url=continue_link,
        )
    except Exception as exc:
        try:
            field = "lastOldSentAt" if stage == "old" else "lastNewSentAt"
            hash_field = "oldTokenHash" if stage == "old" else "newTokenHash"
            if (reference.get().to_dict() or {}).get(hash_field) == token_hash:
                reference.update({field: None, "updatedAt": datetime.now(timezone.utc)})
        except Exception:
            logger.error("Could not update failed email-change resend state")
        logger.error("Email-change confirmation resend failed")
        raise HTTPException(status_code=502, detail="The confirmation email could not be delivered.") from exc
    return {"status": "sent", "stage": stage, "expires_in": _remaining_ttl(record, ttl)}


@app.post("/api/v1/auth/email-change/confirm-old")
async def confirm_old_email_change(request: EmailChangeTokenRequest) -> dict[str, Any]:
    _require_smtp_configuration()
    ttl, _, _, max_attempts, _ = _email_change_policy()
    db = _firestore_client()
    reference = _email_change_ref_for_token(db, request.token)
    new_token, new_salt, new_hash = _new_email_change_token(reference.id)
    new_link = _email_change_link("new", new_token)
    try:
        result, record = await asyncio.to_thread(
            _confirm_old_email_token,
            db,
            reference,
            request.token,
            new_salt,
            new_hash,
            max_attempts,
        )
    except Exception as exc:
        logger.error("Could not validate current-email confirmation")
        raise HTTPException(status_code=503, detail="Email confirmation is temporarily unavailable.") from exc
    if result == "missing":
        raise HTTPException(status_code=404, detail="The email-change request was not found.")
    if result == "expired":
        raise HTTPException(status_code=410, detail="The email-change confirmation has expired.")
    if result == "locked":
        raise HTTPException(status_code=429, detail="Too many invalid confirmation attempts.")
    if result == "bad":
        raise HTTPException(status_code=400, detail="The email-change confirmation is invalid.")
    if result == "invalid_state":
        raise HTTPException(status_code=409, detail="The current-email confirmation is no longer pending.")

    try:
        await asyncio.to_thread(
            _send_branded_email,
            record["newEmail"],
            "BharatSathi AI — Verify Your New Email",
            "Confirm your new email address",
            [
                "You confirmed control of the current email address for this account.",
                f"New email: {record['newEmail']}",
                "Confirm this new address to finish the email change. Your BharatSathi AI account email remains unchanged until this step succeeds.",
            ],
            cta_label="Confirm New Email",
            cta_url=new_link,
        )
    except Exception as exc:
        try:
            latest = reference.get()
            if latest.exists and (latest.to_dict() or {}).get("newTokenHash") == new_hash:
                reference.update({"lastNewSentAt": None, "updatedAt": datetime.now(timezone.utc)})
        except Exception:
            logger.error("Could not update failed new-email delivery state")
        logger.error("New-email verification delivery failed after current-email confirmation")
        raise HTTPException(status_code=502, detail="The new-email confirmation could not be delivered; request a resend.") from exc
    return {"status": "old_email_confirmed", "next_step": "confirm_new_email", "expires_in": _remaining_ttl(record, ttl)}


@app.post("/api/v1/auth/email-change/confirm-new")
async def confirm_new_email_change(request: EmailChangeTokenRequest) -> dict[str, str]:
    _, _, _, max_attempts, _ = _email_change_policy()
    db = _firestore_client()
    reference = _email_change_ref_for_token(db, request.token)
    try:
        result, record = await asyncio.to_thread(
            _claim_new_email_confirmation,
            db,
            reference,
            request.token,
            max_attempts,
        )
    except Exception as exc:
        logger.error("Could not validate new-email confirmation")
        raise HTTPException(status_code=503, detail="Email confirmation is temporarily unavailable.") from exc
    if result == "missing":
        raise HTTPException(status_code=404, detail="The email-change request was not found.")
    if result == "expired":
        raise HTTPException(status_code=410, detail="The email-change confirmation has expired.")
    if result == "locked":
        raise HTTPException(status_code=429, detail="Too many invalid confirmation attempts.")
    if result == "bad":
        raise HTTPException(status_code=400, detail="The email-change confirmation is invalid.")
    if result == "invalid_state":
        raise HTTPException(status_code=409, detail="The new-email confirmation is no longer pending.")

    uid = str(record["uid"])
    old_email = str(record["oldEmail"])
    new_email = str(record["newEmail"])
    old_email_verified = bool(record.get("oldEmailVerified"))
    if record.get("changeType") != "recovery" and not old_email_verified:
        reference.update({"state": "recovery_required", "updatedAt": datetime.now(timezone.utc)})
        raise HTTPException(status_code=409, detail="The current email address was not confirmed; the email change cannot proceed.")
    recovery_ref = None
    if record.get("changeType") == "recovery":
        recovery_ref = _recovery_code_ref(db, uid)
        if record.get("recoveryCodeRefId") != recovery_ref.id:
            reference.update({"state": "recovery_required", "updatedAt": datetime.now(timezone.utc)})
            raise HTTPException(status_code=409, detail="Recovery authorization could not be verified; contact support.")
        try:
            recovery_snapshot = recovery_ref.get()
        except Exception as exc:
            reference.update({"state": "pending_new", "updatedAt": datetime.now(timezone.utc)})
            logger.exception("Could not verify the reserved recovery code")
            raise HTTPException(status_code=503, detail="Recovery authorization is temporarily unavailable.") from exc
        recovery_record = recovery_snapshot.to_dict() or {} if recovery_snapshot.exists else {}
        recovery_expiry = _utc_datetime(recovery_record.get("expiresAt"))
        if (
            recovery_record.get("state") != "reserved"
            or recovery_record.get("reservedBy") != reference.id
            or not recovery_expiry
            or recovery_expiry <= datetime.now(timezone.utc)
        ):
            reference.update({"state": "recovery_required", "updatedAt": datetime.now(timezone.utc)})
            raise HTTPException(status_code=409, detail="The recovery authorization has expired or is no longer valid.")
    try:
        from firebase_admin import auth as firebase_auth, firestore
        account = firebase_auth.get_user(uid)
    except Exception as exc:
        reference.update({"state": "pending_new", "updatedAt": datetime.now(timezone.utc)})
        logger.error("Could not load the account for a confirmed email change")
        raise HTTPException(status_code=502, detail="The account could not be checked for the email change.") from exc
    if (account.email or "").strip().lower() != old_email:
        reference.update({"state": "recovery_required", "updatedAt": datetime.now(timezone.utc)})
        raise HTTPException(status_code=409, detail="The account email changed outside this request; contact support.")

    try:
        firebase_auth.update_user(uid, email=new_email, email_verified=True)
    except Exception as exc:
        reference.update({"state": "pending_new", "updatedAt": datetime.now(timezone.utc)})
        if "email-already-exists" in str(getattr(exc, "code", "")):
            raise HTTPException(status_code=409, detail="The new email address is already associated with an account.") from exc
        logger.error("Firebase Auth rejected the confirmed email change")
        raise HTTPException(status_code=502, detail="Firebase Auth could not update the account email.") from exc

    try:
        batch = db.batch()
        profile_ref = db.collection("users").document(uid)
        batch.set(profile_ref, {"email": new_email, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)
        batch.update(reference, {
            "state": "completed",
            "oldTokenSalt": None,
            "oldTokenHash": None,
            "newTokenSalt": None,
            "newTokenHash": None,
            "completedAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        if recovery_ref is not None:
            batch.update(recovery_ref, {
                "state": "used",
                "salt": None,
                "codeHash": None,
                "reservedBy": None,
                "usedAt": firestore.SERVER_TIMESTAMP,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        batch.commit()
    except Exception as exc:
        committed = False
        try:
            latest = reference.get()
            committed = latest.exists and (latest.to_dict() or {}).get("state") == "completed"
        except Exception:
            logger.error("Could not verify the email-change commit state")
        if committed:
            logger.error("Firestore commit response was ambiguous; completion state was confirmed")
        else:
            try:
                firebase_auth.update_user(uid, email=old_email, email_verified=old_email_verified)
                reference.update({"state": "pending_new", "updatedAt": datetime.now(timezone.utc)})
            except Exception:
                try:
                    reference.update({"state": "recovery_required", "updatedAt": datetime.now(timezone.utc)})
                except Exception:
                    logger.error("Could not record email-change recovery state")
                logger.error("Email change compensation failed; manual account recovery is required")
                raise HTTPException(status_code=503, detail="Email change could not be completed safely; contact support.") from exc
            logger.error("Firestore profile update failed; Firebase Auth email was restored")
            raise HTTPException(status_code=503, detail="The profile email could not be updated; retry the confirmation.") from exc

    if _smtp_is_configured():
        recovery_notice = record.get("changeType") == "recovery"
        subject = "BharatSathi AI — Account Email Changed"
        security_line = (
            "This email change was completed using your account recovery code."
            if recovery_notice
            else "Both your current and new email addresses were confirmed for this change."
        )
        messages = [
            asyncio.to_thread(
                _send_branded_email,
                old_email,
                subject,
                "Account email changed",
                [f"The email address on your BharatSathi AI account was changed to {new_email}.", security_line, "If you did not do this, contact support immediately."],
            ),
            asyncio.to_thread(
                _send_branded_email,
                new_email,
                subject,
                "Account email changed",
                ["This email address is now associated with your BharatSathi AI account.", security_line],
            ),
        ]
        results = await asyncio.gather(*messages, return_exceptions=True)
        notification_status = "sent" if all(not isinstance(result, Exception) for result in results) else "partial"
        if notification_status == "partial":
            logger.error("One or more post-change notification emails could not be delivered")
    else:
        notification_status = "skipped"
    return {"status": "completed", "notification_status": notification_status}


@app.post("/api/v1/auth/email-change/cancel")
async def cancel_email_change(authorization: str | None = Header(default=None)) -> dict[str, str]:
    claims = require_firebase_token(authorization)
    _, _, _, _, recent_auth_seconds = _email_change_policy()
    _require_recent_auth(claims, recent_auth_seconds)
    uid = str(claims["uid"])
    db = _firestore_client()
    reference = _email_change_ref(db, uid)
    recovery_reference = _recovery_code_ref(db, uid)
    from firebase_admin import firestore
    transaction = db.transaction()
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def cancel(tx):
        snapshot = reference.get(transaction=tx)
        if not snapshot.exists:
            return "missing", None
        data = snapshot.to_dict() or {}
        if data.get("state") in ("completed", "updating", "recovery_required"):
            return "not_cancellable", None
        if data.get("state") == "cancelled":
            return "already_cancelled", data
        recovery_snapshot = None
        if data.get("changeType") == "recovery":
            recovery_snapshot = recovery_reference.get(transaction=tx)
        tx.update(reference, {
            "state": "cancelled",
            "oldTokenSalt": None,
            "oldTokenHash": None,
            "newTokenSalt": None,
            "newTokenHash": None,
            "updatedAt": now,
        })
        if recovery_snapshot is not None and recovery_snapshot.exists:
            recovery_data = recovery_snapshot.to_dict() or {}
            if recovery_data.get("state") == "reserved" and recovery_data.get("reservedBy") == reference.id:
                tx.update(recovery_reference, {
                    "state": "active",
                    "reservedBy": None,
                    "reservedAt": None,
                    "updatedAt": now,
                })
        return "cancelled", data

    try:
        result, record = await asyncio.to_thread(cancel, transaction)
    except Exception as exc:
        logger.error("Could not cancel the email-change request")
        raise HTTPException(status_code=503, detail="The email-change request could not be cancelled.") from exc
    if result == "missing":
        raise HTTPException(status_code=404, detail="There is no email change to cancel.")
    if result == "not_cancellable":
        raise HTTPException(status_code=409, detail="The email change is already completing or requires support.")
    if result == "already_cancelled":
        return {"status": "cancelled", "notification_status": "skipped"}
    notification_status = "skipped"
    if record and _smtp_is_configured():
        recipients = list(dict.fromkeys([record.get("oldEmail"), record.get("newEmail")]))
        deliveries = await asyncio.gather(*[
            asyncio.to_thread(
                _send_branded_email,
                recipient,
                "BharatSathi AI email change cancelled",
                "Email change cancelled",
                ["A pending email change for your BharatSathi AI account was cancelled. No account email was changed."],
            )
            for recipient in recipients if recipient
        ], return_exceptions=True)
        notification_status = "sent" if all(not isinstance(result, Exception) for result in deliveries) else "partial"
    return {"status": "cancelled", "notification_status": notification_status}


@app.post("/api/v1/documents/{document_id}/access-pin")
async def send_document_access_pin(
    document_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    claims = require_firebase_token(authorization)
    _require_smtp_configuration()
    _require_storage_configuration()
    ttl, max_attempts = _document_pin_policy()
    uid = str(claims["uid"])
    db = _firestore_client()
    _, document, stored_document_id, _ = _load_owned_document(db, document_id, uid)
    account = _load_firebase_account(uid)
    documents_url = _application_url("/documents")

    pin = f"{secrets.randbelow(1_000_000):06d}"
    salt = secrets.token_bytes(16)
    iterations = 310_000
    pin_hash = hashlib.pbkdf2_hmac("sha256", pin.encode("ascii"), salt, iterations).hex()
    pin_ref = _document_access_pin_ref(db, uid, stored_document_id)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl)
    try:
        pin_ref.set({
            "ownerUid": uid,
            "documentId": stored_document_id,
            "salt": salt.hex(),
            "pinHash": pin_hash,
            "iterations": iterations,
            "expiresAt": expires_at,
            "attempts": 0,
            "maxAttempts": max_attempts,
            "locked": False,
        })
    except Exception as exc:
        logger.exception("Could not persist a hashed document access PIN")
        raise HTTPException(status_code=503, detail="Document PIN storage is temporarily unavailable.") from exc

    document_label = str(
        document.get("customDocumentName")
        or document.get("documentType")
        or document.get("name")
        or document.get("label")
        or "Uploaded document"
    )
    scheme_label = (
        document.get("schemeName") or document.get("applicationName")
        or document.get("schemeId") or document.get("applicationId")
    )
    application_label = document.get("applicationLabel")
    body_lines = [
        f"Document: {document_label}",
        f"File: {document.get('fileName') or 'Uploaded document'}",
        "Your document is stored in your private BharatSathi AI account.",
    ]
    if scheme_label:
        body_lines.append(f"Scheme: {scheme_label}")
    if application_label:
        body_lines.append(f"Application: {application_label}")
    body_lines.extend([
        f"Current status: {document.get('status') or document.get('verificationStatus') or 'Not specified'}",
        f"Your one-time download PIN is {pin}. It expires in {ttl} seconds and allows up to {max_attempts} attempts.",
        "Use this PIN only in BharatSathi AI. The file is not attached to this email.",
    ])
    try:
        await asyncio.to_thread(
            _send_branded_email,
            account.email,
            "Your BharatSathi AI document access PIN",
            "Document upload notification",
            body_lines,
            cta_label="Open Documents",
            cta_url=documents_url,
        )
    except Exception as exc:
        try:
            snapshot = pin_ref.get()
            if snapshot.exists and (snapshot.to_dict() or {}).get("pinHash") == pin_hash:
                pin_ref.delete()
        except Exception:
            logger.exception("Could not clear an undelivered document PIN")
        logger.exception("Document access PIN email delivery failed")
        raise HTTPException(status_code=502, detail="The document access PIN email could not be delivered.") from exc
    return {"status": "sent", "expires_in": ttl, "max_attempts": max_attempts}


@app.post("/api/v1/documents/{document_id}/download-url")
async def create_document_download_url(
    document_id: str,
    request: DocumentPinRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    claims = require_firebase_token(authorization)
    if not re.fullmatch(r"\d{6}", request.pin):
        raise HTTPException(status_code=400, detail="PIN must contain exactly six digits.")
    bucket_name = _require_storage_configuration()
    uid = str(claims["uid"])
    db = _firestore_client()
    _, document, stored_document_id, storage_path = _load_owned_document(db, document_id, uid)
    try:
        from firebase_admin import storage
        bucket = storage.bucket(name=str(document.get("storageBucket") or bucket_name))
        blob = bucket.blob(storage_path)
        exists = await asyncio.to_thread(blob.exists)
    except Exception as exc:
        logger.exception("Firebase Storage document lookup failed")
        raise HTTPException(status_code=502, detail="The document could not be checked in Firebase Storage.") from exc
    if not exists:
        raise HTTPException(status_code=404, detail="The document file does not exist in Firebase Storage.")

    try:
        download_url = await asyncio.to_thread(
            blob.generate_signed_url,
            expiration=timedelta(minutes=5),
            method="GET",
            version="v4",
        )
    except Exception as exc:
        logger.exception("Firebase Storage could not create a signed document URL")
        raise HTTPException(status_code=503, detail="A short-lived Firebase Storage download URL is unavailable.") from exc
    pin_ref = _document_access_pin_ref(db, uid, stored_document_id)
    try:
        result = await asyncio.to_thread(_consume_document_pin, pin_ref, request.pin)
    except Exception as exc:
        logger.exception("Document access PIN verification failed")
        raise HTTPException(status_code=503, detail="Document PIN verification is temporarily unavailable.") from exc
    if result == "missing":
        raise HTTPException(status_code=404, detail="No active document access PIN was found.")
    if result == "expired":
        raise HTTPException(status_code=410, detail="The document access PIN has expired.")
    if result == "locked":
        raise HTTPException(status_code=429, detail="The document access PIN is locked after too many attempts.")
    if result == "bad":
        raise HTTPException(status_code=400, detail="The document access PIN is incorrect.")
    return {"download_url": download_url, "expires_in": 300}


@app.post("/api/v1/applications/{application_id}/notify-status")
async def notify_application_status(
    application_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    claims = require_firebase_token(authorization)
    _require_smtp_configuration()
    if not application_id or "/" in application_id:
        raise HTTPException(status_code=404, detail="Application not found.")
    uid = str(claims["uid"])
    db = _firestore_client()
    try:
        snapshot = db.collection("applications").document(application_id).get()
    except Exception as exc:
        logger.exception("Could not load a Firestore application record")
        raise HTTPException(status_code=502, detail="The application record could not be loaded.") from exc
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Application not found.")
    record = snapshot.to_dict() or {}
    if record.get("userId") != uid:
        raise HTTPException(status_code=403, detail="This application does not belong to the authenticated account.")
    status = _application_status(record)
    if not status:
        raise HTTPException(
            status_code=409,
            detail="Only Applied, Documents Pending, Under Review, Approved, Rejected, or Completed tracker statuses can be notified.",
        )

    try:
        profile_snapshot = db.collection("users").document(uid).get()
    except Exception as exc:
        logger.exception("Could not load application notification preferences")
        raise HTTPException(status_code=502, detail="Notification preferences could not be checked.") from exc
    profile = profile_snapshot.to_dict() or {}
    if profile.get("applicationNotificationsEnabled") is False:
        return {"status": "skipped", "reason": "application_notifications_disabled"}
    if status in ("Approved", "Rejected") and profile.get("applicationDecisionNotificationsEnabled") is False:
        return {"status": "skipped", "reason": "application_decision_notifications_disabled"}

    account = _load_firebase_account(uid)
    status_timestamp = record.get("updatedAt", record.get("lastUpdated"))
    dedupe_value = f"application:{uid}:{application_id}:{status.lower()}:{_timestamp_key(status_timestamp)}"
    dedupe_id = hashlib.sha256(dedupe_value.encode("utf-8")).hexdigest()
    try:
        claim = await asyncio.to_thread(_claim_notification, db, dedupe_id, uid)
    except Exception as exc:
        logger.exception("Could not reserve the application status notification")
        raise HTTPException(status_code=503, detail="Application notification delivery is temporarily unavailable.") from exc
    if claim == "duplicate":
        return {"status": "duplicate"}

    scheme_label = record.get("schemeName") or record.get("schemeId")
    body_lines = [f"Your BharatSathi AI application tracker is marked: {status}."]
    if scheme_label:
        body_lines.append(f"Scheme/application: {scheme_label}")
    if record.get("nextAction"):
        body_lines.append(f"Next step in your tracker: {record['nextAction']}")
    body_lines.append("This status is user-managed in BharatSathi AI and is not an official government status.")
    message = f"{scheme_label or 'Application'} tracker status: {status}"
    notice = {
        "userId": uid,
        "type": "application_status",
        "title": "Application tracker update",
        "message": message,
        "applicationId": application_id,
        "status": status,
        "read": False,
        "createdAt": datetime.now(timezone.utc),
    }
    send_email = claim == "send"
    try:
        if send_email:
            await asyncio.to_thread(
                _send_branded_email,
                account.email,
                f"BharatSathi AI application tracker: {status}",
                "Application tracker update",
                body_lines,
            )
            db.collection("_private_notification_sends").document(dedupe_id).update({
                "state": "email_sent",
                "sentAt": datetime.now(timezone.utc),
            })
        db.collection("notifications").document(dedupe_id).set(notice)
        db.collection("_private_notification_sends").document(dedupe_id).update({
            "state": "sent",
            "notificationId": dedupe_id,
            "sentAt": datetime.now(timezone.utc),
        })
    except Exception as exc:
        if send_email:
            try:
                ref = db.collection("_private_notification_sends").document(dedupe_id)
                state = (ref.get().to_dict() or {}).get("state")
                if state != "email_sent":
                    ref.delete()
            except Exception:
                logger.exception("Could not release a failed application notification reservation")
        logger.exception("Application status notification failed")
        raise HTTPException(status_code=502, detail="The application status notification could not be completed.") from exc
    return {"status": "sent", "notification_id": dedupe_id}


@app.post("/api/v1/documents/{document_id}/notify-upload")
async def notify_document_upload(
    document_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    claims = require_firebase_token(authorization)
    bucket_name = _require_storage_configuration()
    uid = str(claims["uid"])
    db = _firestore_client()
    _, record, stored_document_id, storage_path = _load_owned_document(db, document_id, uid)

    try:
        from firebase_admin import storage
        blob = storage.bucket(name=bucket_name).blob(storage_path)
        exists = await asyncio.to_thread(blob.exists)
    except Exception as exc:
        logger.exception("Could not verify the uploaded file before sending its notification")
        raise HTTPException(status_code=502, detail="The uploaded file could not be verified in Firebase Storage.") from exc
    if not exists:
        raise HTTPException(status_code=404, detail="The uploaded file is not present in Firebase Storage.")

    try:
        profile_snapshot = db.collection("users").document(uid).get()
    except Exception as exc:
        logger.exception("Could not load document notification preferences")
        raise HTTPException(status_code=502, detail="Document notification preferences could not be checked.") from exc
    profile = profile_snapshot.to_dict() or {}
    if profile.get("documentNotificationsEnabled") is False:
        return {"status": "skipped"}

    account = _load_firebase_account(uid)
    if not account.email_verified:
        raise HTTPException(status_code=403, detail="Verify your account email before receiving document notifications.")
    _require_smtp_configuration()
    dedupe_id = hashlib.sha256(f"document-upload:{uid}:{stored_document_id}".encode("utf-8")).hexdigest()
    try:
        claim = await asyncio.to_thread(_claim_notification, db, dedupe_id, uid)
    except Exception as exc:
        logger.exception("Could not reserve the document upload notification")
        raise HTTPException(status_code=503, detail="Document upload notification is temporarily unavailable.") from exc
    if claim == "duplicate":
        return {"status": "duplicate"}

    document_label = str(record.get("customDocumentName") or record.get("documentType") or "Uploaded document")
    scheme_label = record.get("schemeName") or record.get("schemeId")
    body_lines = [
        "Your document upload was confirmed in Firebase Storage and saved in your private document vault.",
        f"Document type: {document_label}",
        "This confirms storage only; it is not an official document-authenticity decision.",
    ]
    if scheme_label:
        body_lines.insert(2, f"Application or scheme: {scheme_label}")
    notice = {
        "userId": uid,
        "type": "document_uploaded",
        "title": "Document uploaded successfully",
        "message": (
            f"{document_label} was uploaded and linked to {scheme_label}."
            if scheme_label
            else f"{document_label} was uploaded to your personal document vault."
        ),
        "documentId": stored_document_id,
        "applicationId": record.get("applicationId"),
        "read": False,
        "createdAt": datetime.now(timezone.utc),
    }
    send_email = claim == "send"
    try:
        if send_email:
            await asyncio.to_thread(
                _send_branded_email,
                account.email,
                "BharatSathi AI — Document Uploaded Successfully",
                "Document uploaded successfully",
                body_lines,
                cta_label="Open Document Center",
                cta_url=_application_url("/documents"),
            )
            db.collection("_private_notification_sends").document(dedupe_id).update({
                "state": "email_sent",
                "sentAt": datetime.now(timezone.utc),
            })
        db.collection("notifications").document(dedupe_id).set(notice)
        db.collection("_private_notification_sends").document(dedupe_id).update({
            "state": "sent",
            "notificationId": dedupe_id,
            "sentAt": datetime.now(timezone.utc),
        })
    except HTTPException:
        try:
            reservation = db.collection("_private_notification_sends").document(dedupe_id)
            if (reservation.get().to_dict() or {}).get("state") != "email_sent":
                reservation.delete()
        except Exception:
            logger.exception("Could not release a failed document upload notification reservation")
        raise
    except Exception as exc:
        try:
            reservation = db.collection("_private_notification_sends").document(dedupe_id)
            if (reservation.get().to_dict() or {}).get("state") != "email_sent":
                reservation.delete()
        except Exception:
            logger.exception("Could not release a failed document upload notification reservation")
        logger.exception("Document upload notification failed")
        raise HTTPException(status_code=502, detail="The document upload notification could not be completed.") from exc
    return {"status": "sent", "notification_id": dedupe_id}


@app.post("/api/v1/documents/{document_id}/notify-status")
async def notify_document_status(
    document_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    claims = require_firebase_token(authorization)
    _require_smtp_configuration()
    uid = str(claims["uid"])
    db = _firestore_client()
    document_ref, record, stored_document_id, _ = _load_owned_document(db, document_id, uid)
    verification_status = str(record.get("verificationStatus") or "").strip().upper()
    record_status = str(record.get("status") or "").strip().upper()
    if verification_status in ("MISMATCH", "DOCUMENT_MISMATCH"):
        message_status = "Mismatch"
    elif verification_status in ("NEEDS_REVIEW", "NEEDS_CONFIRMATION", "UNCERTAIN", "NOT_VERIFIED") or record_status in ("UPLOADED", "NEEDS_REVIEW"):
        message_status = "Needs review"
    elif verification_status in ("VERIFIED", "OFFICIALLY_VERIFIED") or record_status == "VERIFIED":
        message_status = "Verified"
    elif record_status in ("MISMATCH", "DOCUMENT_MISMATCH"):
        message_status = "Mismatch"
    else:
        raise HTTPException(status_code=409, detail="This document does not have a supported status to notify.")

    trusted_ref = db.collection("_private_official_document_verifications").document(document_ref.id)
    try:
        trusted_snapshot = trusted_ref.get()
    except Exception as exc:
        logger.exception("Could not load trusted document verification metadata")
        raise HTTPException(status_code=503, detail="Document verification metadata is temporarily unavailable.") from exc
    trusted_record = trusted_snapshot.to_dict() or {}
    official_confirmed = (
        trusted_record.get("officialServiceConfirmed") is True
        and isinstance(trusted_record.get("serviceName"), str)
        and bool(trusted_record.get("serviceName").strip())
    )
    if message_status == "Verified" and not official_confirmed:
        status_explanation = "It is marked verified in your BharatSathi tracker, but this is not an official authenticity verification."
    elif message_status == "Verified":
        status_explanation = f"{trusted_record['serviceName']} confirmed this document's status."
    elif message_status == "Mismatch":
        status_explanation = "The current BharatSathi document status indicates a possible mismatch; review the record and confirm the information."
    else:
        status_explanation = "The document is awaiting review in your BharatSathi tracker. No authenticity decision has been made."

    account = _load_firebase_account(uid)
    status_timestamp = record.get("updatedAt", record.get("uploadedAt"))
    dedupe_value = f"document:{uid}:{stored_document_id}:{message_status.lower()}:{_timestamp_key(status_timestamp)}"
    dedupe_id = hashlib.sha256(dedupe_value.encode("utf-8")).hexdigest()
    try:
        claim = await asyncio.to_thread(_claim_notification, db, dedupe_id, uid)
    except Exception as exc:
        logger.exception("Could not reserve the document status notification")
        raise HTTPException(status_code=503, detail="Document notification delivery is temporarily unavailable.") from exc
    if claim == "duplicate":
        return {"status": "duplicate"}

    document_label = str(
        record.get("customDocumentName")
        or record.get("documentType")
        or record.get("name")
        or record.get("label")
        or "Uploaded document"
    )
    scheme_label = record.get("schemeName") or record.get("applicationName")
    body_lines = [f"Document: {document_label}", f"Current status: {message_status}.", status_explanation]
    if scheme_label:
        body_lines.insert(1, f"Scheme/application: {scheme_label}")
    message = f"{document_label}: {message_status}"
    notice = {
        "userId": uid,
        "type": "document_status",
        "title": "Document status update",
        "message": message,
        "documentId": stored_document_id,
        "status": message_status,
        "read": False,
        "createdAt": datetime.now(timezone.utc),
    }
    send_email = claim == "send"
    try:
        if send_email:
            await asyncio.to_thread(
                _send_branded_email,
                account.email,
                f"BharatSathi AI document status: {message_status}",
                "Document status update",
                body_lines,
            )
            db.collection("_private_notification_sends").document(dedupe_id).update({
                "state": "email_sent",
                "sentAt": datetime.now(timezone.utc),
            })
        db.collection("notifications").document(dedupe_id).set(notice)
        db.collection("_private_notification_sends").document(dedupe_id).update({
            "state": "sent",
            "notificationId": dedupe_id,
            "sentAt": datetime.now(timezone.utc),
        })
    except Exception as exc:
        if send_email:
            try:
                ref = db.collection("_private_notification_sends").document(dedupe_id)
                state = (ref.get().to_dict() or {}).get("state")
                if state != "email_sent":
                    ref.delete()
            except Exception:
                logger.exception("Could not release a failed document notification reservation")
        logger.exception("Document status notification failed")
        raise HTTPException(status_code=502, detail="The document status notification could not be completed.") from exc
    return {"status": "sent", "notification_id": dedupe_id}


@app.post("/api/v1/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, authorization: str | None = Header(default=None)) -> ChatResponse:
    verify_optional_firebase_token(authorization)
    return await _gemini(request)
