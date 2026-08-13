from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Friendships, Message, Room


class ChatAuthorizationTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username="alice", password="CorrectHorse1!")
        self.bob = User.objects.create_user(username="bob", password="CorrectHorse1!")
        self.eve = User.objects.create_user(username="eve", password="CorrectHorse1!")
        self.room = Room.objects.create(is_group=False)
        self.room.participants.add(self.alice, self.bob)
        self.message = Message.objects.create(room=self.room, sender=self.alice, content="secret for bob")
        self.client = APIClient()

    def test_messages_are_not_visible_to_non_participants(self):
        self.client.force_authenticate(self.eve)
        response = self.client.get("/api/messages/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])
        response = self.client.get(f"/api/messages/{self.message.pk}/")
        self.assertEqual(response.status_code, 404)

    def test_non_participant_cannot_send_message_to_room(self):
        self.client.force_authenticate(self.eve)
        response = self.client.post("/api/messages/", {"room": self.room.pk, "content": "intrusion"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Message.objects.filter(room=self.room).count(), 1)

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
        friendship = Friendships.objects.create(sender=self.alice, receiver=self.bob)
        self.client.force_authenticate(self.eve)
        response = self.client.post(f"/api/friendships/{friendship.pk}/accept/")
        self.assertEqual(response.status_code, 404)
        self.client.force_authenticate(self.bob)
        response = self.client.post(f"/api/friendships/{friendship.pk}/accept/")
        self.assertEqual(response.status_code, 200)
        friendship.refresh_from_db()
        self.assertEqual(friendship.status, "accepted")


class CsrfTests(TestCase):
    def test_login_requires_and_accepts_csrf_token(self):
        client = APIClient(enforce_csrf_checks=True)
        missing_token = client.post("/api/auth/login/", {"username": "nobody", "password": "none"}, format="json")
        self.assertEqual(missing_token.status_code, 403)
        csrf_response = client.get("/api/auth/csrf/")
        self.assertEqual(csrf_response.status_code, 200)
        token = csrf_response.cookies["csrftoken"].value
        User.objects.create_user(username="carol", password="CorrectHorse1!")
        response = client.post("/api/auth/login/", {"username": "carol", "password": "CorrectHorse1!"}, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
