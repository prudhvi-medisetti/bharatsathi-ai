import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import app as backend_app


class RecoverySecurityTests(unittest.TestCase):
    def test_recovery_hash_is_bound_to_salt_uid_and_pepper(self):
        code = "A" * 43
        first = backend_app._recovery_code_hash("uid-1", code, "11" * 16, "pepper-a", 100000)

        self.assertEqual(len(first), 64)
        self.assertNotEqual(first, backend_app._recovery_code_hash("uid-1", code, "22" * 16, "pepper-a", 100000))
        self.assertNotEqual(first, backend_app._recovery_code_hash("uid-2", code, "11" * 16, "pepper-a", 100000))
        self.assertNotEqual(first, backend_app._recovery_code_hash("uid-1", code, "11" * 16, "pepper-b", 100000))

    def test_production_public_url_rejects_localhost(self):
        with patch.dict("os.environ", {"APP_ENV": "production", "PUBLIC_APP_URL": "http://localhost:5173"}):
            with self.assertRaises(ValueError):
                backend_app._public_app_base_url()

    def test_production_public_url_accepts_configured_https_origin(self):
        with patch.dict("os.environ", {
            "APP_ENV": "production",
            "PUBLIC_APP_URL": "https://bharatsathi-ai-1aed0.web.app/",
        }):
            self.assertEqual(backend_app._public_app_base_url(), "https://bharatsathi-ai-1aed0.web.app")

    def test_new_email_confirmation_rejects_unconfirmed_standard_flow(self):
        reference = Mock()
        db = Mock()
        record = {
            "uid": "user-1",
            "oldEmail": "old@example.com",
            "newEmail": "new@example.com",
            "oldEmailVerified": False,
            "changeType": "standard",
        }
        with (
            patch.object(backend_app, "_require_smtp_configuration"),
            patch.object(backend_app, "_email_change_policy", return_value=(1800, 60, 5, 5, 300)),
            patch.object(backend_app, "_firestore_client", return_value=db),
            patch.object(backend_app, "_email_change_ref_for_token", return_value=reference),
            patch.object(backend_app, "_claim_new_email_confirmation", return_value=("confirmed", record)),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(backend_app.confirm_new_email_change(
                    backend_app.EmailChangeTokenRequest(token="test-confirmation-token-123"),
                ))

        self.assertEqual(raised.exception.status_code, 409)
        reference.update.assert_called_once()

    def test_recovery_confirmation_requires_reserved_code(self):
        reference = Mock()
        reference.id = "email-change-request"
        recovery_ref = Mock()
        recovery_ref.id = "recovery-record"
        recovery_snapshot = Mock()
        recovery_snapshot.exists = True
        recovery_snapshot.to_dict.return_value = {
            "state": "reserved",
            "reservedBy": "different-request",
            "expiresAt": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        recovery_ref.get.return_value = recovery_snapshot
        db = Mock()
        record = {
            "uid": "user-1",
            "oldEmail": "old@example.com",
            "newEmail": "new@example.com",
            "oldEmailVerified": True,
            "changeType": "recovery",
            "recoveryCodeRefId": "recovery-record",
        }
        with (
            patch.object(backend_app, "_require_smtp_configuration"),
            patch.object(backend_app, "_email_change_policy", return_value=(1800, 60, 5, 5, 300)),
            patch.object(backend_app, "_firestore_client", return_value=db),
            patch.object(backend_app, "_email_change_ref_for_token", return_value=reference),
            patch.object(backend_app, "_claim_new_email_confirmation", return_value=("confirmed", record)),
            patch.object(backend_app, "_recovery_code_ref", return_value=recovery_ref),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(backend_app.confirm_new_email_change(
                    backend_app.EmailChangeTokenRequest(token="test-confirmation-token-123"),
                ))

        self.assertEqual(raised.exception.status_code, 409)
        reference.update.assert_called_once()

    def test_completed_recovery_updates_auth_and_invalidates_code(self):
        reference = Mock()
        reference.id = "email-change-request"
        recovery_ref = Mock()
        recovery_ref.id = "recovery-record"
        recovery_snapshot = Mock()
        recovery_snapshot.exists = True
        recovery_snapshot.to_dict.return_value = {
            "state": "reserved",
            "reservedBy": "email-change-request",
            "expiresAt": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        recovery_ref.get.return_value = recovery_snapshot
        account = Mock(email="old@example.com", email_verified=True)
        batch = Mock()
        db = Mock()
        db.batch.return_value = batch
        record = {
            "uid": "user-1",
            "oldEmail": "old@example.com",
            "newEmail": "new@example.com",
            "oldEmailVerified": True,
            "changeType": "recovery",
            "recoveryCodeRefId": "recovery-record",
        }
        with (
            patch.object(backend_app, "_require_smtp_configuration"),
            patch.object(backend_app, "_email_change_policy", return_value=(1800, 60, 5, 5, 300)),
            patch.object(backend_app, "_firestore_client", return_value=db),
            patch.object(backend_app, "_email_change_ref_for_token", return_value=reference),
            patch.object(backend_app, "_claim_new_email_confirmation", return_value=("confirmed", record)),
            patch.object(backend_app, "_recovery_code_ref", return_value=recovery_ref),
            patch.object(backend_app, "_smtp_is_configured", return_value=True),
            patch.object(backend_app, "_send_branded_email") as send_email,
            patch("firebase_admin.auth.get_user", return_value=account),
            patch("firebase_admin.auth.update_user") as update_user,
        ):
            result = asyncio.run(backend_app.confirm_new_email_change(
                backend_app.EmailChangeTokenRequest(token="test-confirmation-token-123"),
            ))

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["notification_status"], "sent")
        update_user.assert_called_once_with("user-1", email="new@example.com", email_verified=True)
        self.assertEqual(
            {call.args[0] for call in send_email.call_args_list},
            {"old@example.com", "new@example.com"},
        )
        batch.update.assert_any_call(recovery_ref, unittest.mock.ANY)
        recovery_update = next(
            call.args[1] for call in batch.update.call_args_list if call.args[0] is recovery_ref
        )
        self.assertEqual(recovery_update["state"], "used")
        self.assertIsNone(recovery_update["codeHash"])
        batch.commit.assert_called_once()


    def test_document_upload_endpoint_rejects_missing_authentication(self):
        client = TestClient(backend_app.app)
        with patch.object(backend_app, "_firebase_config_missing", return_value=[]):
            response = client.post("/api/v1/documents/document-1/notify-upload")

        self.assertEqual(response.status_code, 401)

    def test_owned_personal_document_without_application_is_accepted(self):
        document_ref = Mock(id="document-1")
        snapshot = Mock()
        snapshot.exists = True
        snapshot.reference = document_ref
        snapshot.to_dict.return_value = {
            "userId": "user-1",
            "documentId": "document-1",
            "fileName": "proof.pdf",
            "storagePath": "users/user-1/documents/document-1/proof.pdf",
        }
        documents = Mock()
        documents.document.return_value = document_ref
        document_ref.get.return_value = snapshot
        db = Mock()
        db.collection.return_value = documents

        reference, record, document_id, path = backend_app._load_owned_document(db, "document-1", "user-1")

        self.assertIs(reference, document_ref)
        self.assertEqual(record["userId"], "user-1")
        self.assertEqual(document_id, "document-1")
        self.assertEqual(path, "users/user-1/documents/document-1/proof.pdf")
        db.collection.assert_called_once_with("documents")

    def test_personal_document_optional_application_must_be_owned(self):
        document_ref = Mock(id="document-1")
        document_snapshot = Mock()
        document_snapshot.exists = True
        document_snapshot.reference = document_ref
        document_snapshot.to_dict.return_value = {
            "userId": "user-1",
            "documentId": "document-1",
            "fileName": "proof.pdf",
            "storagePath": "users/user-1/documents/document-1/proof.pdf",
            "applicationId": "application-1",
            "schemeId": "scheme-1",
            "schemeName": "Scheme One",
        }
        application_snapshot = Mock()
        application_snapshot.exists = True
        application_snapshot.to_dict.return_value = {
            "userId": "user-1",
            "schemeId": "scheme-1",
        }
        document_collection = Mock()
        document_collection.document.return_value = document_ref
        document_ref.get.return_value = document_snapshot
        application_collection = Mock()
        application_collection.document.return_value.get.return_value = application_snapshot
        db = Mock()
        db.collection.side_effect = lambda name: {
            "documents": document_collection,
            "applications": application_collection,
        }[name]

        result = backend_app._load_owned_document(db, "document-1", "user-1")

        self.assertEqual(result[3], "users/user-1/documents/document-1/proof.pdf")
        application_collection.document.assert_called_once_with("application-1")

        application_snapshot.to_dict.return_value = {
            "userId": "another-user",
            "schemeId": "scheme-1",
        }
        with self.assertRaises(HTTPException) as raised:
            backend_app._load_owned_document(db, "document-1", "user-1")
        self.assertEqual(raised.exception.status_code, 403)

    def test_personal_document_rejects_foreign_owner_and_invalid_storage_path(self):
        document_ref = Mock(id="document-1")
        snapshot = Mock()
        snapshot.exists = True
        snapshot.reference = document_ref
        documents = Mock()
        documents.document.return_value = document_ref
        document_ref.get.return_value = snapshot
        db = Mock()
        db.collection.return_value = documents

        snapshot.to_dict.return_value = {
            "userId": "another-user",
            "documentId": "document-1",
            "fileName": "proof.pdf",
            "storagePath": "users/user-1/documents/document-1/proof.pdf",
        }
        with self.assertRaises(HTTPException) as foreign_owner:
            backend_app._load_owned_document(db, "document-1", "user-1")
        self.assertEqual(foreign_owner.exception.status_code, 403)

        snapshot.to_dict.return_value = {
            "userId": "user-1",
            "documentId": "document-1",
            "fileName": "proof.pdf",
            "storagePath": "users/another-user/documents/document-1/proof.pdf",
        }
        with self.assertRaises(HTTPException) as invalid_path:
            backend_app._load_owned_document(db, "document-1", "user-1")
        self.assertEqual(invalid_path.exception.status_code, 409)


class AccountDataDeletionTests(unittest.TestCase):
    def test_purge_removes_owned_records_user_tree_and_storage_prefix(self):
        db = Mock()
        bucket = Mock()
        blob = Mock()
        bucket.list_blobs.return_value = [blob]
        collections = {}

        def get_collection(name):
            if name not in collections:
                collection = Mock()
                collection.where.return_value.stream.return_value = []
                collection.document.side_effect = lambda document_id: Mock(path=f"{name}/{document_id}")
                collections[name] = collection
            return collections[name]

        db.collection.side_effect = get_collection
        document_reference = Mock(path="documents/document-1")
        document_record = Mock(id="document-1", reference=document_reference)
        document_record.to_dict.return_value = {"documentId": "document-1"}
        get_collection("documents").where.return_value.stream.return_value = [document_record]
        batch = Mock()
        db.batch.return_value = batch

        backend_app._purge_account_data(db, bucket, "user-1")

        bucket.list_blobs.assert_called_once_with(prefix="users/user-1/")
        blob.delete.assert_called_once_with()
        db.recursive_delete.assert_called_once()
        deleted_references = [call.args[0] for call in batch.delete.call_args_list]
        self.assertIn(document_reference, deleted_references)
        self.assertEqual(len(deleted_references), len({reference.path for reference in deleted_references}))
        batch.commit.assert_called_once_with()

    def test_delete_endpoint_uses_verified_uid_and_requires_recent_auth(self):
        claims = {"uid": "verified-user", "auth_time": 1}
        db = Mock()
        bucket = Mock()
        with (
            patch.object(backend_app, "require_firebase_token", return_value=claims),
            patch.object(backend_app, "_require_recent_auth") as recent_auth,
            patch.object(backend_app, "_require_storage_configuration", return_value="test-bucket"),
            patch.object(backend_app, "_firestore_client", return_value=db),
            patch("firebase_admin.storage.bucket", return_value=bucket),
            patch.object(backend_app, "_purge_account_data") as purge,
        ):
            result = asyncio.run(backend_app.delete_account_data("Bearer test-token"))

        self.assertEqual(result, {"status": "deleted"})
        recent_auth.assert_called_once_with(claims, 300, "deleting your account")
        purge.assert_called_once_with(db, bucket, "verified-user")


if __name__ == "__main__":
    unittest.main()
