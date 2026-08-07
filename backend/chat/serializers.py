from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Room, Message, Friendships

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email']

class MessageSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    # sender_id = serializers.PrimaryKeyRelatedField(
    #     queryset= User.objects.all(), source= 'sender', write_only=True
    # )

    class Meta:
        model = Message
        fields = ['id', 'room', 'sender', 'sender_id', 'content', 'created_at']
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