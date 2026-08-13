"""Tests de l'API ShadowChat : autorisations, fonctionnalités de messagerie,
rôles de groupe, notifications, limitation de débit et WebSockets."""

import asyncio
from datetime import timedelta
from io import BytesIO

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from .models import (
    ActivityLog,
    Friendships,
    Message,
    MessageReadReceipt,
    Notification,
    Room,
    RoomMembership,
)

PASSWORD = "CorrectHorse1!"


def make_user(username, password=PASSWORD):
    return User.objects.create_user(username=username, password=password)


def make_friends(u1, u2):
    return Friendships.objects.create(sender=u1, receiver=u2, status="accepted")


def make_dm(u1, u2, friends=True):
    if friends:
        make_friends(u1, u2)
    room = Room.objects.create(is_group=False)
    RoomMembership.objects.create(room=room, user=u1)
    RoomMembership.objects.create(room=room, user=u2)
    return room


class BaseChatTest(TestCase):
    def setUp(self):
        cache.clear()
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.eve = make_user("eve")
        self.mallory = make_user("mallory")
        self.room = make_dm(self.alice, self.bob)
        self.client = APIClient()


class ChatAuthorizationTests(BaseChatTest):
    def test_messages_are_not_visible_to_non_participants(self):
        message = Message.objects.create(room=self.room, sender=self.alice, content="secret for bob")
        self.client.force_authenticate(self.eve)
        response = self.client.get("/api/messages/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])
        response = self.client.get(f"/api/messages/{message.pk}/")
        self.assertEqual(response.status_code, 404)

    def test_non_participant_cannot_send_message_to_room(self):
        self.client.force_authenticate(self.eve)
        response = self.client.post("/api/messages/", {"room": self.room.pk, "content": "intrusion"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Message.objects.filter(room=self.room).count(), 0)

    def test_participant_can_send_message_and_empty_content_is_rejected(self):
        self.client.force_authenticate(self.bob)
        allowed = self.client.post("/api/messages/", {"room": self.room.pk, "content": "bonjour"}, format="json")
        self.assertEqual(allowed.status_code, 201)
        rejected = self.client.post("/api/messages/", {"room": self.room.pk, "content": "   "}, format="json")
        self.assertEqual(rejected.status_code, 400)

    def test_dm_requires_an_accepted_friendship(self):
        self.client.force_authenticate(self.alice)
        rejected = self.client.post("/api/rooms/get_or_create_dm/", {"user_id": self.eve.pk}, format="json")
        self.assertEqual(rejected.status_code, 403)
        Friendships.objects.create(sender=self.alice, receiver=self.eve, status="accepted")
        allowed = self.client.post("/api/rooms/get_or_create_dm/", {"user_id": self.eve.pk}, format="json")
        self.assertEqual(allowed.status_code, 201)
        duplicate = self.client.post("/api/rooms/get_or_create_dm/", {"user_id": self.eve.pk}, format="json")
        self.assertEqual(duplicate.status_code, 200)

    def test_only_receiver_can_accept_friendship(self):
        friendship = Friendships.objects.create(sender=self.alice, receiver=self.eve)
        self.client.force_authenticate(self.mallory)
        response = self.client.post(f"/api/friendships/{friendship.pk}/accept/")
        self.assertEqual(response.status_code, 404)
        self.client.force_authenticate(self.eve)
        response = self.client.post(f"/api/friendships/{friendship.pk}/accept/")
        self.assertEqual(response.status_code, 200)
        friendship.refresh_from_db()
        self.assertEqual(friendship.status, "accepted")


class CsrfTests(TestCase):
    def test_login_requires_and_accepts_csrf_token(self):
        cache.clear()
        client = APIClient(enforce_csrf_checks=True)
        missing_token = client.post("/api/auth/login/", {"username": "nobody", "password": "none"}, format="json")
        self.assertEqual(missing_token.status_code, 403)
        csrf_response = client.get("/api/auth/csrf/")
        self.assertEqual(csrf_response.status_code, 200)
        token = csrf_response.cookies["csrftoken"].value
        make_user("carol")
        response = client.post(
            "/api/auth/login/", {"username": "carol", "password": PASSWORD}, format="json", HTTP_X_CSRFTOKEN=token
        )
        self.assertEqual(response.status_code, 200)


class HealthTests(TestCase):
    def test_health_endpoint(self):
        response = self.client.get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ok")
        self.assertTrue(response.data["checks"]["database"])


class MessageFeatureTests(BaseChatTest):
    def test_edit_own_message(self):
        message = Message.objects.create(room=self.room, sender=self.alice, content="v1")
        self.client.force_authenticate(self.bob)
        forbidden = self.client.patch(f"/api/messages/{message.pk}/", {"content": "hack"}, format="json")
        self.assertEqual(forbidden.status_code, 403)
        self.client.force_authenticate(self.alice)
        ok = self.client.patch(f"/api/messages/{message.pk}/", {"content": "v2"}, format="json")
        self.assertEqual(ok.status_code, 200)
        message.refresh_from_db()
        self.assertEqual(message.content, "v2")
        self.assertIsNotNone(message.edited_at)

    def test_delete_own_message_is_soft_delete(self):
        message = Message.objects.create(room=self.room, sender=self.alice, content="à supprimer")
        self.client.force_authenticate(self.bob)
        forbidden = self.client.delete(f"/api/messages/{message.pk}/")
        self.assertEqual(forbidden.status_code, 403)
        self.client.force_authenticate(self.alice)
        ok = self.client.delete(f"/api/messages/{message.pk}/")
        self.assertEqual(ok.status_code, 204)
        message.refresh_from_db()
        self.assertTrue(message.is_deleted)

    def test_group_admin_can_delete_member_message(self):
        room = Room.objects.create(is_group=True, name="Groupe", owner=self.alice)
        RoomMembership.objects.create(room=room, user=self.alice, role=RoomMembership.ROLE_OWNER)
        RoomMembership.objects.create(room=room, user=self.bob)
        message = Message.objects.create(room=room, sender=self.bob, content="coucou")
        self.client.force_authenticate(self.alice)
        ok = self.client.delete(f"/api/messages/{message.pk}/")
        self.assertEqual(ok.status_code, 204)
        message.refresh_from_db()
        self.assertTrue(message.is_deleted)

    def test_reply_to_message_and_reply_notification(self):
        root = Message.objects.create(room=self.room, sender=self.bob, content="question ?")
        self.client.force_authenticate(self.alice)
        response = self.client.post(
            "/api/messages/", {"room": self.room.pk, "content": "réponse", "parent": root.pk}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        reply = Message.objects.get(pk=response.data["id"])
        self.assertEqual(reply.parent, root)
        notification = Notification.objects.filter(recipient=self.bob, type="reply").first()
        self.assertIsNotNone(notification)

    def test_mention_creates_notification(self):
        self.client.force_authenticate(self.alice)
        response = self.client.post("/api/messages/", {"room": self.room.pk, "content": "Salut @bob !"}, format="json")
        self.assertEqual(response.status_code, 201)
        notification = Notification.objects.filter(recipient=self.bob, type="mention").first()
        self.assertIsNotNone(notification)

    def test_reactions_toggle(self):
        message = Message.objects.create(room=self.room, sender=self.bob, content="joli")
        self.client.force_authenticate(self.alice)
        added = self.client.post(f"/api/messages/{message.pk}/react/", {"emoji": "👍"}, format="json")
        self.assertEqual(added.status_code, 201)
        message = Message.objects.prefetch_related("reactions").get(pk=message.pk)
        reactions = self.client.get(f"/api/messages/{message.pk}/")
        self.assertEqual(reactions.data["reactions"][0]["emoji"], "👍")
        self.assertTrue(reactions.data["reactions"][0]["me"])
        removed = self.client.post(f"/api/messages/{message.pk}/unreact/", {"emoji": "👍"}, format="json")
        self.assertEqual(removed.status_code, 200)

    def test_reaction_emoji_validation(self):
        message = Message.objects.create(room=self.room, sender=self.bob, content="joli")
        self.client.force_authenticate(self.alice)
        rejected = self.client.post(
            f"/api/messages/{message.pk}/react/", {"emoji": "pas un emoji vraiment trop long"}, format="json"
        )
        self.assertEqual(rejected.status_code, 400)

    def test_pin_unpin_single_pinned(self):
        m1 = Message.objects.create(room=self.room, sender=self.alice, content="pin 1")
        m2 = Message.objects.create(room=self.room, sender=self.bob, content="pin 2")
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.post(f"/api/messages/{m1.pk}/pin/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/messages/{m2.pk}/pin/").status_code, 200)
        self.assertFalse(Message.objects.get(pk=m1.pk).is_pinned)
        self.assertTrue(Message.objects.get(pk=m2.pk).is_pinned)
        self.assertEqual(self.client.post(f"/api/messages/{m2.pk}/unpin/").status_code, 200)
        self.assertFalse(Message.objects.get(pk=m2.pk).is_pinned)

    def test_read_receipts(self):
        message = Message.objects.create(room=self.room, sender=self.alice, content="lu ?")
        self.client.force_authenticate(self.bob)
        ok = self.client.post(f"/api/messages/{message.pk}/read/")
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(MessageReadReceipt.objects.filter(message=message, user=self.bob).exists())
        receipts = self.client.get(f"/api/messages/{message.pk}/receipts/")
        self.assertEqual([r["user"]["username"] for r in receipts.data["read_by"]], ["bob"])

    def test_messages_cursor_pagination(self):
        for index in range(60):
            Message.objects.create(room=self.room, sender=self.alice, content=f"msg {index}")
        self.client.force_authenticate(self.alice)
        first_page = self.client.get("/api/messages/", {"room_id": self.room.pk})
        self.assertEqual(first_page.status_code, 200)
        self.assertEqual(len(first_page.data["results"]), 50)
        self.assertIsNotNone(first_page.data["next"])
        # Les messages les plus récents arrivent en premier.
        self.assertEqual(first_page.data["results"][0]["content"], "msg 59")
        second_page = self.client.get(first_page.data["next"])
        self.assertEqual(len(second_page.data["results"]), 10)

    def test_message_search_by_room_author_period(self):
        old = Message.objects.create(room=self.room, sender=self.alice, content="ancien mot clé")
        Message.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=10))
        recent = Message.objects.create(room=self.room, sender=self.bob, content="récent mot clé")
        self.client.force_authenticate(self.alice)
        # par auteur
        response = self.client.get("/api/messages/", {"room_id": self.room.pk, "author_id": self.bob.pk})
        self.assertEqual([m["id"] for m in response.data["results"]], [recent.pk])
        # par période
        response = self.client.get(
            "/api/messages/", {"room_id": self.room.pk, "since": (timezone.now() - timedelta(days=1)).isoformat()}
        )
        self.assertEqual([m["id"] for m in response.data["results"]], [recent.pk])
        # recherche texte
        response = self.client.get("/api/messages/", {"room_id": self.room.pk, "search": "mot clé"})
        self.assertEqual(len(response.data["results"]), 2)

    def test_attachment_upload_and_validation(self):
        image_buffer = BytesIO()
        Image.new("RGB", (10, 10), "red").save(image_buffer, format="PNG")
        image_buffer.seek(0)
        image = SimpleUploadedFile("photo.png", image_buffer.read(), content_type="image/png")
        self.client.force_authenticate(self.alice)
        ok = self.client.post(
            "/api/messages/", {"room": self.room.pk, "content": "voici une image", "files": [image]}, format="multipart"
        )
        self.assertEqual(ok.status_code, 201, ok.data)
        message = Message.objects.get(pk=ok.data["id"])
        self.assertEqual(message.attachments.count(), 1)
        self.assertEqual(message.attachments.first().original_name, "photo.png")
        evil = SimpleUploadedFile("virus.exe", b"MZ...", content_type="application/x-msdownload")
        rejected = self.client.post("/api/messages/", {"room": self.room.pk, "files": [evil]}, format="multipart")
        self.assertEqual(rejected.status_code, 400)


class RoomRolesTests(BaseChatTest):
    def make_group(self, owner, members):
        room = Room.objects.create(is_group=True, name="Groupe", owner=owner)
        RoomMembership.objects.create(room=room, user=owner, role=RoomMembership.ROLE_OWNER)
        for member in members:
            RoomMembership.objects.create(room=room, user=member)
        return room

    def test_group_creation_sets_owner_and_logs_activity(self):
        make_friends(self.alice, self.eve)
        self.client.force_authenticate(self.alice)
        response = self.client.post(
            "/api/rooms/", {"name": "Super groupe", "participant_ids": [self.bob.pk, self.eve.pk]}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        room = Room.objects.get(pk=response.data["id"])
        self.assertEqual(room.owner, self.alice)
        self.assertEqual(response.data["my_role"], "owner")
        self.assertEqual(room.memberships.count(), 3)
        self.assertTrue(room.activity_logs.filter(action="member_joined").exists())

    def test_only_manager_can_rename(self):
        room = self.make_group(self.alice, [self.bob])
        self.client.force_authenticate(self.bob)
        forbidden = self.client.patch(f"/api/rooms/{room.pk}/", {"name": "Hack"}, format="json")
        self.assertEqual(forbidden.status_code, 403)
        self.client.force_authenticate(self.alice)
        ok = self.client.patch(f"/api/rooms/{room.pk}/", {"name": "Nouveau nom"}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(room.activity_logs.filter(action="name_changed").exists())

    def test_add_remove_members_with_hierarchy(self):
        room = self.make_group(self.alice, [self.bob])
        self.client.force_authenticate(self.bob)
        self.assertEqual(
            self.client.post(
                f"/api/rooms/{room.pk}/add_members/", {"user_ids": [self.eve.pk]}, format="json"
            ).status_code,
            403,
        )
        self.client.force_authenticate(self.alice)
        added = self.client.post(f"/api/rooms/{room.pk}/add_members/", {"user_ids": [self.eve.pk]}, format="json")
        self.assertEqual(added.status_code, 200)
        self.assertTrue(room.memberships.filter(user=self.eve).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.eve, type="group_invite").exists())
        removed = self.client.post(f"/api/rooms/{room.pk}/remove_member/", {"user_id": self.bob.pk}, format="json")
        self.assertEqual(removed.status_code, 200)
        self.assertFalse(room.memberships.filter(user=self.bob).exists())

    def test_admin_cannot_remove_admin(self):
        room = self.make_group(self.alice, [self.bob])
        RoomMembership.objects.filter(room=room, user=self.bob).update(role=RoomMembership.ROLE_ADMIN)
        self.client.force_authenticate(self.alice)
        ok = self.client.post(f"/api/rooms/{room.pk}/remove_member/", {"user_id": self.bob.pk}, format="json")
        self.assertEqual(ok.status_code, 200)

    def test_owner_cannot_leave_without_transfer(self):
        room = self.make_group(self.alice, [self.bob])
        self.client.force_authenticate(self.alice)
        refused = self.client.post(f"/api/rooms/{room.pk}/leave/")
        self.assertEqual(refused.status_code, 400)
        transfer = self.client.post(
            f"/api/rooms/{room.pk}/transfer_ownership/", {"user_id": self.bob.pk}, format="json"
        )
        self.assertEqual(transfer.status_code, 200)
        room.refresh_from_db()
        self.assertEqual(room.owner, self.bob)
        left = self.client.post(f"/api/rooms/{room.pk}/leave/")
        self.assertEqual(left.status_code, 200)

    def test_mute_and_ban(self):
        room = self.make_group(self.alice, [self.bob])
        self.client.force_authenticate(self.alice)
        muted = self.client.post(f"/api/rooms/{room.pk}/mute/", {"user_id": self.bob.pk}, format="json")
        self.assertEqual(muted.status_code, 200)
        self.assertTrue(room.memberships.get(user=self.bob).is_muted)
        banned = self.client.post(f"/api/rooms/{room.pk}/ban/", {"user_id": self.bob.pk}, format="json")
        self.assertEqual(banned.status_code, 200)
        self.assertTrue(room.memberships.get(user=self.bob).is_banned)
        # Un membre banni ne peut plus lire les messages.
        self.client.force_authenticate(self.bob)
        response = self.client.get("/api/messages/", {"room_id": room.pk})
        self.assertEqual(response.data["results"], [])

    def test_muted_member_cannot_send(self):
        room = self.make_group(self.alice, [self.bob])
        RoomMembership.objects.filter(room=room, user=self.bob).update(is_muted=True)
        self.client.force_authenticate(self.bob)
        response = self.client.post("/api/messages/", {"room": room.pk, "content": "muet"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_invite_link_join_flow(self):
        room = self.make_group(self.alice, [self.bob])
        self.client.force_authenticate(self.alice)
        link = self.client.post(f"/api/rooms/{room.pk}/invite_link/")
        self.assertEqual(link.status_code, 200)
        token = link.data["invite_url"].rsplit("/", 1)[-1]
        self.client.force_authenticate(self.eve)
        joined = self.client.post("/api/rooms/join/", {"token": token}, format="json")
        self.assertEqual(joined.status_code, 201)
        self.assertTrue(room.memberships.filter(user=self.eve).exists())
        # Un lien expiré est refusé.
        room.invite_expires_at = timezone.now() - timedelta(hours=1)
        room.save(update_fields=["invite_expires_at"])
        refused = self.client.post("/api/rooms/join/", {"token": token}, format="json")
        self.assertEqual(refused.status_code, 400)

    def test_group_delete_owner_only(self):
        room = self.make_group(self.alice, [self.bob])
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.delete(f"/api/rooms/{room.pk}/").status_code, 403)
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.delete(f"/api/rooms/{room.pk}/").status_code, 204)
        self.assertFalse(Room.objects.filter(pk=room.pk).exists())

    def test_archive_hides_room(self):
        self.client.force_authenticate(self.alice)
        archived = self.client.post(f"/api/rooms/{self.room.pk}/archive/")
        self.assertEqual(archived.status_code, 200)
        self.assertTrue(archived.data["archived"])
        rooms = self.client.get("/api/rooms/")
        self.assertEqual(rooms.data["count"], 0)
        unarchived = self.client.post(f"/api/rooms/{self.room.pk}/archive/")
        self.assertFalse(unarchived.data["archived"])


class NotificationTests(BaseChatTest):
    def test_notification_flow(self):
        self.client.force_authenticate(self.mallory)
        sent = self.client.post("/api/friendships/send_request/", {"receiver_id": self.alice.pk}, format="json")
        self.assertEqual(sent.status_code, 201)
        self.client.force_authenticate(self.alice)
        response = self.client.get("/api/notifications/")
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["type"], "friend_request")
        unread = self.client.get("/api/notifications/unread_count/")
        self.assertEqual(unread.data["unread_count"], 1)
        notification_id = response.data["results"][0]["id"]
        self.client.post(f"/api/notifications/{notification_id}/mark_read/")
        unread = self.client.get("/api/notifications/unread_count/")
        self.assertEqual(unread.data["unread_count"], 0)


class BlockingTests(BaseChatTest):
    def test_blocking_prevents_friend_request_and_removes_friendship(self):
        # Alice et Bob sont déjà amis (make_dm) : le blocage doit supprimer l'amitié.
        self.client.force_authenticate(self.alice)
        ok = self.client.post(f"/api/users/{self.bob.pk}/block/")
        self.assertEqual(ok.status_code, 200)
        self.assertFalse(Friendships.objects.filter(status="accepted").exists())
        self.client.force_authenticate(self.bob)
        refused = self.client.post("/api/friendships/send_request/", {"receiver_id": self.alice.pk}, format="json")
        self.assertEqual(refused.status_code, 403)

    def test_blocked_user_hidden_from_search(self):
        self.client.force_authenticate(self.alice)
        blocked = self.client.post(f"/api/users/{self.bob.pk}/block/")
        self.assertEqual(blocked.status_code, 200)
        results = self.client.get("/api/users/search_new_friends/", {"q": "bob"})
        self.assertEqual(results.data, [])
        listed = self.client.get("/api/users/blocked/")
        self.assertEqual([u["blocked"]["username"] for u in listed.data], ["bob"])
        self.client.post(f"/api/users/{self.bob.pk}/unblock/")
        results = self.client.get("/api/users/search_new_friends/", {"q": "bob"})
        self.assertEqual(len(results.data), 1)


class RateLimitTests(BaseChatTest):
    def test_login_rate_limit(self):
        make_user("carol")
        for _ in range(10):
            self.client.post("/api/auth/login/", {"username": "carol", "password": "wrong"}, format="json")
        throttled = self.client.post("/api/auth/login/", {"username": "carol", "password": "wrong"}, format="json")
        self.assertEqual(throttled.status_code, 429)

    def test_message_send_rate_limit(self):
        self.client.force_authenticate(self.alice)
        statuses = [
            self.client.post("/api/messages/", {"room": self.room.pk, "content": "spam"}, format="json").status_code
            for _ in range(30)
        ]
        throttled = self.client.post("/api/messages/", {"room": self.room.pk, "content": "spam"}, format="json")
        self.assertEqual(throttled.status_code, 429)
        self.assertTrue(any(code == 201 for code in statuses))

    def test_search_rate_limit(self):
        self.client.force_authenticate(self.alice)
        statuses = [self.client.get("/api/users/search_new_friends/", {"q": "x"}).status_code for _ in range(30)]
        throttled = self.client.get("/api/users/search_new_friends/", {"q": "x"})
        self.assertEqual(throttled.status_code, 429)
        self.assertTrue(all(code == 200 for code in statuses))


class ActivityLogTests(BaseChatTest):
    def test_member_join_is_logged(self):
        room = Room.objects.create(is_group=True, name="G", owner=self.alice)
        RoomMembership.objects.create(room=room, user=self.alice, role=RoomMembership.ROLE_OWNER)
        RoomMembership.objects.create(room=room, user=self.bob)
        ActivityLog.objects.create(room=room, user=self.bob, action="member_joined")
        self.client.force_authenticate(self.alice)
        response = self.client.get(f"/api/rooms/{room.pk}/activity/")
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["action_display"], "A rejoint le salon")


class WebSocketTests(TransactionTestCase):
    """Les consommateurs écrivent en base : TransactionTestCase pour la visibilité inter-threads."""

    def setUp(self):
        cache.clear()
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.mallory = make_user("mallory")
        self.room = make_dm(self.alice, self.bob)
        self.message = Message.objects.create(room=self.room, sender=self.bob, content="premier")
        self.client = APIClient()

    @staticmethod
    def _session_cookie(user):
        """Établit une session Django authentifiée, transmise via le cookie du scope WS."""
        from django.contrib.auth import BACKEND_SESSION_KEY, HASH_SESSION_KEY, SESSION_KEY
        from django.contrib.sessions.backends.db import SessionStore

        session = SessionStore()
        session[SESSION_KEY] = str(user.pk)
        session[BACKEND_SESSION_KEY] = "django.contrib.auth.backends.ModelBackend"
        session[HASH_SESSION_KEY] = user.get_session_auth_hash()
        session.save()
        return session.session_key

    async def _connect(self, user, path):
        """Connecte un client WebSocket authentifié via un cookie de session Django."""
        from asgiref.sync import sync_to_async
        from backend.asgi import application
        from channels.testing import WebsocketCommunicator
        from django.conf import settings

        session_key = await sync_to_async(self._session_cookie)(user)
        communicator = WebsocketCommunicator(application, path)
        cookie_name = settings.SESSION_COOKIE_NAME
        communicator.scope["headers"] = [
            (b"cookie", f"{cookie_name}={session_key}".encode()),
        ]
        connected, _ = await communicator.connect()
        return communicator, connected

    async def test_room_consumer_receives_message_broadcast(self):
        from asgiref.sync import sync_to_async

        communicator, connected = await self._connect(self.alice, f"/ws/rooms/{self.room.pk}/")
        self.assertTrue(connected)
        self.client.force_authenticate(self.bob)
        response = await sync_to_async(self.client.post)(
            "/api/messages/", {"room": self.room.pk, "content": "salut via WS"}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        # Laisse la boucle d'événements traiter le réveil du queue cross-thread
        # (la diffusion REST s'exécute dans un autre thread).
        await asyncio.sleep(0.1)
        event = await communicator.receive_json_from(timeout=10)
        self.assertEqual(event["event"], "message.created")
        self.assertEqual(event["payload"]["content"], "salut via WS")
        await communicator.disconnect()

    async def test_room_consumer_rejects_non_member(self):
        communicator, connected = await self._connect(self.mallory, f"/ws/rooms/{self.room.pk}/")
        self.assertFalse(connected)
        await communicator.disconnect()

    async def test_typing_broadcast(self):
        alice_comm, alice_ok = await self._connect(self.alice, f"/ws/rooms/{self.room.pk}/")
        bob_comm, bob_ok = await self._connect(self.bob, f"/ws/rooms/{self.room.pk}/")
        self.assertTrue(alice_ok and bob_ok)
        await alice_comm.send_json_to({"event": "typing.start", "payload": {"room_id": self.room.pk}})
        event = await bob_comm.receive_json_from(timeout=10)
        self.assertEqual(event["event"], "typing.changed")
        self.assertTrue(event["payload"]["is_typing"])
        self.assertEqual(event["payload"]["user_id"], self.alice.pk)
        await alice_comm.disconnect()
        await bob_comm.disconnect()

    async def test_user_consumer_receives_notification(self):
        from asgiref.sync import sync_to_async

        communicator, connected = await self._connect(self.alice, "/ws/user/")
        self.assertTrue(connected)
        # Une demande d'ami crée une notification poussée en temps réel.
        self.client.force_authenticate(self.mallory)
        response = await sync_to_async(self.client.post)(
            "/api/friendships/send_request/", {"receiver_id": self.alice.pk}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        await asyncio.sleep(0.1)
        event = await communicator.receive_json_from(timeout=10)
        self.assertEqual(event["event"], "notification.created")
        self.assertEqual(event["payload"]["type"], "friend_request")
        await communicator.disconnect()
