"""Limitation de débit (rate limiting) pour l'API ShadowChat.

Les classes de base identifient les clients anonymes via `X-Forwarded-For`
quand l'application est derrière un reverse proxy (Nginx, Traefik…), afin que
les limites restent efficaces en production. Les cadences par usage sont
définies comme attributs de classe : elles sont figées, testables et ne
dépendent pas de la configuration des vues.
"""

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class XForwardedForMixin:
    """Identifie le client via `X-Forwarded-For` (premier hop fiable) sinon REMOTE_ADDR."""

    def get_ident(self, request):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return super().get_ident(request)


class XForwardedForAnonRateThrottle(XForwardedForMixin, AnonRateThrottle):
    """Cadence globale des utilisateurs anonymes (cadence `anon`)."""


class XForwardedForUserRateThrottle(XForwardedForMixin, UserRateThrottle):
    """Cadence globale des utilisateurs authentifiés (cadence `user`)."""


class LoginRateThrottle(XForwardedForAnonRateThrottle):
    """Connexion : 10 tentatives par minute et par IP."""

    rate = "10/min"


class RegisterRateThrottle(XForwardedForAnonRateThrottle):
    """Inscription : 5 comptes par minute et par IP."""

    rate = "5/min"


class MessageSendRateThrottle(XForwardedForUserRateThrottle):
    """Envoi/modification de messages : 30 opérations par minute et par utilisateur."""

    rate = "30/min"


class SearchRateThrottle(XForwardedForUserRateThrottle):
    """Recherches (messages, amis) : 30 requêtes par minute et par utilisateur."""

    rate = "30/min"


class FriendRequestRateThrottle(XForwardedForUserRateThrottle):
    """Demandes d'amis : 10 par minute et par utilisateur."""

    rate = "10/min"


class PasswordResetRateThrottle(XForwardedForAnonRateThrottle):
    """Demandes de réinitialisation de mot de passe : 5 par minute et par IP."""

    rate = "5/min"


class TwoFactorRateThrottle(XForwardedForAnonRateThrottle):
    """Vérification du code 2FA : 5 tentatives par minute et par IP."""

    rate = "5/min"


class ReportRateThrottle(XForwardedForUserRateThrottle):
    """Signalements : 5 par minute et par utilisateur."""

    rate = "5/min"
