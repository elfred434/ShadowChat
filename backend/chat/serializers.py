from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import serializers

from .models import (
    ActivityLog,
    BlockedUser,
    Friendships,
    Message,
    MessageAttachment,
    Notification,
    Profile,
    Room,
    RoomMembership,
)


# ---------------------------------------------------------------------------
# Utilisateurs
# ---------------------------------------------------------------------------
class UserSerializer(serializers.ModelSerializer):
    is_online = serializers.SerializerMethodField()
    is_typing_in = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    status_text = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "is_online", "is_typing_in", "avatar", "bio", "status_text"]

    def get_is_online(self, obj):
        status = getattr(obj, "status", None)
        if not status:
            return False
        return (timezone.now() - status.last_seen).total_seconds() < settings.ONLINE_WINDOW_SECONDS

    def get_is_typing_in(self, obj):
        status = getattr(obj, "status", None)
        if not status or not self.get_is_online(obj):
            return None
        return status.typing_in_id

    def get_avatar(self, obj):
        if not hasattr(obj, "profile") or not obj.profile.avatar:
            return None
        request = self.context.get("request")
        url = obj.profile.avatar.url
        return request.build_absolute_uri(url) if request else url

    def get_bio(self, obj):
        return obj.profile.bio if hasattr(obj, "profile") else None

    def get_status_text(self, obj):
        return obj.profile.status_text if hasattr(obj, "profile") else None


# ---------------------------------------------------------------------------
# Pièces jointes
# ---------------------------------------------------------------------------
# Types autorisés : images, PDF, documents bureautiques, archives.
ALLOWED_ATTACHMENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/zip": ".zip",
}


def validate_attachment_file(file):
    """Valide la taille, le type MIME, l'extension et l'intégrité des images."""
    if file.size > settings.MAX_ATTACHMENT_SIZE:
        raise serializers.ValidationError(
            f"La pièce jointe ne doit pas dépasser {settings.MAX_ATTACHMENT_SIZE // (1024 * 1024)} Mo."
        )
    if file.size == 0:
        raise serializers.ValidationError("Le fichier est vide.")
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise serializers.ValidationError(
            "Type de fichier non autorisé (images, PDF, documents et archives ZIP uniquement)."
        )
    import os

    extension = os.path.splitext(file.name or "")[1].lower()
    if extension and extension not in ALLOWED_ATTACHMENT_TYPES.values():
        raise serializers.ValidationError("Extension de fichier non autorisée.")
    if content_type.startswith("image/"):
        try:
            from PIL import Image

            image = Image.open(file)
            image.verify()  # détecte les fichiers corrompus ou déguisés
            file.seek(0)
        except Exception:
            raise serializers.ValidationError("Image invalide ou corrompue.") from None
    return file


class MessageAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = MessageAttachment
        fields = ["id", "url", "original_name", "content_type", "size"]
        read_only_fields = fields

    def get_url(self, obj):
        request = self.context.get("request")
        url = obj.file.url
        return request.build_absolute_uri(url) if request else url


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------
class MessageSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    parent = serializers.PrimaryKeyRelatedField(
        queryset=Message.objects.all(), required=False, allow_null=True, write_only=True
    )
    parent_preview = serializers.SerializerMethodField()
    attachments = MessageAttachmentSerializer(many=True, read_only=True)
    files = serializers.ListField(child=serializers.FileField(), write_only=True, required=False, max_length=5)
    reactions = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "room",
            "sender",
            "content",
            "parent",
            "parent_preview",
            "attachments",
            "files",
            "reactions",
            "read_by",
            "is_deleted",
            "is_pinned",
            "edited_at",
            "created_at",
        ]
        read_only_fields = ["sender", "created_at", "edited_at", "is_deleted", "is_pinned"]

    def get_parent_preview(self, obj):
        if not obj.parent:
            return None
        return {
            "id": obj.parent.id,
            "content": obj.parent.content[:120] if not obj.parent.is_deleted else "Message supprimé",
            "is_deleted": obj.parent.is_deleted,
            "sender": obj.parent.sender.username,
        }

    def get_reactions(self, obj):
        request = self.context.get("request")
        summary = {}
        my_emojis = set()
        for reaction in obj.reactions.all():
            summary[reaction.emoji] = summary.get(reaction.emoji, 0) + 1
            if request and reaction.user_id == request.user.id:
                my_emojis.add(reaction.emoji)
        return [
            {"emoji": emoji, "count": count, "me": emoji in my_emojis}
            for emoji, count in sorted(summary.items(), key=lambda item: -item[1])
        ]

    def get_read_by(self, obj):
        return list(obj.read_receipts.exclude(user_id=obj.sender_id).values_list("user_id", flat=True)[:100])

    def validate_files(self, files):
        for file in files:
            validate_attachment_file(file)
        return files

    def validate_content(self, value):
        return value.strip()

    def validate(self, attrs):
        content = attrs.get("content", "")
        files = attrs.get("files") or []
        if not content and not files:
            raise serializers.ValidationError("Le message ne peut pas être vide.")
        return attrs

    def create(self, validated_data):
        validated_data.pop("files", None)  # gérées séparément par la vue
        return super().create(validated_data)


# ---------------------------------------------------------------------------
# Salons
# ---------------------------------------------------------------------------
class RoomMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = RoomMembership
        fields = ["id", "user", "role", "is_muted", "is_banned", "joined_at"]


class RoomSerializer(serializers.ModelSerializer):
    participants = UserSerializer(many=True, read_only=True)
    memberships = serializers.SerializerMethodField()
    # Champ d'entrée uniquement : l'appartenance est gérée explicitement par
    # la vue (RoomMembership), jamais via une écriture M2M directe.
    participant_ids = serializers.PrimaryKeyRelatedField(
        many=True, write_only=True, queryset=User.objects.all(), required=False
    )

    def create(self, validated_data):
        validated_data.pop("participant_ids", None)
        return super().create(validated_data)

    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    avatar = serializers.SerializerMethodField()
    avatar_file = serializers.ImageField(write_only=True, required=False)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    pinned_message = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    is_archived = serializers.SerializerMethodField()
    invite_url = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = [
            "id",
            "name",
            "description",
            "is_group",
            "participants",
            "memberships",
            "participant_ids",
            "owner",
            "avatar",
            "avatar_file",
            "last_message",
            "unread_count",
            "pinned_message",
            "my_role",
            "can_manage",
            "is_archived",
            "invite_url",
            "member_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at", "is_group"]

    def get_memberships(self, obj):
        return RoomMembershipSerializer(
            obj.memberships.select_related("user", "user__profile", "user__status"), many=True, context=self.context
        ).data

    def get_avatar(self, obj):
        if not obj.avatar:
            return None
        request = self.context.get("request")
        url = obj.avatar.url
        return request.build_absolute_uri(url) if request else url

    def get_last_message(self, obj):
        last_message = (
            obj.messages.select_related("sender", "sender__profile", "sender__status").order_by("-created_at").first()
        )
        return MessageSerializer(last_message, context=self.context).data if last_message else None

    def get_unread_count(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return 0
        visit = obj.visits.filter(user=request.user).only("last_visited").first()
        messages = obj.messages.exclude(sender=request.user)
        return messages.filter(created_at__gt=visit.last_visited).count() if visit else messages.count()

    def get_pinned_message(self, obj):
        pinned = (
            obj.messages.filter(is_pinned=True).select_related("sender", "sender__profile", "sender__status").first()
        )
        return MessageSerializer(pinned, context=self.context).data if pinned else None

    def get_my_role(self, obj):
        request = self.context.get("request")
        membership = obj.memberships.filter(user=request.user).first() if request else None
        return membership.role if membership else None

    def get_can_manage(self, obj):
        request = self.context.get("request")
        membership = obj.memberships.filter(user=request.user).first() if request else None
        return membership.can_manage() if membership else False

    def get_is_archived(self, obj):
        request = self.context.get("request")
        return bool(request and obj.archived_by.filter(pk=request.user.pk).exists())

    def get_invite_url(self, obj):
        request = self.context.get("request")
        if not obj.is_group:
            return None
        membership = obj.memberships.filter(user=request.user).first() if request else None
        if not membership or not membership.can_manage():
            return None
        if not obj.invite_token or (obj.invite_expires_at and obj.invite_expires_at < timezone.now()):
            return None
        origin = request.build_absolute_uri("/")[:-1] if request else ""
        return f"{origin}/#/rejoindre/{obj.invite_token}"

    def get_member_count(self, obj):
        return obj.memberships.count()


class RoomUpdateSerializer(serializers.ModelSerializer):
    """Sérialiseur restreint pour la modification d'un groupe (nom, description, avatar)."""

    avatar_file = serializers.ImageField(write_only=True, required=False)

    class Meta:
        model = Room
        fields = ["name", "description", "avatar_file"]

    def validate_name(self, value):
        if value and len(value.strip()) > 255:
            raise serializers.ValidationError("Le nom ne doit pas dépasser 255 caractères.")
        return value.strip() or None

    def validate_avatar_file(self, value):
        if value.size > settings.MAX_AVATAR_SIZE:
            raise serializers.ValidationError(
                f"L'avatar ne doit pas dépasser {settings.MAX_AVATAR_SIZE // (1024 * 1024)} Mo."
            )
        if value.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise serializers.ValidationError("Format d'avatar non pris en charge (JPEG, PNG, WebP).")
        return value


# ---------------------------------------------------------------------------
# Journal d'activité
# ---------------------------------------------------------------------------
class ActivityLogSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = ActivityLog
        fields = ["id", "user", "action", "action_display", "details", "created_at"]


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
class NotificationSerializer(serializers.ModelSerializer):
    actor = UserSerializer(read_only=True)
    room = serializers.SerializerMethodField()
    message = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ["id", "type", "actor", "room", "message", "data", "read_at", "created_at"]

    def get_room(self, obj):
        if not obj.room:
            return None
        return {"id": obj.room.id, "name": obj.room.name, "is_group": obj.room.is_group}

    def get_message(self, obj):
        if not obj.message:
            return None
        return {"id": obj.message.id, "content": obj.message.content[:120], "room_id": obj.message.room_id}


# ---------------------------------------------------------------------------
# Amitiés, blocage, profil
# ---------------------------------------------------------------------------
class FriendshipsSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    receiver = UserSerializer(read_only=True)

    class Meta:
        model = Friendships
        fields = ["id", "sender", "receiver", "status", "created_at", "updated_at"]
        read_only_fields = fields


class BlockedUserSerializer(serializers.ModelSerializer):
    blocked = UserSerializer(read_only=True)

    class Meta:
        model = BlockedUser
        fields = ["id", "blocked", "created_at"]
        read_only_fields = fields


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ["bio", "status_text", "avatar"]

    def validate_avatar(self, value):
        if value.size > settings.MAX_AVATAR_SIZE:
            raise serializers.ValidationError(
                f"L'avatar ne doit pas dépasser {settings.MAX_AVATAR_SIZE // (1024 * 1024)} Mo."
            )
        if value.content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
            raise serializers.ValidationError("Format d'avatar non pris en charge.")
        return value
