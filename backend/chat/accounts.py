"""Vues « compte & sécurité » : vérification e-mail, réinitialisation de mot de
passe, changement de mot de passe, authentification à deux facteurs (TOTP),
gestion des sessions actives et signalements (modération).
"""

import logging
import uuid

import pyotp
from django.contrib.auth import login
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.core.exceptions import SuspiciousOperation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.signing import BadSignature
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .emails import send_password_reset_email, send_verification_email
from .models import EmailVerificationToken, Message, PasswordResetToken, Report, UserTOTP
from .serializers import UserSerializer
from .throttling import PasswordResetRateThrottle, ReportRateThrottle, TwoFactorRateThrottle
from .views import csrf_api_view

logger = logging.getLogger(__name__)

PENDING_2FA_KEY = "shadowchat:2fa-pending:{token}"
PENDING_2FA_TTL = 300  # secondes


def error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": message}, status=code)


# ---------------------------------------------------------------------------
# Vérification d'adresse e-mail
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def resend_verification_view(request):
    """Régénère le jeton de vérification et renvoie l'e-mail."""
    if not request.user.email:
        return error("Aucune adresse e-mail associée à ce compte.")
    verification, _ = EmailVerificationToken.objects.update_or_create(
        user=request.user, defaults={"token": uuid.uuid4(), "used_at": None}
    )
    send_verification_email(request.user, verification.token)
    return Response({"message": "E-mail de vérification envoyé."})


@csrf_api_view(["POST"])
@permission_classes([AllowAny])
def verify_email_view(request):
    token = str(request.data.get("token", "")).strip()
    try:
        verification = EmailVerificationToken.objects.get(token=uuid.UUID(token), used_at__isnull=True)
    except (ValueError, EmailVerificationToken.DoesNotExist):
        return error("Lien de vérification invalide ou déjà utilisé.", status.HTTP_404_NOT_FOUND)
    verification.used_at = timezone.now()
    verification.save(update_fields=["used_at"])
    return Response({"message": "Adresse e-mail vérifiée avec succès."})


# ---------------------------------------------------------------------------
# Réinitialisation et changement de mot de passe
# ---------------------------------------------------------------------------
@csrf_api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetRateThrottle])
def password_reset_request_view(request):
    email = str(request.data.get("email", "")).strip()
    if not email:
        return error("Adresse e-mail requise.")
    user = User.objects.filter(email__iexact=email, is_active=True).first()
    if user:
        # Un seul jeton actif à la fois : les anciens deviennent obsolètes.
        PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
        token = PasswordResetToken.objects.create(user=user, expires_at=timezone.now() + timezone.timedelta(minutes=15))
        send_password_reset_email(user, token.token)
    # Réponse identique que l'e-mail existe ou non (pas d'énumération d'utilisateurs).
    return Response({"message": "Si cette adresse est associée à un compte, un e-mail a été envoyé."})


@csrf_api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetRateThrottle])
def password_reset_confirm_view(request):
    raw_token = str(request.data.get("token", "")).strip()
    password = request.data.get("password", "")
    try:
        token = PasswordResetToken.objects.get(token=uuid.UUID(raw_token))
    except (ValueError, PasswordResetToken.DoesNotExist):
        return error("Lien de réinitialisation invalide.", status.HTTP_404_NOT_FOUND)
    if not token.is_valid:
        return error("Ce lien a expiré ou a déjà été utilisé.")
    if password != request.data.get("password_confirm"):
        return error("Les mots de passe ne correspondent pas.")
    try:
        validate_password(password, user=token.user)
    except DjangoValidationError as exc:
        return error(" ".join(exc.messages))
    token.user.set_password(password)
    token.user.save(update_fields=["password"])
    token.used_at = timezone.now()
    token.save(update_fields=["used_at"])
    # Le changement de mot de passe invalide toutes les autres sessions
    # (rotation du hash de session côté Django).
    return Response({"message": "Mot de passe réinitialisé. Vous pouvez vous connecter."})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def password_change_view(request):
    old_password = str(request.data.get("old_password", ""))
    new_password = str(request.data.get("new_password", ""))
    if not request.user.check_password(old_password):
        return error("Mot de passe actuel incorrect.")
    if new_password != request.data.get("new_password_confirm"):
        return error("Les mots de passe ne correspondent pas.")
    try:
        validate_password(new_password, user=request.user)
    except DjangoValidationError as exc:
        return error(" ".join(exc.messages))
    request.user.set_password(new_password)
    request.user.save(update_fields=["password"])
    # Conserver la session courante connectée après rotation du hash.
    login(request, request.user)
    return Response({"message": "Mot de passe modifié."})


# ---------------------------------------------------------------------------
# Authentification à deux facteurs (TOTP)
# ---------------------------------------------------------------------------
def pending_2fa_key(token):
    return PENDING_2FA_KEY.format(token=token)


@csrf_api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([TwoFactorRateThrottle])
def login_2fa_view(request):
    pending_token = str(request.data.get("token", "")).strip()
    code = str(request.data.get("code", "")).strip()
    user_id = cache.get(pending_2fa_key(pending_token))
    cache.delete(pending_2fa_key(pending_token))  # usage unique
    if not user_id:
        return error("Session de connexion expirée. Recommencez la connexion.", status.HTTP_400_BAD_REQUEST)
    user = User.objects.filter(pk=user_id, is_active=True).first()
    totp = UserTOTP.objects.filter(user=user, is_enabled=True).first() if user else None
    if not user or not totp or not pyotp.TOTP(totp.secret).verify(code, valid_window=1):
        return error("Code de vérification incorrect.")
    login(request, user)
    return Response({"message": "Connexion réussie !", "user": UserSerializer(user, context={"request": request}).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def totp_setup_view(request):
    """Démarre la configuration 2FA : renvoie le secret (à saisir dans l'application TOTP)."""
    totp, _ = UserTOTP.objects.get_or_create(user=request.user, defaults={"secret": pyotp.random_base32()})
    if totp.is_enabled:
        return error("La double authentification est déjà activée.")
    otpauth = pyotp.TOTP(totp.secret).provisioning_uri(name=request.user.username, issuer_name="ShadowChat")
    return Response({"secret": totp.secret, "otpauth_url": otpauth})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def totp_enable_view(request):
    code = str(request.data.get("code", "")).strip()
    totp = UserTOTP.objects.filter(user=request.user).first()
    if not totp:
        return error("Lancez d'abord la configuration 2FA.", status.HTTP_404_NOT_FOUND)
    if not pyotp.TOTP(totp.secret).verify(code, valid_window=1):
        return error("Code de vérification incorrect.")
    totp.is_enabled = True
    totp.enabled_at = timezone.now()
    totp.save(update_fields=["is_enabled", "enabled_at"])
    return Response({"message": "Double authentification activée."})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def totp_disable_view(request):
    password = str(request.data.get("password", ""))
    if not request.user.check_password(password):
        return error("Mot de passe incorrect.")
    UserTOTP.objects.filter(user=request.user).update(is_enabled=False)
    return Response({"message": "Double authentification désactivée."})


# ---------------------------------------------------------------------------
# Sessions actives
# ---------------------------------------------------------------------------
def iter_user_sessions(user):
    """Liste les sessions Django appartenant à l'utilisateur."""
    store = SessionStore()
    sessions = []
    for session in Session.objects.all().iterator():
        try:
            data = store.decode(session.session_data)
        except (BadSignature, SuspiciousOperation):
            continue
        if data.get("_auth_user_id") == str(user.pk):
            sessions.append(
                {
                    "session_key": session.session_key,
                    "expire_date": session.expire_date,
                }
            )
    return sessions


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def sessions_view(request):
    current_key = request.session.session_key
    sessions = []
    for session in iter_user_sessions(request.user):
        session["is_current"] = session["session_key"] == current_key
        sessions.append(session)
    return Response({"sessions": sessions})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def revoke_session_view(request):
    session_key = str(request.data.get("session_key", ""))
    owned = [s["session_key"] for s in iter_user_sessions(request.user)]
    if session_key not in owned:
        return error("Session introuvable.", status.HTTP_404_NOT_FOUND)
    if session_key == request.session.session_key:
        return error("Utilisez la déconnexion pour fermer la session courante.")
    Session.objects.filter(session_key=session_key).delete()
    return Response({"status": "revoked"})


# ---------------------------------------------------------------------------
# Signalements (modération)
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ReportRateThrottle])
def report_create_view(request):
    kind = request.data.get("kind")
    reason = str(request.data.get("reason", "")).strip()
    if kind not in {Report.Kind.USER, Report.Kind.MESSAGE}:
        return error("Type de signalement invalide (user ou message).")
    if not (1 <= len(reason) <= 500):
        return error("Décrivez le motif du signalement (500 caractères max).")
    target_user = target_message = None
    if kind == Report.Kind.USER:
        try:
            target_user = User.objects.get(pk=request.data.get("user_id"))
        except (User.DoesNotExist, TypeError, ValueError):
            return error("Utilisateur signalé introuvable.", status.HTTP_404_NOT_FOUND)
        if target_user == request.user:
            return error("Vous ne pouvez pas vous signaler vous-même.")
    else:
        try:
            target_message = Message.objects.get(pk=request.data.get("message_id"))
        except (Message.DoesNotExist, TypeError, ValueError):
            return error("Message signalé introuvable.", status.HTTP_404_NOT_FOUND)
        if target_message.sender == request.user:
            return error("Vous ne pouvez pas signaler votre propre message.")
        target_user = target_message.sender
    report = Report.objects.create(
        reporter=request.user,
        kind=kind,
        target_user=target_user,
        target_message=target_message,
        reason=reason,
    )
    logger.info("Signalement %s créé par %s", report.pk, request.user.username)
    return Response(
        {
            "id": report.id,
            "status": report.status,
            "message": "Merci, votre signalement a été transmis à la modération.",
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def report_list_view(request):
    reports = Report.objects.filter(reporter=request.user).select_related("target_user", "target_message")
    return Response(
        [
            {
                "id": report.id,
                "kind": report.kind,
                "reason": report.reason,
                "status": report.status,
                "target_username": report.target_user.username if report.target_user else None,
                "message_preview": (report.target_message.content[:80] if report.target_message else None),
                "created_at": report.created_at,
            }
            for report in reports[:50]
        ]
    )
