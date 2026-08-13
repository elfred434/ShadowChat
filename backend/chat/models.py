import uuid
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.db.models import F, Q
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

# ---------------------------------------------------------------------------
# Salons et membres
# ---------------------------------------------------------------------------


class Room(models.Model):
    name = models.CharField(db_index=True, max_length=255, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    is_group = models.BooleanField(default=False)
    avatar = models.ImageField(upload_to="room_avatars/", null=True, blank=True)
    # Propriétaire (groupes uniquement, NULL pour les DM).
    owner = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_rooms")
    participants = models.ManyToManyField(User, through="RoomMembership", related_name="rooms")
    # Salon archivé par l'utilisateur (masqué de sa liste, sans le quitter).
    archived_by = models.ManyToManyField(User, related_name="archived_rooms", blank=True)
    # Lien d'invitation temporaire (groupes uniquement).
    invite_token = models.UUIDField(null=True, blank=True, unique=True)
    invite_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        if self.is_group:
            return self.name or f"Groupe {self.id}"
        participants_names = ", ".join(u.username for u in self.participants.all()[:3])
        return f"DM: {participants_names} (ID : {self.id})"

    def is_member(self, user):
        return self.memberships.filter(user=user, is_banned=False).exists()

    def role_of(self, user):
        membership = self.memberships.filter(user=user).first()
        return membership.role if membership else None

    def get_or_create_invite_link(self, request=None):
        """Crée (ou régénère) un lien d'invitation valide pour une durée limitée."""
        if not self.is_group:
            raise ValueError("Les liens d'invitation ne concernent que les groupes.")
        self.invite_token = uuid.uuid4()
        self.invite_expires_at = timezone.now() + timezone.timedelta(hours=settings.GROUP_INVITE_LINK_TTL_HOURS)
        self.save(update_fields=["invite_token", "invite_expires_at", "updated_at"])
        path = f"/groupes/rejoindre/{self.invite_token}"
        if request:
            return request.build_absolute_uri(path)
        return f"{settings.PUBLIC_SITE_URL or ''}{path}"


class RoomMembership(models.Model):
    ROLE_OWNER = "owner"
    ROLE_ADMIN = "admin"
    ROLE_MEMBER = "member"
    ROLE_CHOICES = [
        (ROLE_OWNER, "Propriétaire"),
        (ROLE_ADMIN, "Administrateur"),
        (ROLE_MEMBER, "Membre"),
    ]

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="room_memberships")
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default=ROLE_MEMBER)
    is_muted = models.BooleanField(default=False)
    is_banned = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["room", "user"], name="unique_room_member")]

    def __str__(self):
        return f"{self.user.username} dans #{self.room.id} ({self.get_role_display()})"

    def can_manage(self):
        """Un membre peut-il administrer le salon (ajouter/retirer, bannir…) ?"""
        return self.role in {self.ROLE_OWNER, self.ROLE_ADMIN}

    def can_manage_user(self, target: "RoomMembership") -> bool:
        """Règles de hiérarchie : l'owner gère tout le monde, un admin gère les simples membres."""
        if self.role == self.ROLE_OWNER:
            return target.user_id != self.user_id
        if self.role == self.ROLE_ADMIN:
            return target.role == self.ROLE_MEMBER
        return False


# ---------------------------------------------------------------------------
# Messages, pièces jointes, réactions, accusés de lecture
# ---------------------------------------------------------------------------


def attachment_upload_path(instance, filename):
    ext = Path(filename).suffix.lower()[:10]
    return f"attachments/room_{instance.message.room_id}/{uuid.uuid4().hex}{ext}"


class Message(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name="messages")
    # Réponse à un message (fils de discussion) : NULL pour un message racine.
    parent = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="replies")
    # Le contenu peut être vide quand le message ne porte que des pièces jointes.
    content = models.TextField(max_length=5000, blank=True)
    is_deleted = models.BooleanField(default=False)
    is_pinned = models.BooleanField(default=False)
    edited_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["room", "created_at"])]
        constraints = [
            # Un seul message épinglé à la fois par salon.
            models.UniqueConstraint(fields=["room"], condition=Q(is_pinned=True), name="one_pinned_message_per_room"),
        ]

    def __str__(self):
        return f"{self.sender.username} dans #{self.room.id} : {self.content[:30]}"


class MessageAttachment(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to=attachment_upload_path)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Pièce jointe de {self.message.sender.username} : {self.original_name}"


class MessageReaction(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reactions")
    emoji = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["message", "user", "emoji"], name="unique_reaction"),
        ]

    def __str__(self):
        return f"{self.user.username} : {self.emoji} sur le message {self.message_id}"


class MessageReadReceipt(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="read_receipts")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="read_receipts")
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["message", "user"], name="unique_read_receipt"),
        ]

    def __str__(self):
        return f"{self.user.username} a lu le message {self.message_id}"


# ---------------------------------------------------------------------------
# Journal d'activité des salons
# ---------------------------------------------------------------------------


class ActivityLog(models.Model):
    class Action(models.TextChoices):
        MEMBER_JOINED = "member_joined", "A rejoint le salon"
        MEMBER_LEFT = "member_left", "A quitté le salon"
        MEMBER_ADDED = "member_added", "A ajouté un membre"
        MEMBER_REMOVED = "member_removed", "A retiré un membre"
        MEMBER_MUTED = "member_muted", "A mis un membre en sourdine"
        MEMBER_UNMUTED = "member_unmuted", "A rétabli un membre"
        MEMBER_BANNED = "member_banned", "A banni un membre"
        MEMBER_UNBANNED = "member_unbanned", "A levé le bannissement"
        ROLE_CHANGED = "role_changed", "A changé le rôle d'un membre"
        NAME_CHANGED = "name_changed", "A changé le nom du salon"
        DESCRIPTION_CHANGED = "description_changed", "A changé la description"
        AVATAR_CHANGED = "avatar_changed", "A changé l'avatar"
        INVITE_LINK_CREATED = "invite_link_created", "A créé un lien d'invitation"

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="activity_logs")
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=32, choices=Action.choices)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"#{self.room_id} {self.get_action_display()}"


# ---------------------------------------------------------------------------
# Notifications, blocage, amitiés, présence, profils
# ---------------------------------------------------------------------------


class Notification(models.Model):
    class Type(models.TextChoices):
        FRIEND_REQUEST = "friend_request", "Nouvelle demande d'ami"
        FRIEND_ACCEPTED = "friend_accepted", "Demande d'ami acceptée"
        FRIEND_REJECTED = "friend_rejected", "Demande d'ami refusée"
        MENTION = "mention", "Mention dans un message"
        REPLY = "reply", "Réponse à votre message"
        GROUP_INVITE = "group_invite", "Invitation à un groupe"

    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="sent_notifications")
    type = models.CharField(max_length=24, choices=Type.choices)
    room = models.ForeignKey(Room, on_delete=models.CASCADE, null=True, blank=True, related_name="notifications")
    message = models.ForeignKey(Message, on_delete=models.CASCADE, null=True, blank=True, related_name="notifications")
    data = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "read_at", "created_at"])]

    def __str__(self):
        return f"{self.recipient.username} : {self.get_type_display()}"


class BlockedUser(models.Model):
    blocker = models.ForeignKey(User, on_delete=models.CASCADE, related_name="blocking")
    blocked = models.ForeignKey(User, on_delete=models.CASCADE, related_name="blocked_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["blocker", "blocked"], name="unique_block")]

    def __str__(self):
        return f"{self.blocker.username} bloque {self.blocked.username}"


class Friendships(models.Model):
    STATUS_CHOICES = [("pending", "En attente"), ("accepted", "Accepté"), ("rejected", "Refusé")]
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sent_friendships")
    receiver = models.ForeignKey(User, on_delete=models.CASCADE, related_name="received_friendships")
    status = models.CharField(db_index=True, max_length=10, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["sender", "receiver"], name="unique_friendship_direction"),
            models.CheckConstraint(condition=~Q(sender=F("receiver")), name="friendship_not_self"),
        ]

    def __str__(self):
        return f"{self.sender.username} -> {self.receiver.username} ({self.get_status_display()})"


class UserStatus(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="status")
    last_seen = models.DateTimeField(auto_now=True)
    typing_in = models.ForeignKey(Room, on_delete=models.SET_NULL, null=True, blank=True, related_name="typing_status")


class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    avatar = models.ImageField(upload_to="avatars/", null=True, blank=True)
    bio = models.TextField(max_length=500, blank=True, null=True)
    status_text = models.CharField(db_index=True, max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profil de {self.user.username}"


@receiver(post_save, sender=User)
def create_or_save_user_profile(sender, instance, created, **kwargs):
    if created:
        Profile.objects.create(user=instance)
    else:
        Profile.objects.get_or_create(user=instance)


class RoomVisit(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="room_visits")
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="visits")
    last_visited = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "room"], name="unique_room_visit")]

    def __str__(self):
        return f"{self.user.username} - Salon #{self.room.id} visité le {self.last_visited}"
