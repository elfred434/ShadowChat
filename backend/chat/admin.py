from django.contrib import admin

from .models import (
    ActivityLog,
    BlockedUser,
    EmailVerificationToken,
    Friendships,
    Message,
    MessageAttachment,
    MessageReaction,
    Notification,
    PasswordResetToken,
    Report,
    Room,
    RoomMembership,
    UserTOTP,
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


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    """Tableau de bord de modération : traitement des signalements."""

    list_display = ("id", "kind", "reporter", "target_user", "reason_preview", "status", "created_at")
    list_filter = ("kind", "status", "created_at")
    search_fields = ("reporter__username", "target_user__username", "reason")
    actions = ("mark_resolved", "mark_dismissed")
    readonly_fields = ("created_at",)

    @admin.display(description="Motif")
    def reason_preview(self, obj):
        return obj.reason[:80]

    @admin.action(description="Marquer comme traités")
    def mark_resolved(self, request, queryset):
        from django.utils import timezone

        queryset.update(status=Report.Status.RESOLVED, handled_by=request.user, resolved_at=timezone.now())

    @admin.action(description="Rejeter les signalements")
    def mark_dismissed(self, request, queryset):
        from django.utils import timezone

        queryset.update(status=Report.Status.DISMISSED, handled_by=request.user, resolved_at=timezone.now())


admin.site.register(EmailVerificationToken)
admin.site.register(PasswordResetToken)
admin.site.register(UserTOTP)
admin.site.register(MessageAttachment)
admin.site.register(MessageReaction)
