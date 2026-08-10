from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver
# Create your models here.

class Room(models.Model):
    name = models.CharField(db_index= True, max_length=255, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    is_group = models.BooleanField(default=False)

    participants = models.ManyToManyField(User, related_name="rooms")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        if self.is_group:
            return self.name or f"Groupe {self.id}"
        participants_names = ", ".join([u.username for u in self.participants.all()[:3]])
        return f"DM: {participants_names} (ID : {self.id})"

class Message(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name="messages")
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.sender.username} dans #{self.room.id} : {self.content[:30]}"


class Friendships(models.Model):
    STATUS_CHOICES = [
        ('pending', 'En attente'),
        ('accepted', 'Accepté'),
        ('rejected', 'Refusé'),
    ]

    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sent_friendships")
    receiver = models.ForeignKey(User, on_delete=models.CASCADE, related_name="received_friendships")
    status = models.CharField(db_index=True, max_length=10, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('sender', 'receiver')

    def __str__(self):
        return f"{self.sender.username} -> {self.receiver.username} ({self.get_status_display()})"
    
class UserStatus(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="status")
    last_seen = models.DateTimeField(auto_now=True)
    typing_in = models.ForeignKey(Room, on_delete=models.SET_NULL, null=True, blank=True, related_name="typing_status")

    def __str__(self):
        return f"{self.user.username} - Actif le : {self.last_seen}"


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
def create_user_profile(sender, instance, created ,**kwargs):
    if created:
        Profile.objects.create(user=instance)

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    if not hasattr(instance, 'profile'):
            Profile.objects.create(user=instance)
    instance.profile.save


class RoomVisit(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="room_visite")
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="visite")
    last_visited = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'room')

    def __str__(self):
        return f"{self.user.username} - Salon #{self.room.id} visité le {self.last_visited}"
    
    