from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Room, Message, Friendships, Profile
from django.utils import timezone
import datetime
class UserSerializer(serializers.ModelSerializer):
    is_online = serializers.SerializerMethodField()
    is_typing_in = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    status_text = serializers.SerializerMethodField()
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'is_online', 'is_typing_in',
                  'avatar', 'bio', 'status_text' ]

    def get_is_online(self, obj):
        try:
            user_status = obj.status
            now = timezone.now()
            return (now - user_status.last_seen) < datetime.timedelta(seconds=12)
        except Exception:
            return False

    def get_is_typing_in(self, obj):
        try:
            user_status = obj.status
            if self.get_is_online(obj) and user_status.typing_in:
                return user_status.typing_in.id
        except Exception:
            pass
        return None
    def get_avatar(self, obj):
        if hasattr(obj, 'profile') and obj.profile.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.profile.avatar.url)
            return f"http://localhost:8000{obj.profile.avatar.url}"
        return None

    def get_bio(self, obj):
        if hasattr(obj, 'profile'):
            return obj.profile.bio
        return None
    
    def get_status_text(self, obj):
        if hasattr(obj, 'profile'):
            return obj.profile.status_text
        return None
    
class MessageSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    # sender_id = serializers.PrimaryKeyRelatedField(
    #     queryset= User.objects.all(), source= 'sender', write_only=True
    # )

    class Meta:
        model = Message
        fields = ['id', 'room', 'sender',  'content', 'created_at']
        read_only_fields = ['created_at']

class RoomSerializer(serializers.ModelSerializer):
    participants = UserSerializer(many=True, read_only=True)
    participant_ids = serializers.PrimaryKeyRelatedField(
        many = True, write_only = True, queryset=User.objects.all(), source='participants'
    )
    last_message = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = ['id', 'name', 'is_group', 'participants', 'participant_ids', 'last_message',
                  'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def get_last_message(self, obj):
        last_msg = obj.messages.order_by('-created_at').first()
        if last_msg:
            return MessageSerializer(last_msg).data
        return None

class FriendshipsSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    receiver = UserSerializer(read_only=True)

    class Meta:
        model = Friendships
        fields = ['id', 'sender', 'receiver', 'status', 'created_at', 'updated_at']
        read_only_fields = ['id', 'status', 'created_at', 'updated_at']

