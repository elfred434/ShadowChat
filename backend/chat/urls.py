from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import UserViewSet, RoomViewSet, MessageViewSet, login_view, logout_view, me_view, FriendshipViewSet, register_view, heartbeat_view

router = DefaultRouter()
router.register(r'users', UserViewSet, basename= 'user')
router.register(r'rooms', RoomViewSet, basename='room')
router.register(r'messages', MessageViewSet, basename='messages')
router.register(r'friendships', FriendshipViewSet, basename='friendship' )
urlpatterns = [
    path('', include(router.urls)),

    path('auth/login/', login_view, name='api-login'),
    path('auth/logout/', logout_view, name='api-logout'),
    path('auth/me/', me_view, name='api-me'),
    path('auth/register/', register_view, name='api-register'),
    path('auth/heartbeat/', heartbeat_view, name='api-heartbeat'),
]
