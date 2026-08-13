"""Services métier partagés entre les vues REST et les consommateurs WebSocket."""

import logging
import re

from .models import ActivityLog, Notification, Room
from .realtime import send_to_room_group, send_to_user

logger = logging.getLogger(__name__)

MENTION_PATTERN = re.compile(r"@([\w.@+-]{1,150})")


def log_activity(room, user, action, details: dict | None = None):
    """Enregistre une entrée dans le journal d'activité du salon."""
    entry = ActivityLog.objects.create(room=room, user=user, action=action, details=details or {})
    send_to_room_group(
        room.id,
        "activity.created",
        {
            "room_id": room.id,
            "id": entry.id,
            "action": entry.action,
            "action_display": entry.get_action_display(),
            "username": user.username if user else None,
            "user_id": user.id if user else None,
            "details": entry.details,
            "created_at": entry.created_at.isoformat(),
        },
    )
    return entry


def create_notification(recipient, type_, actor=None, room=None, message=None, data: dict | None = None):
    """Crée une notification persistante et la pousse en temps réel."""
    notification = Notification.objects.create(
        recipient=recipient, type=type_, actor=actor, room=room, message=message, data=data or {}
    )
    from .serializers import NotificationSerializer

    payload = NotificationSerializer(notification).data
    send_to_user(recipient.id, "notification.created", payload)
    return notification


def notify_mentions(message, sender, request):
    """Détecte les @mentions dans le contenu et notifie les membres concernés."""
    content = message.content or ""
    mentioned_names = {match.group(1) for match in MENTION_PATTERN.finditer(content)}
    if not mentioned_names:
        return
    participants = message.room.participants.filter(username__in=mentioned_names).exclude(pk=sender.pk)
    for user in participants:
        create_notification(
            user,
            Notification.Type.MENTION,
            actor=sender,
            room=message.room,
            message=message,
            data={"content_preview": content[:120]},
        )
        send_to_user(user.id, "message.mention", {"room_id": message.room.id, "message_id": message.id})


def broadcast_message_created(message, request):
    """Diffuse un nouveau message au salon et met à jour les compteurs de non-lus."""
    from .serializers import MessageSerializer

    payload = MessageSerializer(message, context={"request": request}).data
    send_to_room_group(message.room_id, "message.created", payload)
    # Chaque autre membre incrémente son compteur de non-lus local.
    for user_id in message.room.memberships.exclude(user_id=message.sender_id).values_list("user_id", flat=True):
        send_to_user(
            user_id,
            "room.unread_changed",
            {"room_id": message.room_id, "sender_id": message.sender_id, "message_id": message.id},
        )


def broadcast_message_updated(message, request, event="message.edited"):
    """Diffuse une modification (édition, suppression, épinglage…) d'un message."""
    from .serializers import MessageSerializer

    payload = MessageSerializer(message, context={"request": request}).data
    send_to_room_group(message.room_id, event, payload)


def broadcast_room_updated(room, request):
    """Diffuse l'état actualisé d'un salon à ses membres."""
    from .serializers import RoomSerializer

    payload = RoomSerializer(room, context={"request": request}).data
    send_to_room_group(room.id, "room.updated", payload)


def touch_room(room):
    """Actualise la date de dernière activité du salon (utilisée pour trier la liste)."""
    from django.utils import timezone

    Room.objects.filter(pk=room.pk).update(updated_at=timezone.now())
