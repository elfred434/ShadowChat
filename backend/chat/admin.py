from django.contrib import admin

from .models import (
    ActivityLog,
    BlockedUser,
    Friendships,
    Message,
    MessageAttachment,
    MessageReaction,
    Notification,
    Room,
    RoomMembership,
)


class RoomMembershipInline(admin.TabularInline):
    model = RoomMembership
    extra = 0
    raw_id_fields = ("user",)


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "is_group", "owner", "created_at")
    list_filter = ("is_group", "created_at")
    search_fields = ("name",)
    inlines = (RoomMembershipInline,)
    raw_id_fields = ("owner",)


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "sender", "content_preview", "is_deleted", "created_at")
    list_filter = ("room", "sender", "is_deleted", "created_at")
    search_fields = ("content", "sender__username")

    @admin.display(description="Message")
    def content_preview(self, obj):
        return obj.content[:50]


@admin.register(Friendships)
class FriendshipsAdmin(admin.ModelAdmin):
    list_display = ("id", "sender", "receiver", "status", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("sender__username", "receiver__username")


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "user", "action", "created_at")
    list_filter = ("action", "created_at")
    search_fields = ("room__name", "user__username")


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("id", "recipient", "type", "read_at", "created_at")
    list_filter = ("type", "read_at", "created_at")
    search_fields = ("recipient__username",)


@admin.register(BlockedUser)
class BlockedUserAdmin(admin.ModelAdmin):
    list_display = ("id", "blocker", "blocked", "created_at")
    search_fields = ("blocker__username", "blocked__username")


admin.site.register(MessageAttachment)
admin.site.register(MessageReaction)
