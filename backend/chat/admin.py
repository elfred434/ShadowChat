from django.contrib import admin
from .models import Room, Message
# Register your models here.

@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'is_group', 'created_at')
    filter_horizontal = ('participants',)
    search_fields = ('name',)

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'room', 'sender', 'content_preview', 'created_at')
    list_filter = ('room', 'sender', 'created_at')
    search_fields = ('content', 'sender__username')

    def content_preview(self, obj):
        return obj.content[:50]
    content_preview.short_description = "Message"
