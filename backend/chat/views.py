from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Friendships, Message, Profile, Room, RoomVisit, UserStatus
from .serializers import FriendshipsSerializer, MessageSerializer, ProfileUpdateSerializer, RoomSerializer, UserSerializer


def is_friend(user, other_user):
    return Friendships.objects.filter(
        Q(sender=user, receiver=other_user, status="accepted") | Q(sender=other_user, receiver=user, status="accepted")
    ).exists()


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


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        friendship_pairs = Friendships.objects.filter(
            Q(sender=user, status="accepted") | Q(receiver=user, status="accepted")
        ).values_list("sender_id", "receiver_id")
        friend_ids = {person_id for pair in friendship_pairs for person_id in pair if person_id != user.id}
        return User.objects.filter(id__in=friend_ids).select_related("profile", "status").order_by("username")

    @action(detail=False, methods=["get"])
    def search_new_friends(self, request):
        query = request.query_params.get("q", "").strip()
        excluded_ids = Friendships.objects.filter(Q(sender=request.user) | Q(receiver=request.user)).values_list("sender_id", "receiver_id")
        excluded = {person_id for pair in excluded_ids for person_id in pair} | {request.user.id}
        people = User.objects.exclude(id__in=excluded).select_related("profile", "status").order_by("username")
        if query:
            people = people.filter(username__icontains=query)
        return Response(self.get_serializer(people[:20], many=True).data)


class RoomViewSet(viewsets.ModelViewSet):
    serializer_class = RoomSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return self.request.user.rooms.prefetch_related(
            Prefetch("participants", queryset=User.objects.select_related("profile", "status"))
        ).order_by("-updated_at")

    def create(self, request, *args, **kwargs):
        participant_ids = request.data.get("participant_ids", [])
        if not isinstance(participant_ids, list) or not participant_ids:
            return Response({"error": "Sélectionnez au moins un ami."}, status=status.HTTP_400_BAD_REQUEST)
        participants = list(User.objects.filter(id__in=participant_ids))
        if len(participants) != len(set(participant_ids)) or any(not is_friend(request.user, user) for user in participants):
            return Response({"error": "Un salon ne peut inclure que vos amis."}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Une conversation avec un seul ami est un DM ; au-delà, c'est un groupe.
        room = serializer.save(is_group=len(participants) > 1)
        room.participants.add(request.user, *participants)
        return Response(self.get_serializer(room).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def get_or_create_dm(self, request):
        other_user_id = request.data.get("user_id")
        try:
            other_user = User.objects.get(pk=other_user_id)
        except (User.DoesNotExist, TypeError, ValueError):
            return Response({"error": "Utilisateur introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if other_user == request.user:
            return Response({"error": "Vous ne pouvez pas vous écrire à vous-même."}, status=status.HTTP_400_BAD_REQUEST)
        if not is_friend(request.user, other_user):
            return Response({"error": "Vous devez être amis pour démarrer une discussion."}, status=status.HTTP_403_FORBIDDEN)
        room = Room.objects.filter(is_group=False).annotate(participant_count=Count("participants")).filter(participant_count=2).filter(participants=request.user).filter(participants=other_user).first()
        if room:
            return Response(self.get_serializer(room).data)
        with transaction.atomic():
            room = Room.objects.create(is_group=False)
            room.participants.add(request.user, other_user)
        return Response(self.get_serializer(room).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def mark_as_read(self, request, pk=None):
        room = self.get_object()
        RoomVisit.objects.update_or_create(user=request.user, room=room, defaults={"last_visited": timezone.now()})
        return Response({"status": "read"})


class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = Message.objects.filter(room__participants=self.request.user).select_related("sender", "sender__profile", "sender__status", "room")
        room_id = self.request.query_params.get("room_id")
        if room_id:
            queryset = queryset.filter(room_id=room_id)
        search_query = self.request.query_params.get("search", "").strip()
        if search_query:
            queryset = queryset.filter(content__icontains=search_query)
        return queryset.distinct()

    def perform_create(self, serializer):
        room = serializer.validated_data["room"]
        if not room.participants.filter(pk=self.request.user.pk).exists():
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Vous ne participez pas à ce salon.")
        serializer.save(sender=self.request.user)
        Room.objects.filter(pk=room.pk).update(updated_at=timezone.now())


class FriendshipViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = FriendshipsSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Friendships.objects.filter(Q(sender=self.request.user) | Q(receiver=self.request.user)).select_related(
            "sender", "sender__profile", "sender__status", "receiver", "receiver__profile", "receiver__status"
        ).order_by("-updated_at")

    @action(detail=False, methods=["post"])
    def send_request(self, request):
        try:
            receiver = User.objects.get(pk=request.data.get("receiver_id"))
        except (User.DoesNotExist, TypeError, ValueError):
            return Response({"error": "Utilisateur destinataire introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if receiver == request.user:
            return Response({"error": "Vous ne pouvez pas vous ajouter vous-même en ami."}, status=status.HTTP_400_BAD_REQUEST)
        if Friendships.objects.filter(Q(sender=request.user, receiver=receiver) | Q(sender=receiver, receiver=request.user)).exists():
            return Response({"error": "Une demande d'ami existe déjà entre vous."}, status=status.HTTP_400_BAD_REQUEST)
        friendship = Friendships.objects.create(sender=request.user, receiver=receiver)
        return Response(self.get_serializer(friendship).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        friendship = self.get_object()
        if friendship.receiver != request.user:
            return Response({"error": "Seul le destinataire peut accepter cette demande."}, status=status.HTTP_403_FORBIDDEN)
        if friendship.status != "pending":
            return Response({"error": "Cette demande a déjà été traitée."}, status=status.HTTP_400_BAD_REQUEST)
        friendship.status = "accepted"
        friendship.save(update_fields=["status", "updated_at"])
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
        return Response(self.get_serializer(friendship).data)


@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def csrf_view(request):
    return Response({"csrfToken": get_token(request)})


@csrf_api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    user = authenticate(request, username=request.data.get("username", ""), password=request.data.get("password", ""))
    if not user:
        return Response({"error": "Identifiants invalides."}, status=status.HTTP_400_BAD_REQUEST)
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
def register_view(request):
    username = str(request.data.get("username", "")).strip()
    email = str(request.data.get("email", "")).strip()
    password = request.data.get("password")
    if not username or not password:
        return Response({"error": "Le nom d'utilisateur et le mot de passe sont requis."}, status=status.HTTP_400_BAD_REQUEST)
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
    login(request, user)
    return Response({"message": "Utilisateur créé et connecté avec succès", "user": UserSerializer(user, context={"request": request}).data}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def heartbeat_view(request):
    room_id = request.data.get("typing_in_room_id")
    typing_room = Room.objects.filter(pk=room_id, participants=request.user).first() if room_id else None
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
