from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    FriendshipViewSet,
    MessageViewSet,
    NotificationViewSet,
    RoomViewSet,
    UserViewSet,
    csrf_view,
    heartbeat_view,
    login_view,
    logout_view,
    me_view,
    register_view,
    update_profile_view,
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("rooms", RoomViewSet, basename="room")
router.register("messages", MessageViewSet, basename="message")
router.register("friendships", FriendshipViewSet, basename="friendship")
router.register("notifications", NotificationViewSet, basename="notification")

urlpatterns = [
    path("", include(router.urls)),
    path("auth/csrf/", csrf_view, name="api-csrf"),
    path("auth/login/", login_view, name="api-login"),
    path("auth/logout/", logout_view, name="api-logout"),
    path("auth/me/", me_view, name="api-me"),
    path("auth/register/", register_view, name="api-register"),
    path("auth/heartbeat/", heartbeat_view, name="api-heartbeat"),
    path("auth/profile/update/", update_profile_view, name="api-profile-update"),
]
