"""Envoi des e-mails transactionnels ShadowChat.

En développement, Django utilise le backend console (les liens s'affichent
dans les journaux du serveur). En production, configurer les variables
`EMAIL_*` (SMTP) et `PUBLIC_SITE_URL` (voir `.env.example`).
"""

import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)

SITE_URL = settings.PUBLIC_SITE_URL or "http://localhost:5173"


def send_verification_email(user, token):
    link = f"{SITE_URL}/verifier-email/{token}"
    subject = "ShadowChat — Vérifiez votre adresse e-mail"
    message = (
        f"Bonjour {user.username},\n\n"
        "Pour vérifier votre adresse e-mail sur ShadowChat, ouvrez ce lien :\n\n"
        f"{link}\n\n"
        "Si vous n'avez pas créé de compte, ignorez ce message.\n"
    )
    try:
        send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [user.email])
        logger.info("E-mail de vérification envoyé à %s", user.email)
    except Exception:
        logger.exception("Échec de l'envoi de l'e-mail de vérification à %s", user.email)


def send_password_reset_email(user, token):
    link = f"{SITE_URL}/reinitialiser/{token}"
    subject = "ShadowChat — Réinitialisation de votre mot de passe"
    message = (
        f"Bonjour {user.username},\n\n"
        "Vous avez demandé la réinitialisation de votre mot de passe. "
        "Ouvrez ce lien (valable 15 minutes) :\n\n"
        f"{link}\n\n"
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n"
    )
    try:
        send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [user.email])
        logger.info("E-mail de réinitialisation envoyé à %s", user.email)
    except Exception:
        logger.exception("Échec de l'envoi de l'e-mail de réinitialisation à %s", user.email)
