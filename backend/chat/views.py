"""Vues API de ShadowChat.

Toutes les écritures qui modifient un salon sont réservées à ses membres ;
les groupes disposent de rôles (propriétaire, administrateur, membre) avec
des règles de hiérarchie définies dans `RoomMembership`.
"""

import uuid

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, parser_classes, permission_classes, throttle_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import (
    ActivityLog,
    BlockedUser,
    Friendships,
    Message,
    MessageReadReceipt,
    Notification,
    Profile,
    Room,
    RoomMembership,
    RoomVisit,
    UserStatus,
    UserTOTP,
)
from .realtime import send_to_room_group, send_to_user
from .serializers import (
    ActivityLogSerializer,
    BlockedUserSerializer,
    FriendshipsSerializer,
    MessageSerializer,
    NotificationSerializer,
    ProfileUpdateSerializer,
    RoomMembershipSerializer,
    RoomSerializer,
    RoomUpdateSerializer,
    UserSerializer,
)
from .services import (
    broadcast_message_created,
    broadcast_message_updated,
    broadcast_room_updated,
    create_notification,
    log_activity,
    notify_mentions,
    touch_room,
)
from .throttling import (
    FriendRequestRateThrottle,
    LoginRateThrottle,
    MessageSendRateThrottle,
    RegisterRateThrottle,
    SearchRateThrottle,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def is_friend(user, other_user):
    return Friendships.objects.filter(
        Q(sender=user, receiver=other_user, status="accepted") | Q(sender=other_user, receiver=user, status="accepted")
    ).exists()


def are_blocked(user_a, user_b):
    """Vrai si l'un des deux utilisateurs bloque l'autre."""
    return BlockedUser.objects.filter(Q(blocker=user_a, blocked=user_b) | Q(blocker=user_b, blocked=user_a)).exists()


def get_membership(room, user):
    return room.memberships.filter(user=user).first()


def require_manager(room, user):
    """Lève PermissionDenied si l'utilisateur n'est ni propriétaire ni administrateur."""
    membership = get_membership(room, user)
    if not membership or not membership.can_manage():
        raise PermissionDenied("Seuls le propriétaire et les administrateurs peuvent effectuer cette action.")
    return membership


def csrf_api_view(methods):
    """DRF marque normalement ses vues comme exemptes de CSRF.

    Les points d'entrée publics qui créent une session (connexion et
    inscription) doivent néanmoins être vérifiés par CsrfViewMiddleware.
    """

    def decorator(function):
        view = api_view(methods)(function)
        view.csrf_exempt = False
        return view

    return decorator


class MessageCursorPagination(CursorPagination):
    """Pagination par curseur pour l'historique des messages (chat).

    Les messages les plus récents arrivent en premier ; le curseur permet un
    chargement progressif fiable même quand des messages sont ajoutés
    pendant le défilement.
    """

    ordering = ("-created_at", "-id")
    page_size = 50
    max_page_size = 100


# ---------------------------------------------------------------------------
# Utilisateurs
# ---------------------------------------------------------------------------
class UserViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        friendship_pairs = Friendships.objects.filter(
            Q(sender=user, status="accepted") | Q(receiver=user, status="accepted")
        ).values_list("sender_id", "receiver_id")
        friend_ids = {person_id for pair in friendship_pairs for person_id in pair if person_id != user.id}
        # Le blocage supprime les amitiés : un ami listé ici ne peut pas être bloqué.
        return (
            User.objects.filter(id__in=friend_ids)
            .select_related("profile", "status", "email_verification", "totp")
            .order_by("username")
        )

    def get_throttles(self):
        if self.action == "search_new_friends":
            return [SearchRateThrottle()]
        return super().get_throttles()

    @action(detail=False, methods=["get"])
    def search_new_friends(self, request):
        query = request.query_params.get("q", "").strip()
        excluded_pairs = Friendships.objects.filter(Q(sender=request.user) | Q(receiver=request.user)).values_list(
            "sender_id", "receiver_id"
        )
        excluded = {person_id for pair in excluded_pairs for person_id in pair} | {request.user.id}
        blocked_pairs = BlockedUser.objects.filter(Q(blocker=request.user) | Q(blocked=request.user)).values_list(
            "blocker_id", "blocked_id"
        )
        excluded |= {person_id for pair in blocked_pairs for person_id in pair}
        people = (
            User.objects.exclude(id__in=excluded)
            .select_related("profile", "status", "email_verification", "totp")
            .order_by("username")
        )
        if query:
            people = people.filter(username__icontains=query)
        return Response(self.get_serializer(people[:20], many=True).data)

    @action(detail=False, methods=["get"])
    def blocked(self, request):
        blocked = BlockedUser.objects.filter(blocker=request.user).select_related(
            "blocked", "blocked__profile", "blocked__status"
        )
        return Response(BlockedUserSerializer(blocked, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def block(self, request, pk=None):
        try:
            target = User.objects.get(pk=pk)
        except (User.DoesNotExist, TypeError, ValueError):
            return Response({"error": "Utilisateur introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if target == request.user:
            return Response({"error": "Vous ne pouvez pas vous bloquer vous-même."}, status=status.HTTP_400_BAD_REQUEST)
        BlockedUser.objects.get_or_create(blocker=request.user, blocked=target)
        # Le blocage supprime toute amitié existante.
        Friendships.objects.filter(
            Q(sender=request.user, receiver=target) | Q(sender=target, receiver=request.user)
        ).delete()
        send_to_user(request.user.id, "user.blocked", {"user_id": target.id, "username": target.username})
        return Response({"status": "blocked"})

    @action(detail=True, methods=["post"])
    def unblock(self, request, pk=None):
        deleted, _ = BlockedUser.objects.filter(blocker=request.user, blocked_id=pk).delete()
        if not deleted:
            return Response({"error": "Utilisateur non bloqué."}, status=status.HTTP_404_NOT_FOUND)
        send_to_user(request.user.id, "user.unblocked", {"user_id": int(pk)})
        return Response({"status": "unblocked"})


# ---------------------------------------------------------------------------
# Salons
# ---------------------------------------------------------------------------
class RoomViewSet(viewsets.ModelViewSet):
    serializer_class = RoomSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return (
            self.request.user.rooms.filter(memberships__user=self.request.user, memberships__is_banned=False)
            .exclude(archived_by=self.request.user)
            .prefetch_related(
                Prefetch(
                    "participants",
                    queryset=User.objects.select_related("profile", "status", "email_verification", "totp"),
                ),
                Prefetch(
                    "memberships",
                    queryset=RoomMembership.objects.select_related(
                        "user", "user__profile", "user__status", "user__email_verification", "user__totp"
                    ),
                ),
            )
            .order_by("-updated_at")
        )

    def create(self, request, *args, **kwargs):
        participant_ids = request.data.get("participant_ids", [])
        if not isinstance(participant_ids, list) or not participant_ids:
            return Response({"error": "Sélectionnez au moins un ami."}, status=status.HTTP_400_BAD_REQUEST)
        participants = list(User.objects.filter(id__in=participant_ids))
        if len(participants) != len(set(participant_ids)) or any(
            not is_friend(request.user, user) or are_blocked(request.user, user) for user in participants
        ):
            return Response({"error": "Un salon ne peut inclure que vos amis."}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Une conversation avec un seul ami est un DM ; au-delà, c'est un groupe.
        is_group = len(participants) > 1
        with transaction.atomic():
            room = serializer.save(is_group=is_group)
            RoomMembership.objects.create(
                room=room, user=request.user, role=RoomMembership.ROLE_OWNER if is_group else RoomMembership.ROLE_MEMBER
            )
            for participant in participants:
                RoomMembership.objects.create(room=room, user=participant)
        if is_group:
            room.owner = request.user
            room.save(update_fields=["owner"])
            log_activity(room, request.user, ActivityLog.Action.MEMBER_JOINED, {"username": request.user.username})
        return Response(self.get_serializer(room).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        room = self.get_object()
        if not room.is_group:
            return Response(
                {"error": "Les discussions privées ne peuvent pas être modifiées."}, status=status.HTTP_400_BAD_REQUEST
            )
        membership = require_manager(room, request.user)
        if membership.is_muted or membership.is_banned:
            raise PermissionDenied("Vous ne pouvez pas modifier ce salon.")
        serializer = RoomUpdateSerializer(room, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changes = {}
        if "name" in serializer.validated_data and serializer.validated_data["name"] != room.name:
            changes["name"] = room.name
        if "description" in serializer.validated_data and serializer.validated_data["description"] != room.description:
            changes["description"] = room.description or ""
        if "avatar_file" in serializer.validated_data:
            changes["avatar"] = True
            room.avatar = serializer.validated_data.pop("avatar_file")
        room = serializer.save()
        if changes:
            actions = {
                "name": ActivityLog.Action.NAME_CHANGED,
                "description": ActivityLog.Action.DESCRIPTION_CHANGED,
                "avatar": ActivityLog.Action.AVATAR_CHANGED,
            }
            for key, action in actions.items():
                if key in changes:
                    log_activity(room, request.user, action)
            broadcast_room_updated(room, request)
        return Response(self.get_serializer(room).data)

    def destroy(self, request, *args, **kwargs):
        room = self.get_object()
        if not room.is_group:
            return Response(
                {"error": "Une discussion privée ne peut pas être supprimée ; archivez-la plutôt."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        membership = get_membership(room, request.user)
        if not membership or membership.role != RoomMembership.ROLE_OWNER:
            raise PermissionDenied("Seul le propriétaire peut supprimer le groupe.")
        send_to_room_group(room.id, "room.deleted", {"room_id": room.id})
        room.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"])
    def get_or_create_dm(self, request):
        other_user_id = request.data.get("user_id")
        try:
            other_user = User.objects.get(pk=other_user_id)
        except (User.DoesNotExist, TypeError, ValueError):
            return Response({"error": "Utilisateur introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if other_user == request.user:
            return Response(
                {"error": "Vous ne pouvez pas vous écrire à vous-même."}, status=status.HTTP_400_BAD_REQUEST
            )
        if are_blocked(request.user, other_user):
            return Response(
                {"error": "Vous ne pouvez pas discuter avec cet utilisateur."}, status=status.HTTP_403_FORBIDDEN
            )
        if not is_friend(request.user, other_user):
            return Response(
                {"error": "Vous devez être amis pour démarrer une discussion."}, status=status.HTTP_403_FORBIDDEN
            )
        room = (
            Room.objects.filter(is_group=False)
            .annotate(participant_count=Count("memberships"))
            .filter(participant_count=2, memberships__user=request.user)
            .filter(memberships__user=other_user)
            .first()
        )
        if room:
            return Response(self.get_serializer(room).data)
        with transaction.atomic():
            room = Room.objects.create(is_group=False)
            RoomMembership.objects.create(room=room, user=request.user)
            RoomMembership.objects.create(room=room, user=other_user)
        return Response(self.get_serializer(room).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def mark_as_read(self, request, pk=None):
        room = self.get_object()
        RoomVisit.objects.update_or_create(user=request.user, room=room, defaults={"last_visited": timezone.now()})
        send_to_user(request.user.id, "room.read", {"room_id": room.id})
        return Response({"status": "read"})

    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        room = self.get_object()
        memberships = room.memberships.select_related(
            "user", "user__profile", "user__status", "user__email_verification", "user__totp"
        )
        return Response(RoomMembershipSerializer(memberships, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def add_members(self, request, pk=None):
        room = self.get_object()
        if not room.is_group:
            return Response(
                {"error": "Les discussions privées n'acceptent pas de nouveaux membres."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        require_manager(room, request.user)
        user_ids = request.data.get("user_ids", [])
        if not isinstance(user_ids, list) or not user_ids:
            return Response({"error": "Sélectionnez au moins un utilisateur."}, status=status.HTTP_400_BAD_REQUEST)
        existing = set(room.memberships.values_list("user_id", flat=True))
        users = list(User.objects.filter(id__in=user_ids).exclude(id__in=existing))
        if len(users) != len(set(user_ids)):
            return Response(
                {"error": "Certains utilisateurs sont déjà membres ou introuvables."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            for user in users:
                RoomMembership.objects.create(room=room, user=user)
        for user in users:
            log_activity(room, request.user, ActivityLog.Action.MEMBER_ADDED, {"username": user.username})
            create_notification(
                user,
                Notification.Type.GROUP_INVITE,
                actor=request.user,
                room=room,
                data={"added_by": request.user.username},
            )
            send_to_user(user.id, "room.joined", {"room_id": room.id, "name": room.name})
        broadcast_room_updated(room, request)
        return Response({"added": [u.username for u in users]})

    @action(detail=True, methods=["post"])
    def remove_member(self, request, pk=None):
        room = self.get_object()
        if not room.is_group:
            return Response(
                {"error": "Impossible de retirer un membre d'une discussion privée."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        manager = require_manager(room, request.user)
        target_id = request.data.get("user_id")
        target = room.memberships.filter(user_id=target_id).first()
        if not target:
            return Response({"error": "Membre introuvable dans ce salon."}, status=status.HTTP_404_NOT_FOUND)
        if target.user_id == request.user.id:
            return Response({"error": "Utilisez « Quitter le salon » pour partir."}, status=status.HTTP_400_BAD_REQUEST)
        if not manager.can_manage_user(target):
            raise PermissionDenied("Vous ne pouvez pas retirer ce membre.")
        log_activity(room, request.user, ActivityLog.Action.MEMBER_REMOVED, {"username": target.user.username})
        send_to_user(target.user_id, "room.removed", {"room_id": room.id})
        target.delete()
        broadcast_room_updated(room, request)
        return Response({"status": "removed"})

    @action(detail=True, methods=["post"])
    def leave(self, request, pk=None):
        room = self.get_object()
        membership = get_membership(room, request.user)
        if not membership:
            return Response({"error": "Vous ne faites pas partie de ce salon."}, status=status.HTTP_404_NOT_FOUND)
        if room.is_group and membership.role == RoomMembership.ROLE_OWNER:
            return Response(
                {
                    "error": "Le propriétaire ne peut pas quitter le groupe : transférez la propriété ou supprimez le groupe."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        log_activity(room, request.user, ActivityLog.Action.MEMBER_LEFT, {"username": request.user.username})
        membership.delete()
        # Un salon sans membre (DM déserté) est supprimé.
        if not room.memberships.exists():
            send_to_room_group(room.id, "room.deleted", {"room_id": room.id})
            room.delete()
        else:
            broadcast_room_updated(room, request)
        return Response({"status": "left"})

    @action(detail=True, methods=["post"])
    def transfer_ownership(self, request, pk=None):
        room = self.get_object()
        membership = get_membership(room, request.user)
        if not membership or membership.role != RoomMembership.ROLE_OWNER:
            raise PermissionDenied("Seul le propriétaire peut transférer la propriété.")
        target = room.memberships.filter(user_id=request.data.get("user_id")).first()
        if not target or target.user_id == request.user.id:
            return Response({"error": "Membre destinataire invalide."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            membership.role = RoomMembership.ROLE_ADMIN
            membership.save(update_fields=["role"])
            target.role = RoomMembership.ROLE_OWNER
            target.save(update_fields=["role"])
            room.owner = target.user
            room.save(update_fields=["owner"])
        log_activity(
            room, request.user, ActivityLog.Action.ROLE_CHANGED, {"username": target.user.username, "role": "owner"}
        )
        broadcast_room_updated(room, request)
        return Response(self.get_serializer(room).data)

    @action(detail=True, methods=["post"])
    def set_role(self, request, pk=None):
        room = self.get_object()
        membership = get_membership(room, request.user)
        if not membership or membership.role != RoomMembership.ROLE_OWNER:
            raise PermissionDenied("Seul le propriétaire peut changer les rôles.")
        target = room.memberships.filter(user_id=request.data.get("user_id")).first()
        role = request.data.get("role")
        if role not in {RoomMembership.ROLE_ADMIN, RoomMembership.ROLE_MEMBER}:
            return Response({"error": "Rôle invalide (admin ou member)."}, status=status.HTTP_400_BAD_REQUEST)
        if not target or target.user_id == request.user.id:
            return Response({"error": "Membre invalide."}, status=status.HTTP_400_BAD_REQUEST)
        target.role = role
        target.save(update_fields=["role"])
        log_activity(
            room, request.user, ActivityLog.Action.ROLE_CHANGED, {"username": target.user.username, "role": role}
        )
        broadcast_room_updated(room, request)
        return Response({"status": "ok"})

    @action(detail=True, methods=["post"])
    def mute(self, request, pk=None):
        return self._toggle_member_flag(
            request, pk, "is_muted", (ActivityLog.Action.MEMBER_MUTED, ActivityLog.Action.MEMBER_UNMUTED)
        )

    @action(detail=True, methods=["post"])
    def ban(self, request, pk=None):
        response = self._toggle_member_flag(
            request, pk, "is_banned", (ActivityLog.Action.MEMBER_BANNED, ActivityLog.Action.MEMBER_UNBANNED)
        )
        room = self.get_object()
        target = room.memberships.filter(user_id=request.data.get("user_id")).first()
        if target and target.is_banned:
            send_to_user(target.user_id, "room.removed", {"room_id": room.id})
        return response

    def _toggle_member_flag(self, request, pk, flag_name, log_actions):
        room = self.get_object()
        manager = require_manager(room, request.user)
        target = room.memberships.filter(user_id=request.data.get("user_id")).first()
        if not target:
            return Response({"error": "Membre introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if not manager.can_manage_user(target):
            raise PermissionDenied("Vous ne pouvez pas agir sur ce membre.")
        new_value = not getattr(target, flag_name)
        setattr(target, flag_name, new_value)
        target.save(update_fields=[flag_name])
        log_activity(
            room, request.user, log_actions[1] if not new_value else log_actions[0], {"username": target.user.username}
        )
        broadcast_room_updated(room, request)
        return Response({"status": "ok", flag_name: new_value})

    @action(detail=True, methods=["post"])
    def invite_link(self, request, pk=None):
        room = self.get_object()
        require_manager(room, request.user)
        if not room.is_group:
            return Response(
                {"error": "Les discussions privées n'ont pas de lien d'invitation."}, status=status.HTTP_400_BAD_REQUEST
            )
        invite_url = room.get_or_create_invite_link(request=request)
        log_activity(room, request.user, ActivityLog.Action.INVITE_LINK_CREATED)
        return Response({"invite_url": invite_url})

    @action(detail=False, methods=["post"])
    def join(self, request):
        token = request.data.get("token", "")
        try:
            room = Room.objects.get(invite_token=uuid.UUID(str(token)))
        except (ValueError, Room.DoesNotExist):
            return Response({"error": "Lien d'invitation invalide."}, status=status.HTTP_404_NOT_FOUND)
        if room.invite_expires_at and room.invite_expires_at < timezone.now():
            return Response({"error": "Ce lien d'invitation a expiré."}, status=status.HTTP_400_BAD_REQUEST)
        membership = get_membership(room, request.user)
        if membership and membership.is_banned:
            return Response({"error": "Vous avez été banni de ce groupe."}, status=status.HTTP_403_FORBIDDEN)
        if membership:
            return Response(self.get_serializer(room).data)
        RoomMembership.objects.create(room=room, user=request.user)
        log_activity(room, request.user, ActivityLog.Action.MEMBER_JOINED, {"username": request.user.username})
        broadcast_room_updated(room, request)
        return Response(self.get_serializer(room).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        # Un salon archivé est masqué de la liste : on le recherche sans ce filtre.
        room = Room.objects.filter(pk=pk, memberships__user=request.user, memberships__is_banned=False).first()
        if not room:
            return Response({"error": "Salon introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if room.archived_by.filter(pk=request.user.pk).exists():
            room.archived_by.remove(request.user)
            return Response({"archived": False})
        room.archived_by.add(request.user)
        return Response({"archived": True})

    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None):
        room = self.get_object()
        logs = room.activity_logs.select_related(
            "user", "user__profile", "user__status", "user__email_verification", "user__totp"
        )
        page = self.paginate_queryset(logs)
        serializer = ActivityLogSerializer(page, many=True, context={"request": request})
        return self.get_paginated_response(serializer.data)


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------
class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = MessageCursorPagination
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_throttles(self):
        if self.action == "create" or self.request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            return [MessageSendRateThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        user = self.request.user
        queryset = (
            Message.objects.filter(room__memberships__user=user, room__memberships__is_banned=False)
            .select_related(
                "sender",
                "sender__profile",
                "sender__status",
                "sender__email_verification",
                "sender__totp",
                "room",
                "parent__sender",
            )
            .prefetch_related("attachments", "reactions", "read_receipts")
        )
        room_id = self.request.query_params.get("room_id")
        if room_id:
            queryset = queryset.filter(room_id=room_id)
        author_id = self.request.query_params.get("author_id")
        if author_id:
            queryset = queryset.filter(sender_id=author_id)
        since = self.request.query_params.get("since")
        if since:
            parsed = parse_datetime(since)
            if parsed is None:
                raise ValidationError({"error": "Paramètre « since » invalide (ISO 8601 attendu)."})
            queryset = queryset.filter(created_at__gte=parsed)
        until = self.request.query_params.get("until")
        if until:
            parsed = parse_datetime(until)
            if parsed is None:
                raise ValidationError({"error": "Paramètre « until » invalide (ISO 8601 attendu)."})
            queryset = queryset.filter(created_at__lte=parsed)
        search_query = self.request.query_params.get("search", "").strip()
        if search_query:
            queryset = queryset.filter(content__icontains=search_query)
        return queryset.distinct()

    def _get_room_and_membership(self, room):
        membership = get_membership(room, self.request.user)
        if not membership or membership.is_banned:
            raise PermissionDenied("Vous ne participez pas à ce salon.")
        return membership

    def perform_create(self, serializer):
        room = serializer.validated_data["room"]
        membership = self._get_room_and_membership(room)
        if membership.is_muted:
            raise PermissionDenied("Vous êtes en sourdine dans ce salon.")
        parent = serializer.validated_data.get("parent")
        if parent and parent.room_id != room.id:
            raise ValidationError({"parent": "Le message cité doit appartenir au même salon."})
        if parent and parent.is_deleted:
            raise ValidationError({"parent": "Impossible de répondre à un message supprimé."})
        # Les pièces jointes sont extraites avant l'enregistrement du message,
        # puis rattachées dans la même transaction.
        files = serializer.validated_data.pop("files", [])
        with transaction.atomic():
            message = serializer.save(sender=self.request.user)
            from .models import MessageAttachment

            for file in files:
                MessageAttachment.objects.create(
                    message=message,
                    file=file,
                    original_name=file.name[:255],
                    content_type=(file.content_type or "")[:255],
                    size=file.size,
                )
        touch_room(room)
        # Notification « réponse » à l'auteur du message parent.
        if parent and parent.sender_id != self.request.user.id:
            create_notification(
                parent.sender,
                Notification.Type.REPLY,
                actor=self.request.user,
                room=room,
                message=message,
                data={"content_preview": (message.content or "")[:120]},
            )
        notify_mentions(message, self.request.user, self.request)
        broadcast_message_created(message, self.request)
        return message

    def update(self, request, *args, **kwargs):
        message = self.get_object()
        if message.is_deleted:
            raise ValidationError({"error": "Un message supprimé ne peut pas être modifié."})
        if message.sender_id != request.user.id:
            raise PermissionDenied("Vous ne pouvez modifier que vos propres messages.")
        serializer = self.get_serializer(message, data={"content": request.data.get("content", "")}, partial=True)
        serializer.is_valid(raise_exception=True)
        message = serializer.save(edited_at=timezone.now())
        broadcast_message_updated(message, request, "message.edited")
        return Response(self.get_serializer(message).data)

    def destroy(self, request, *args, **kwargs):
        message = self.get_object()
        room = message.room
        is_owner = message.sender_id == request.user.id
        if not is_owner:
            membership = get_membership(room, request.user)
            if not (membership and membership.can_manage()):
                raise PermissionDenied("Vous ne pouvez supprimer que vos propres messages.")
        message.is_deleted = True
        message.is_pinned = False
        message.save(update_fields=["is_deleted", "is_pinned", "updated_at"])
        send_to_room_group(room.id, "message.deleted", {"room_id": room.id, "message_id": message.id})
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def react(self, request, pk=None):
        message = self.get_object()
        self._get_room_and_membership(message.room)
        emoji = str(request.data.get("emoji", "")).strip()
        if not (1 <= len(emoji) <= 8) or any(ord(char) < 32 for char in emoji):
            return Response({"error": "Émoji invalide."}, status=status.HTTP_400_BAD_REQUEST)
        reaction, created = message.reactions.get_or_create(user=request.user, emoji=emoji)
        if not created:
            return Response({"status": "already"}, status=status.HTTP_200_OK)
        self._broadcast_reactions(message)
        return Response({"status": "added"}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="unreact")
    def unreact(self, request, pk=None):
        message = self.get_object()
        self._get_room_and_membership(message.room)
        emoji = str(request.data.get("emoji", "")).strip()
        deleted, _ = message.reactions.filter(user=request.user, emoji=emoji).delete()
        if not deleted:
            return Response({"error": "Réaction introuvable."}, status=status.HTTP_404_NOT_FOUND)
        self._broadcast_reactions(message)
        return Response({"status": "removed"})

    def _broadcast_reactions(self, message):
        serializer = self.get_serializer(message)
        send_to_room_group(
            message.room_id,
            "message.reactions_changed",
            {"room_id": message.room_id, "message_id": message.id, "reactions": serializer.data["reactions"]},
        )

    @action(detail=True, methods=["post"])
    def pin(self, request, pk=None):
        message = self.get_object()
        room = message.room
        self._get_room_and_membership(room)
        if message.is_deleted:
            return Response({"error": "Impossible d'épingler un message supprimé."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            room.messages.filter(is_pinned=True).update(is_pinned=False)
            message.is_pinned = True
            message.save(update_fields=["is_pinned", "updated_at"])
        broadcast_message_updated(message, request, "message.pinned")
        send_to_room_group(room.id, "room.pinned_changed", {"room_id": room.id, "message_id": message.id})
        return Response({"status": "pinned"})

    @action(detail=True, methods=["post"], url_path="unpin")
    def unpin(self, request, pk=None):
        message = self.get_object()
        self._get_room_and_membership(message.room)
        if not message.is_pinned:
            return Response({"error": "Ce message n'est pas épinglé."}, status=status.HTTP_400_BAD_REQUEST)
        message.is_pinned = False
        message.save(update_fields=["is_pinned", "updated_at"])
        send_to_room_group(message.room_id, "room.pinned_changed", {"room_id": message.room_id, "message_id": None})
        return Response({"status": "unpinned"})

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        message = self.get_object()
        self._get_room_and_membership(message.room)
        if message.sender_id == request.user.id:
            return Response({"status": "own-message"})
        MessageReadReceipt.objects.get_or_create(message=message, user=request.user)
        send_to_room_group(
            message.room_id,
            "receipts.updated",
            {"room_id": message.room_id, "user_id": request.user.id, "message_ids": [message.id]},
        )
        return Response({"status": "read"})

    @action(detail=True, methods=["get"])
    def receipts(self, request, pk=None):
        message = self.get_object()
        self._get_room_and_membership(message.room)
        receipts = message.read_receipts.exclude(user_id=message.sender_id).select_related(
            "user", "user__profile", "user__status"
        )
        return Response(
            {
                "message_id": message.id,
                "read_by": [
                    {"user": UserSerializer(r.user, context={"request": request}).data, "read_at": r.read_at}
                    for r in receipts
                ],
            }
        )


# ---------------------------------------------------------------------------
# Amitiés
# ---------------------------------------------------------------------------
class FriendshipViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = FriendshipsSerializer
    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        if self.action == "send_request":
            return [FriendRequestRateThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        return (
            Friendships.objects.filter(Q(sender=self.request.user) | Q(receiver=self.request.user))
            .select_related(
                "sender",
                "sender__profile",
                "sender__status",
                "sender__email_verification",
                "sender__totp",
                "receiver",
                "receiver__profile",
                "receiver__status",
                "receiver__email_verification",
                "receiver__totp",
            )
            .order_by("-updated_at")
        )

    @action(detail=False, methods=["post"])
    def send_request(self, request):
        try:
            receiver = User.objects.get(pk=request.data.get("receiver_id"))
        except (User.DoesNotExist, TypeError, ValueError):
            return Response({"error": "Utilisateur destinataire introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if receiver == request.user:
            return Response(
                {"error": "Vous ne pouvez pas vous ajouter vous-même en ami."}, status=status.HTTP_400_BAD_REQUEST
            )
        if are_blocked(request.user, receiver):
            return Response(
                {"error": "Cette action est impossible avec un utilisateur bloqué."}, status=status.HTTP_403_FORBIDDEN
            )
        if Friendships.objects.filter(
            Q(sender=request.user, receiver=receiver) | Q(sender=receiver, receiver=request.user)
        ).exists():
            return Response({"error": "Une demande d'ami existe déjà entre vous."}, status=status.HTTP_400_BAD_REQUEST)
        friendship = Friendships.objects.create(sender=request.user, receiver=receiver)
        create_notification(receiver, Notification.Type.FRIEND_REQUEST, actor=request.user)
        send_to_user(
            receiver.id,
            "friendship.requested",
            {"friendship_id": friendship.id, "from_username": request.user.username},
        )
        return Response(self.get_serializer(friendship).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        friendship = self.get_object()
        if friendship.receiver != request.user:
            return Response(
                {"error": "Seul le destinataire peut accepter cette demande."}, status=status.HTTP_403_FORBIDDEN
            )
        if friendship.status != "pending":
            return Response({"error": "Cette demande a déjà été traitée."}, status=status.HTTP_400_BAD_REQUEST)
        friendship.status = "accepted"
        friendship.save(update_fields=["status", "updated_at"])
        create_notification(friendship.sender, Notification.Type.FRIEND_ACCEPTED, actor=request.user)
        send_to_user(
            friendship.sender_id,
            "friendship.accepted",
            {"friendship_id": friendship.id, "username": request.user.username},
        )
        return Response(self.get_serializer(friendship).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        friendship = self.get_object()
        if friendship.status != "pending":
            return Response({"error": "Cette demande a déjà été traitée."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user not in (friendship.sender, friendship.receiver):
            return Response({"error": "Action non autorisée."}, status=status.HTTP_403_FORBIDDEN)
        friendship.status = "rejected"
        friendship.save(update_fields=["status", "updated_at"])
        other = friendship.sender if request.user == friendship.receiver else friendship.receiver
        create_notification(other, Notification.Type.FRIEND_REJECTED, actor=request.user)
        return Response(self.get_serializer(friendship).data)


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user).select_related(
            "actor", "actor__profile", "actor__status", "room", "message"
        )

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        count = self.get_queryset().filter(read_at__isnull=True).count()
        return Response({"unread_count": count})

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.read_at = timezone.now()
        notification.save(update_fields=["read_at"])
        return Response({"status": "read"})

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"status": "all-read"})


# ---------------------------------------------------------------------------
# Authentification et compte
# ---------------------------------------------------------------------------
@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def csrf_view(request):
    return Response({"csrfToken": get_token(request)})


@csrf_api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle])
def login_view(request):
    user = authenticate(
        request,
        username=str(request.data.get("username", "")).strip(),
        password=str(request.data.get("password", "")),
    )
    if not user:
        return Response({"error": "Identifiants invalides."}, status=status.HTTP_400_BAD_REQUEST)
    # Deuxième facteur (TOTP) si activé sur le compte.
    if UserTOTP.objects.filter(user=user, is_enabled=True).exists():
        from django.core.cache import cache

        from .accounts import pending_2fa_key

        pending_token = uuid.uuid4()
        cache.set(pending_2fa_key(pending_token), user.id, timeout=300)
        return Response({"requires_2fa": True, "token": str(pending_token)})
    login(request, user)
    return Response({"message": "Connexion réussie !", "user": UserSerializer(user, context={"request": request}).data})


@api_view(["POST"])
def logout_view(request):
    logout(request)
    return Response({"message": "Déconnexion réussie !"})


@api_view(["GET"])
def me_view(request):
    return Response(UserSerializer(request.user, context={"request": request}).data)


@csrf_api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([RegisterRateThrottle])
def register_view(request):
    username = str(request.data.get("username", "")).strip()
    email = str(request.data.get("email", "")).strip()
    password = request.data.get("password")
    if not username or not password:
        return Response(
            {"error": "Le nom d'utilisateur et le mot de passe sont requis."}, status=status.HTTP_400_BAD_REQUEST
        )
    if password != request.data.get("password_confirm"):
        return Response({"error": "Les mots de passe ne correspondent pas."}, status=status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(username__iexact=username).exists():
        return Response({"error": "Ce nom d'utilisateur est déjà pris."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        validate_password(password, user=User(username=username, email=email))
    except DjangoValidationError as exc:
        return Response({"error": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
    try:
        user = User.objects.create_user(username=username, email=email, password=password)
    except IntegrityError:
        return Response({"error": "Ce nom d'utilisateur est déjà pris."}, status=status.HTTP_400_BAD_REQUEST)
    # Vérification d'adresse e-mail (non bloquante, e-mail envoyé en arrière-plan).
    if user.email:
        from .emails import send_verification_email
        from .models import EmailVerificationToken

        verification = EmailVerificationToken.objects.create(user=user)
        send_verification_email(user, verification.token)
    login(request, user)
    return Response(
        {
            "message": "Utilisateur créé et connecté avec succès",
            "user": UserSerializer(user, context={"request": request}).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
def heartbeat_view(request):
    """Repli HTTP quand le WebSocket est indisponible (frappe et présence)."""
    room_id = request.data.get("typing_in_room_id")
    typing_room = Room.objects.filter(pk=room_id, memberships__user=request.user).first() if room_id else None
    status_object, _ = UserStatus.objects.get_or_create(user=request.user)
    status_object.typing_in = typing_room
    status_object.save()
    return Response({"status": "ok"})


@api_view(["PUT", "PATCH"])
@parser_classes([MultiPartParser, FormParser])
def update_profile_view(request):
    profile, _ = Profile.objects.get_or_create(user=request.user)
    serializer = ProfileUpdateSerializer(profile, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(UserSerializer(request.user, context={"request": request}).data)


# ---------------------------------------------------------------------------
# Sonde de santé
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([AllowAny])
def health_view(request):
    """Vérifie la base de données et le cache ; utilisé par Docker/Nginx et les orchestrateurs."""
    from django.core.cache import cache as django_cache
    from django.db import connection

    checks = {}
    try:
        connection.ensure_connection()
        checks["database"] = True
    except Exception:
        checks["database"] = False
    try:
        cache_key = "health:check"
        django_cache.set(cache_key, "ok", timeout=5)
        checks["cache"] = django_cache.get(cache_key) == "ok"
    except Exception:
        checks["cache"] = False
    healthy = checks["database"]
    return Response(
        {"status": "ok" if healthy else "degraded", "checks": checks},
        status=status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
    )
