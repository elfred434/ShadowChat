"""Consommateurs WebSocket de ShadowChat.

- `RoomConsumer` (`/ws/rooms/<id>/`) : messages, frappe, accusés de lecture
  d'un salon précis.
- `UserConsumer` (`/ws/user/`) : événements personnels (notifications,
  présence des contacts, compteurs de non-lus, invitations).

Les diffusions provenant des vues REST passent par `chat.realtime` ; ces
consommateurs publient aussi leurs propres événements (frappe, présence…).
"""

import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

PRESENCE_KEY = "shadowchat:presence:{user_id}"


def origin_is_allowed(scope) -> bool:
    """Protection anti-hijacking : l'origine doit correspondre à l'hôte ou à une origine autorisée."""
    headers = {key.decode("latin-1"): value.decode("latin-1") for key, value in scope.get("headers", [])}
    origin = headers.get("origin")
    if not origin:
        return True  # clients non-navigateur (tests, natif)
    host = headers.get("host", "")
    allowed = set(settings.CORS_ALLOWED_ORIGINS) | set(settings.CSRF_TRUSTED_ORIGINS)
    try:
        from urllib.parse import urlparse

        origin_host = urlparse(origin).netloc
    except ValueError:
        return False
    return origin_host == host or origin in allowed


@database_sync_to_async
def get_presence_audience(user):
    """Identifiants des utilisateurs à prévenir d'un changement de présence :
    les amis acceptés et les membres partageant un salon."""
    from django.db.models import Q

    from .models import Friendships

    pairs = Friendships.objects.filter(
        Q(sender=user, status="accepted") | Q(receiver=user, status="accepted")
    ).values_list("sender_id", "receiver_id")
    friend_ids = {person_id for pair in pairs for person_id in pair if person_id != user.id}
    roommate_ids = set(
        user.room_memberships.exclude(is_banned=True).values_list("room__memberships__user_id", flat=True)
    )
    audience = friend_ids | roommate_ids
    audience.discard(user.id)
    return list(audience)


@database_sync_to_async
def update_last_seen(user):
    from .models import UserStatus

    status_object, _ = UserStatus.objects.get_or_create(user=user)
    status_object.last_seen = timezone.now()
    status_object.save(update_fields=["last_seen"])


@database_sync_to_async
def get_room_membership(room_id, user):
    from .models import RoomMembership

    return RoomMembership.objects.filter(room_id=room_id, user=user).first()


class BaseChatConsumer(AsyncJsonWebsocketConsumer):
    """Authentification par session + validation d'origine, partagées par les deux consommateurs.

    `connect()` ne valide que les prérequis et n'accepte pas la connexion :
    chaque sous-classe fait ses propres contrôles (appartenance au salon…)
    avant d'appeler `accept()`, pour pouvoir refuser proprement le handshake.
    """

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4401)
            return False
        if not origin_is_allowed(self.scope):
            await self.close(code=4403)
            return False
        await update_last_seen(user)
        return True


class RoomConsumer(BaseChatConsumer):
    """Socket d'un salon : frappe, lecture, accusés de lecture et événements de diffusion."""

    async def connect(self):
        if not await super().connect():
            return
        user = self.scope["user"]
        self.room_id = int(self.scope["url_route"]["kwargs"]["room_id"])
        self.room_group_name = f"room_{self.room_id}"
        membership = await get_room_membership(self.room_id, user)
        if membership is None or membership.is_banned:
            await self.close(code=4403)
            return
        await self.accept()
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)

    async def disconnect(self, code):
        if hasattr(self, "room_group_name"):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
            # Ne pas laisser un indicateur « en train d'écrire » orphelin
            # (diffusion au salon + état persistant en base).
            await self.broadcast_typing(False)
            await database_sync_to_async(self._clear_typing)()

    def _clear_typing(self):
        from .models import UserStatus

        UserStatus.objects.filter(user=self.scope["user"], typing_in_id=self.room_id).update(typing_in=None)

    async def receive_json(self, content, **kwargs):
        event = content.get("event")
        payload = content.get("payload") or {}
        if event == "typing.start":
            await self.set_typing(payload.get("room_id"), True)
        elif event == "typing.stop":
            await self.set_typing(payload.get("room_id"), False)
        elif event == "mark.read":
            await self.mark_room_read(payload.get("room_id"))
        elif event == "messages.read":
            await self.register_read_receipts(payload.get("message_ids") or [])
        elif event == "ping":
            await self.send_json({"event": "pong", "payload": {"ts": timezone.now().isoformat()}})

    async def set_typing(self, room_id, is_typing):
        await database_sync_to_async(self._set_typing)(room_id, is_typing)
        await self.broadcast_typing(is_typing)

    def _set_typing(self, room_id, is_typing):
        from .models import Room, UserStatus

        status_object, _ = UserStatus.objects.get_or_create(user=self.scope["user"])
        if is_typing:
            room = Room.objects.filter(
                pk=room_id, memberships__user=self.scope["user"], memberships__is_banned=False
            ).first()
            status_object.typing_in = room
        else:
            status_object.typing_in = None
        status_object.last_seen = timezone.now()
        status_object.save(update_fields=["typing_in", "last_seen"])

    async def broadcast_typing(self, is_typing):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "room.event",
                "event": "typing.changed",
                "payload": {"room_id": self.room_id, "user_id": self.scope["user"].id, "is_typing": is_typing},
            },
        )

    def _mark_room_read(self, room_id):
        from .models import RoomVisit

        RoomVisit.objects.update_or_create(
            user=self.scope["user"], room_id=room_id, defaults={"last_visited": timezone.now()}
        )

    async def mark_room_read(self, room_id):
        if room_id != self.room_id:
            return
        await database_sync_to_async(self._mark_room_read)(room_id)

    def _register_receipts(self, message_ids):
        from .models import Message, MessageReadReceipt

        if not message_ids:
            return
        messages = list(
            Message.objects.filter(pk__in=message_ids, room_id=self.room_id).exclude(sender=self.scope["user"])
        )
        MessageReadReceipt.objects.bulk_create(
            [MessageReadReceipt(message=m, user=self.scope["user"]) for m in messages],
            ignore_conflicts=True,
        )

    async def register_read_receipts(self, message_ids):
        await database_sync_to_async(self._register_receipts)(message_ids)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "room.event",
                "event": "receipts.updated",
                "payload": {"room_id": self.room_id, "user_id": self.scope["user"].id, "message_ids": message_ids},
            },
        )

    async def room_event(self, event):
        """Relais d'un événement diffusé via group_send (vues REST)."""
        await self.send_json({"event": event["event"], "payload": event.get("payload") or {}})


class UserConsumer(BaseChatConsumer):
    """Socket personnel : notifications, présence, invitations, compteurs de non-lus."""

    def _presence_key(self):
        return PRESENCE_KEY.format(user_id=self.scope["user"].id)

    def _presence_increment(self):
        key = self._presence_key()
        try:
            value = cache.incr(key, 1)
        except ValueError:  # clé absente (certains backends)
            value = None
        if value is None:
            cache.set(key, 1)
            value = 1
        return value

    def _presence_decrement(self):
        key = self._presence_key()
        try:
            value = cache.decr(key, 1)
        except ValueError:
            value = 0
        if value is None or value <= 0:
            cache.delete(key)
            return 0
        return value

    async def connect(self):
        if not await super().connect():
            return
        user = self.scope["user"]
        self.user_group_name = f"user_{user.id}"
        await self.accept()
        await self.channel_layer.group_add(self.user_group_name, self.channel_name)
        if self._presence_increment() == 1:
            await self.broadcast_presence(True)

    async def disconnect(self, code):
        if not hasattr(self, "user_group_name"):
            return
        await self.channel_layer.group_discard(self.user_group_name, self.channel_name)
        if self._presence_decrement() == 0:
            await self.broadcast_presence(False)

    async def broadcast_presence(self, online):
        audience = await get_presence_audience(self.scope["user"])
        for user_id in audience:
            await self.channel_layer.group_send(
                f"user_{user_id}",
                {
                    "type": "user.event",
                    "event": "presence.changed",
                    "payload": {
                        "user_id": self.scope["user"].id,
                        "username": self.scope["user"].username,
                        "online": online,
                    },
                },
            )

    async def receive_json(self, content, **kwargs):
        event = content.get("event")
        if event == "ping":
            await update_last_seen(self.scope["user"])
            await self.send_json({"event": "pong", "payload": {"ts": timezone.now().isoformat()}})

    async def user_event(self, event):
        """Relais d'un événement personnel diffusé via group_send (vues REST)."""
        await self.send_json({"event": event["event"], "payload": event.get("payload") or {}})
