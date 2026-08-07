from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from django.contrib.auth.models import User
from .models import Room, Message
from .serializers import UserSerializer, RoomSerializer, MessageSerializer
from django.contrib.auth import authenticate, login, logout
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = User.objects.all().order_by('username')
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return User.objects.exclude(id=self.request.user.id).order_by('username')


class RoomViewSet(viewsets.ModelViewSet):
    serializer_class = RoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.request.user.rooms.all().order_by('-updated_at')
    def perform_create(self, serializer):
        room = serializer.save()
        if self.request.user not in room.participants.all():
            room.participants.add(self.request.user)

class MessageViewSet(viewsets.ModelViewSet):

    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset= Message.objects.all()
        room_id = self.request.query_params.get('room_id')
        if room_id is not None:
            try: 
                room = Room.objects.get(id= room_id, participants= self.request.user)
                queryset = queryset.filter(room=room)
            except Room.DoesNotExist:
                return Message.objects.none()
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
