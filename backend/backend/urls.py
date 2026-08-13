"""Routage HTTP du projet ShadowChat.

- `/admin/`   : administration Django
- `/api/`     : API REST (chat, amis, notifications, compte)
- `/health/`  : sonde de santé pour les orchestrateurs et reverse proxy
- `/media/`   : fichiers téléversés (servis par Django en développement,
                par Nginx ou un stockage objet en production)
"""

from chat.views import health_view
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("chat.urls")),
    path("health/", health_view, name="health"),
    path("api-auth/", include("rest_framework.urls", namespace="rest_framework")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
