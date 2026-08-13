"""Tests Phase 3 : compte & sécurité (vérification e-mail, réinitialisation de
mot de passe, 2FA TOTP, sessions), signalements et modération."""

import uuid

import pyotp
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from .models import EmailVerificationToken, Message, PasswordResetToken, Report, UserTOTP
from .tests import PASSWORD, BaseChatTest, make_user


def csrf_client():
    """Client avec jeton CSRF valide (les vues publiques d'écriture sont vérifiées)."""
    client = APIClient()
    client.get("/api/auth/csrf/")
    client.defaults["HTTP_X_CSRFTOKEN"] = client.cookies["csrftoken"].value
    return client


class EmailVerificationTests(BaseChatTest):
    def test_register_creates_verification_token(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {"username": "dan", "email": "dan@example.com", "password": PASSWORD, "password_confirm": PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.data["user"]["email_verified"])
        token = EmailVerificationToken.objects.get(user__username="dan")
        # L'utilisateur reçoit un lien de vérification (e-mail console en dev).
        self.assertIsNotNone(token.token)

    def test_verify_email_flow(self):
        dan = make_user("dan")
        token = EmailVerificationToken.objects.create(user=dan)
        client = csrf_client()
        ok = client.post("/api/auth/email/verify/", {"token": str(token.token)}, format="json")
        self.assertEqual(ok.status_code, 200)
        token.refresh_from_db()
        self.assertIsNotNone(token.used_at)
        # Un jeton déjà utilisé est refusé.
        again = client.post("/api/auth/email/verify/", {"token": str(token.token)}, format="json")
        self.assertEqual(again.status_code, 404)

    def test_resend_requires_auth_and_email(self):
        client = APIClient()
        self.assertEqual(client.post("/api/auth/email/resend/", {}, format="json").status_code, 403)
        dan = make_user("dan")
        dan.email = "dan@example.com"
        dan.save(update_fields=["email"])
        client.force_authenticate(dan)
        ok = client.post("/api/auth/email/resend/", {}, format="json")
        self.assertEqual(ok.status_code, 200)


class PasswordTests(BaseChatTest):
    def test_password_change(self):
        self.client.force_authenticate(self.alice)
        wrong = self.client.post(
            "/api/auth/password/change/",
            {"old_password": "nope", "new_password": "NewPass123!", "new_password_confirm": "NewPass123!"},
            format="json",
        )
        self.assertEqual(wrong.status_code, 400)
        ok = self.client.post(
            "/api/auth/password/change/",
            {"old_password": PASSWORD, "new_password": "NewPass123!", "new_password_confirm": "NewPass123!"},
            format="json",
        )
        self.assertEqual(ok.status_code, 200)
        self.alice.refresh_from_db()
        self.assertTrue(self.alice.check_password("NewPass123!"))

    def test_password_reset_request_and_confirm(self):
        self.bob.email = "bob@example.com"
        self.bob.save(update_fields=["email"])
        client = csrf_client()
        # La réponse est identique pour un e-mail inconnu (pas d'énumération).
        unknown = client.post("/api/auth/password/reset/request/", {"email": "ghost@example.com"}, format="json")
        self.assertEqual(unknown.status_code, 200)
        ok = client.post("/api/auth/password/reset/request/", {"email": "bob@example.com"}, format="json")
        self.assertEqual(ok.status_code, 200)
        token = PasswordResetToken.objects.get(user=self.bob, used_at__isnull=True)
        confirmed = client.post(
            "/api/auth/password/reset/confirm/",
            {"token": str(token.token), "password": "FreshPass123!", "password_confirm": "FreshPass123!"},
            format="json",
        )
        self.assertEqual(confirmed.status_code, 200)
        self.bob.refresh_from_db()
        self.assertTrue(self.bob.check_password("FreshPass123!"))
        # Le jeton est à usage unique.
        reused = client.post(
            "/api/auth/password/reset/confirm/",
            {"token": str(token.token), "password": "FreshPass123!", "password_confirm": "FreshPass123!"},
            format="json",
        )
        self.assertEqual(reused.status_code, 400)

    def test_expired_token_rejected(self):
        self.bob.email = "bob@example.com"
        self.bob.save(update_fields=["email"])
        token = PasswordResetToken.objects.create(
            user=self.bob, expires_at=timezone.now() - timezone.timedelta(minutes=1)
        )
        client = csrf_client()
        response = client.post(
            "/api/auth/password/reset/confirm/",
            {"token": str(token.token), "password": "FreshPass123!", "password_confirm": "FreshPass123!"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class TwoFactorTests(BaseChatTest):
    def test_2fa_setup_enable_and_login_flow(self):
        # Configuration
        self.client.force_authenticate(self.alice)
        setup = self.client.post("/api/auth/2fa/setup/", {}, format="json")
        self.assertEqual(setup.status_code, 200)
        secret = setup.data["secret"]
        code = pyotp.TOTP(secret).now()
        enabled = self.client.post("/api/auth/2fa/enable/", {"code": code}, format="json")
        self.assertEqual(enabled.status_code, 200)
        self.assertTrue(UserTOTP.objects.get(user=self.alice).is_enabled)
        self.client.force_authenticate(None)

        # Connexion : mot de passe puis code TOTP
        client = csrf_client()
        first = client.post("/api/auth/login/", {"username": "alice", "password": PASSWORD}, format="json")
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.data["requires_2fa"])
        pending = first.data["token"]

        wrong = client.post("/api/auth/login/2fa/", {"token": pending, "code": "000000"}, format="json")
        self.assertEqual(wrong.status_code, 400)

        second = client.post("/api/auth/login/", {"username": "alice", "password": PASSWORD}, format="json")
        code = pyotp.TOTP(secret).now()
        ok = client.post("/api/auth/login/2fa/", {"token": second.data["token"], "code": code}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertIn("user", ok.data)

    def test_2fa_disable_requires_password(self):
        self.client.force_authenticate(self.alice)
        secret = pyotp.random_base32()
        UserTOTP.objects.create(user=self.alice, secret=secret, is_enabled=True)
        refused = self.client.post("/api/auth/2fa/disable/", {"password": "wrong"}, format="json")
        self.assertEqual(refused.status_code, 400)
        ok = self.client.post("/api/auth/2fa/disable/", {"password": PASSWORD}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertFalse(UserTOTP.objects.get(user=self.alice).is_enabled)


class SessionTests(BaseChatTest):
    def test_sessions_list_and_revoke(self):
        # Connexion réelle via l'API : une session Django est créée en base.
        client = csrf_client()
        client.post("/api/auth/login/", {"username": "alice", "password": PASSWORD}, format="json")

        listed = client.get("/api/auth/sessions/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.data["sessions"]), 1)
        self.assertTrue(listed.data["sessions"][0]["is_current"])
        current_key = listed.data["sessions"][0]["session_key"]

        # La session courante ne peut pas être révoquée via l'API.
        refused = client.post("/api/auth/sessions/revoke/", {"session_key": current_key}, format="json")
        self.assertEqual(refused.status_code, 400)

        # Une session qui n'appartient pas à l'utilisateur est inaccessible.
        other = csrf_client()
        other.post("/api/auth/login/", {"username": "bob", "password": PASSWORD}, format="json")
        other_client = APIClient()
        other_client.force_authenticate(self.alice)
        bob_session = other.cookies["sessionid"].value
        forbidden = other_client.post("/api/auth/sessions/revoke/", {"session_key": bob_session}, format="json")
        self.assertEqual(forbidden.status_code, 404)


class ReportTests(BaseChatTest):
    def test_report_user_and_message(self):
        self.client.force_authenticate(self.alice)
        self_report = self.client.post(
            "/api/reports/", {"kind": "user", "user_id": self.alice.pk, "reason": "spam"}, format="json"
        )
        self.assertEqual(self_report.status_code, 400)
        ok = self.client.post(
            "/api/reports/", {"kind": "user", "user_id": self.eve.pk, "reason": "contenu abusif"}, format="json"
        )
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(Report.objects.count(), 1)

        message = Message.objects.create(room=self.room, sender=self.bob, content="à signaler")
        own = self.client.post(
            "/api/reports/", {"kind": "message", "message_id": message.pk, "reason": "spam"}, format="json"
        )
        # Bob est l'auteur : alice peut signaler ce message.
        self.assertEqual(own.status_code, 201)

        mine = self.client.get("/api/reports/mine/")
        self.assertEqual(len(mine.data), 2)

    def test_report_message_by_author_rejected(self):
        message = Message.objects.create(room=self.room, sender=self.alice, content="mien")
        self.client.force_authenticate(self.alice)
        refused = self.client.post(
            "/api/reports/", {"kind": "message", "message_id": message.pk, "reason": "spam"}, format="json"
        )
        self.assertEqual(refused.status_code, 400)


class Phase3ThrottleTests(BaseChatTest):
    def test_password_reset_rate_limit(self):
        cache.clear()
        client = csrf_client()
        for _ in range(5):
            client.post("/api/auth/password/reset/request/", {"email": "x@example.com"}, format="json")
        throttled = client.post("/api/auth/password/reset/request/", {"email": "x@example.com"}, format="json")
        self.assertEqual(throttled.status_code, 429)

    def test_2fa_rate_limit(self):
        cache.clear()
        client = csrf_client()
        for _ in range(5):
            client.post("/api/auth/login/2fa/", {"token": str(uuid.uuid4()), "code": "000000"}, format="json")
        throttled = client.post("/api/auth/login/2fa/", {"token": str(uuid.uuid4()), "code": "000000"}, format="json")
        self.assertEqual(throttled.status_code, 429)
