"""Routage WebSocket de ShadowChat."""

from django.urls import path

from .consumers import RoomConsumer, UserConsumer

websocket_urlpatterns = [
    path("ws/rooms/<int:room_id>/", RoomConsumer.as_asgi()),
    path("ws/user/", UserConsumer.as_asgi()),
]
