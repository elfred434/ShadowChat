from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .accounts import (
    login_2fa_view,
    password_change_view,
    password_reset_confirm_view,
    password_reset_request_view,
    report_create_view,
    report_list_view,
    resend_verification_view,
    revoke_session_view,
    sessions_view,
    totp_disable_view,
    totp_enable_view,
    totp_setup_view,
    verify_email_view,
)
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
    path("auth/login/2fa/", login_2fa_view, name="api-login-2fa"),
    path("auth/logout/", logout_view, name="api-logout"),
    path("auth/me/", me_view, name="api-me"),
    path("auth/register/", register_view, name="api-register"),
    path("auth/heartbeat/", heartbeat_view, name="api-heartbeat"),
    path("auth/profile/update/", update_profile_view, name="api-profile-update"),
    # Compte & sécurité
    path("auth/email/verify/", verify_email_view, name="api-email-verify"),
    path("auth/email/resend/", resend_verification_view, name="api-email-resend"),
    path("auth/password/reset/request/", password_reset_request_view, name="api-password-reset-request"),
    path("auth/password/reset/confirm/", password_reset_confirm_view, name="api-password-reset-confirm"),
    path("auth/password/change/", password_change_view, name="api-password-change"),
    path("auth/2fa/setup/", totp_setup_view, name="api-2fa-setup"),
    path("auth/2fa/enable/", totp_enable_view, name="api-2fa-enable"),
    path("auth/2fa/disable/", totp_disable_view, name="api-2fa-disable"),
    path("auth/sessions/", sessions_view, name="api-sessions"),
    path("auth/sessions/revoke/", revoke_session_view, name="api-session-revoke"),
    # Modération
    path("reports/", report_create_view, name="api-report-create"),
    path("reports/mine/", report_list_view, name="api-report-mine"),
]
