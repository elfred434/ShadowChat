from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from django.contrib.auth.models import User
from .models import Room, Message, Friendships, UserStatus, Profile, RoomVisit
from .serializers import UserSerializer, RoomSerializer, MessageSerializer, FriendshipsSerializer
from django.contrib.auth import authenticate, login, logout
from rest_framework.decorators import api_view, permission_classes, authentication_classes, action, parser_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.db.models import Q
from rest_framework.parsers import MultiPartParser, FormParser
from django.utils import timezone
class UserViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = User.objects.all().order_by('username')
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        friend_ids = Friendships.objects.filter(
            Q(sender=user, status='accepted') | Q(receiver=user, status='accepted')
        ).values_list('sender_id', 'receiver_id')

        friend_flat = set()
        for s, r in friend_ids:
            if s != user.id: friend_flat.add(s)
            if r != user.id: friend_flat.add(r)

        return User.objects.filter(id__in=friend_flat).order_by('username')
        # return User.objects.exclude(id=self.request.user.id).order_by('username')
    @action(detail=False, methods=['get'])
    def search_new_friends(self, request):
        user = request.user
        query = request.query_params.get('q', '')

        sent_ids = Friendships.objects.filter(sender=user).values_list('receiver_id', flat=True)
        received_ids = Friendships.objects.filter(receiver=user).values_list('sender_id', flat=True)

        excuded_ids = list(sent_ids) + list(received_ids) + [user.id]

        new_people = User.objects.exclude(id__in=excuded_ids)

        if query:
            new_people = new_people.filter(username__icontains=query)

        serializer = self.get_serializer(new_people[:20], many=True)
        return Response(serializer.data)

class RoomViewSet(viewsets.ModelViewSet):
    serializer_class = RoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.request.user.rooms.all().order_by('-updated_at')
    def perform_create(self, serializer):
        room = serializer.save()
        if self.request.user not in room.participants.all():
            room.participants.add(self.request.user)
    @action(detail=False, methods=['post'])
    def get_or_create_dm(self, request):
        other_user_id = request.data.get('user_id')
        if not other_user_id:
            return Response({'error': 'L\'identifiant de l\'utilisateur (user_id) est requis.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            other_user = User.objects.get(id=other_user_id)
        except User.DoesNotExist:
            return Response({'error': 'Utilisateur introuvable.'}, status=status.HTTP_404_NOT_FOUND)

        if other_user == request.user:
            return Response({'error': 'Vous ne pouvez pas crééer de discussion privé avec vous même'}, status=status.HTTP_400_BAD_REQUEST)

        existing_room = Room.objects.filter(
            is_group=False,
            participants= request.user
        ).filter(
            participants=other_user
        ).first()

        if existing_room:
            serializer = self.get_serializer(existing_room)
            return Response(serializer.data, status=status.HTTP_200_OK)

        new_room = Room.objects.create(is_group=False)
        new_room.participants.add(request.user, other_user)

        serializer = self.get_serializer(new_room)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    @action(detail=True, methods=['post'])
    def mark_as_read(self, request, pk=None):
        room = self.get_object()

        RoomVisit.objects.update_or_create(
            user = request.user,
            room = room,
            defaults={'last_visited': timezone.now()}
        )
        return Response({'status': 'read'}, status=status.HTTP_200_OK)
    
class MessageViewSet(viewsets.ModelViewSet):

    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset= Message.objects.all()
        room_id = self.request.query_params.get('room_id')
        search_query = self.request.query_params.get('search')
        if room_id is not None:
            try: 
                room = Room.objects.get(id= room_id, participants= self.request.user)
                queryset = queryset.filter(room=room)
            except Room.DoesNotExist:
                return Message.objects.none()
        if search_query:
            queryset = queryset.filter(content__icontains=search_query)
            
        return queryset

    def perform_create(self, serializer):
        message = serializer.save(sender=self.request.user)
        message.room.save()


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def login_view(request):
    username = request.data.get('username')
    password = request.data.get('password')

    user = authenticate(request, username=username, password=password)

    if user is not None:
        login(request, user)
        return Response({
            'message': 'Connexion réussie !',
            'user': UserSerializer(user).data
        }, status=status.HTTP_200_OK)
    return Response({
        'error': 'Identifiants invelides.'
    }, status=status.HTTP_400_BAD_REQUEST)

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    logout(request)
    return Response({'message': 'Déconnexion réussie !'}, status=status.HTTP_200_OK)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    return Response(UserSerializer(request.user).data)

class FriendshipViewSet(viewsets.ModelViewSet):
    serializer_class = FriendshipsSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        return Friendships.objects.filter(Q(sender=user) | Q(receiver=user))

    @action(detail=False, methods=['post'])
    def send_request(self, request):
        receiver_id = request.data.get('receiver_id')
        if not receiver_id:
            return Response({'error': 'receiver_id est requise'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            receiver = User.objects.get(id=receiver_id)
        except User.DoesNotExist:
            return Response({'error': 'Utilisateur destinataire introuvable'}, status=status.HTTP_400_BAD_REQUEST)

        if receiver == request.user:
            return Response({'error': 'Vous ne pouvez pas vous ajouter vous-même en ami'}, status=status.HTTP_400_BAD_REQUEST)

        exisisting_friendship = Friendships.objects.filter( 
            Q(sender=request.user, receiver=receiver) | Q(sender=receiver, receiver=request.user)
        ).first()

        if exisisting_friendship:
            return Response({
                'error': 'Une demande d\'ami existe déjà entre vous',
                'status': exisisting_friendship.status
            }, status=status.HTTP_400_BAD_REQUEST)

        friendship = Friendships.objects.create(sender= request.user, receiver=receiver, status='pending')
        serializer= self.get_serializer(friendship)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def accept(self, request, pk=None):
        friendship= self.get_object()

        if friendship.receiver != request.user:
            return Response({'error': 'Vous ne pouvez pas accepter une demande que vous n\'avez pas reçus. '}, status=status.HTTP_403_FORBIDDEN)
        if friendship.status != 'pending':
            return Response({'error': f"Cette demande est déjà {friendship.get_status_display().lower()}."}, status=status.HTTP_400_BAD_REQUEST)

        friendship.status = 'accepted'
        friendship.save()
        return Response({'message': 'Demande d\'ami acceptée !', 'status': 'accepted'})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        friendship = self.get_object()

        if friendship.sender != request.user and friendship.receiver != request.user:
            return Response({'error': 'Action non autorisée'}, status=status.HTTP_403_FORBIDDEN)

        friendship.status = 'rejected'
        friendship.save()
        return Response({'message': 'Demande d\'ami refusé/annulée', 'status': 'rejected'}) 
@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def register_view(request):
    username = request.data.get('username')
    email = request.data.get('email', '')
    password = request.data.get('password')
    password_confirm = request.data.get('password_confirm')

    if not username or not password:
        return Response({'error': 'Le nom d\'utilisateur et le mots de passe sont requis.'}, status=status.HTTP_400_BAD_REQUEST)

    if len(password) < 6:
        return Response({'error': 'Le mot de passe doit contenir au moins six caractères'}, status=status.HTTP_400_BAD_REQUEST)

    if password != password_confirm:
        return Response({'error': 'les mots de passe ne correspondent pas'}, status=status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(username__iexact=username).exists():
        return Response({'error': 'Ce nom d\'utilisateur est déjà pris' }, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password
        )

        login(request, user)

        return Response({
            'message': 'Utilisateur créé et connecté avec succès',
            'user': UserSerializer(user).data
        }, status=status.HTTP_201_CREATED)
    except Exception as e:
        return Response({'error': f'Une erreur est survenue lors de l\'inscription : {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def heartbeat_view(request):
    typing_in_id = request.data.get('typing_in_room_id')

    user_status, created = UserStatus.objects.get_or_create(user=request.user)

    user_status.save()

    if typing_in_id:
        try:
            room = Room.objects.get(id=typing_in_id, participants=request.user)
            user_status.typing_in = room
        except Room.DoesNotExist:
            user_status.typing_in = None

    else:
        user_status.typing_in = None

    user_status.save()
    return Response({'status': 'ok'}, status=status.HTTP_200_OK)

@api_view(['PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def update_profile_view(request):
    user = request.user
    profile, created  = Profile.objects.get_or_create(user=user)

    bio = request.data.get('bio')
    status_text = request.data.get('status_text')
    avatar = request.FILES.get('avatar')

    if bio is not None:
        profile.bio = bio
    if status_text is not None:
        profile.status_text = status_text
    if avatar is not None:
        profile.avatar = avatar

    profile.save()

    serializer = UserSerializer(user, context={'request': request})
    return Response(serializer.data, status=status.HTTP_200_OK)
