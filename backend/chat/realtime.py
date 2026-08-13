"""Utilitaires d'envoi d'événements temps réel (WebSockets) depuis les vues.

Les consommateurs Channels publient les événements côté socket ; les vues
REST appellent ces helpers pour diffuser instantanément les changements
(messages, réactions, notifications…) à tous les participants d'un salon
ou à un utilisateur précis.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def send_to_room_group(room_id, event_type: str, payload: dict | None = None):
    """Diffuse un événement à tous les clients connectés au salon `room_id`."""
    try:
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"room_{room_id}",
            {"type": "room.event", "event": event_type, "payload": payload or {}},
        )
    except Exception:  # la diffusion ne doit jamais casser la requête HTTP
        logger.exception("Échec de diffusion vers le salon %s", room_id)


def send_to_user(user_id, event_type: str, payload: dict | None = None):
    """Envoie un événement personnel (notification, compteur non-lu…) à un utilisateur."""
    try:
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"user_{user_id}",
            {"type": "user.event", "event": event_type, "payload": payload or {}},
        )
    except Exception:
        logger.exception("Échec d'envoi à l'utilisateur %s", user_id)


def send_presence_to_users(user_ids, online: bool, user_payload: dict | None = None):
    """Prévient les amis/membres qu'un utilisateur vient de se connecter ou de se déconnecter."""
    payload = {"online": online, **(user_payload or {})}
    for user_id in user_ids:
        send_to_user(user_id, "presence.changed", payload)
