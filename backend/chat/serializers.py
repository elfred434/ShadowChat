from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import serializers

from .models import Friendships, Message, Profile, Room, RoomVisit


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
        return hasattr(obj, "status") and (timezone.now() - obj.status.last_seen).total_seconds() < 30

    def get_is_typing_in(self, obj):
        return obj.status.typing_in_id if self.get_is_online(obj) and hasattr(obj, "status") else None

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


class MessageSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)

    class Meta:
        model = Message
        fields = ["id", "room", "sender", "content", "created_at"]
        read_only_fields = ["sender", "created_at"]

    def validate_content(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Le message ne peut pas être vide.")
        return value


class RoomSerializer(serializers.ModelSerializer):
    participants = UserSerializer(many=True, read_only=True)
    participant_ids = serializers.PrimaryKeyRelatedField(many=True, write_only=True, queryset=User.objects.all(), source="participants")
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = ["id", "name", "description", "is_group", "participants", "participant_ids", "last_message", "unread_count", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at", "is_group"]

    def get_last_message(self, obj):
        last_message = obj.messages.select_related("sender", "sender__profile", "sender__status").order_by("-created_at").first()
        return MessageSerializer(last_message, context=self.context).data if last_message else None

    def get_unread_count(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return 0
        visit = obj.visits.filter(user=request.user).only("last_visited").first()
        messages = obj.messages.exclude(sender=request.user)
        return messages.filter(created_at__gt=visit.last_visited).count() if visit else messages.count()


class FriendshipsSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    receiver = UserSerializer(read_only=True)

    class Meta:
        model = Friendships
        fields = ["id", "sender", "receiver", "status", "created_at", "updated_at"]
        read_only_fields = fields


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ["bio", "status_text", "avatar"]

    def validate_avatar(self, value):
        if value.size > 2 * 1024 * 1024:
            raise serializers.ValidationError("L'avatar ne doit pas dépasser 2 Mo.")
        if value.content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
            raise serializers.ValidationError("Format d'avatar non pris en charge.")
        return value
