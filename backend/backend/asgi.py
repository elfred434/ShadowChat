"""Configuration ASGI de ShadowChat.

Daphne (ou tout serveur ASGI) expose l'application HTTP Django et les
WebSockets Channels sur le même port : le protocole est négocié lors de la
poignée de main (http/https ↔ ws/wss).
"""

import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

django_asgi_app = get_asgi_application()

from chat.routing import websocket_urlpatterns  # noqa: E402  (après django.setup)

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
