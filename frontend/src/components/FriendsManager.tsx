import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getFriendships,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  searchNewFriends,
} from '../api/friendships';
import { getCurrentUser } from '../api/auth';
import { UserPlus, Check, X, Search, Clock, Users, MessageSquare } from 'lucide-react';
import {getOrCreateDM} from '../api/room';

export function FriendsManager({onStartChat}: {onStartChat: (room: any) => void}) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Récupérer l'utilisateur connecté
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
  });

  // 2. Charger toutes nos relations d'amitié (toutes les 5s en arrière-plan)
  const { data: friendships = [], isLoading } = useQuery({
    queryKey: ['friendships'],
    queryFn: getFriendships,
    refetchInterval: 5000,
  });

  // 3. Rechercher de nouveaux amis potentiels en fonction de la saisie
  const { data: searchResults = [] } = useQuery({
    queryKey: ['newFriendsSearch', searchQuery],
    queryFn: () => searchNewFriends(searchQuery),
    enabled: searchQuery.length > 0, // Ne cherche que si l'utilisateur saisit quelque chose
  });

  // 4. Mutation pour envoyer une invitation
  const sendRequestMutation = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] });
      queryClient.invalidateQueries({ queryKey: ['newFriendsSearch', searchQuery] });
    },
  });

  // 5. Mutation pour accepter une demande
  const acceptMutation = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] }); // Recalcule la liste de chat
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  // 6. Mutation pour refuser/annuler une demande
  const rejectMutation = useMutation({
    mutationFn: rejectFriendRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] });
    },
  });

  // Filtrage des amitiés par statuts
  const friends = friendships.filter((f) => f.status === 'accepted');
  const receivedRequests = friendships.filter(
    (f) => f.status === 'pending' && f.receiver.id === currentUser?.id
  );
  const sentRequests = friendships.filter(
    (f) => f.status === 'pending' && f.sender.id === currentUser?.id
  );

  const startChatMutation = useMutation({
    mutationFn: getOrCreateDM,
    onSuccess: (room) => {
        queryClient.invalidateQueries({queryKey: ['rooms']});
        onStartChat(room);
    }
  })
  return (
    <div className="flex flex-col h-full bg-gray-50 p-6 overflow-y-auto space-y-6">
      <div className="flex items-center space-x-2 border-b border-gray-200 pb-4">
        <Users className="text-indigo-600" size={24} />
        <h2 className="text-xl font-bold text-gray-800">Gestion de la Communauté</h2>
      </div>

      {/* SECTION 1 : RECHERCHE DE NOUVEAUX AMIS */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center space-x-1.5">
          <UserPlus size={18} className="text-indigo-500" />
          <span>Ajouter de nouveaux amis</span>
        </h3>
        
        {/* Barre de recherche */}
        <div className="relative mb-4">
          <input
            type="text"
            placeholder="Rechercher par nom d'utilisateur..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
        </div>

        {/* Résultats de recherche */}
        {searchQuery && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {searchResults.length === 0 ? (
              <p className="text-xs text-gray-500 py-2">Aucun utilisateur correspondant ou déjà lié.</p>
            ) : (
              searchResults.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                  <span className="text-sm font-semibold text-gray-700">{user.username}</span>
                  <button
                    onClick={() => sendRequestMutation.mutate(user.id)}
                    className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                  >
                    <UserPlus size={14} />
                    <span>Inviter</span>
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* SECTION 2 : DEMANDES REÇUES */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center space-x-1.5 border-b pb-2">
            <Clock size={18} className="text-yellow-500" />
            <span>Demandes reçues ({receivedRequests.length})</span>
          </h3>
          {receivedRequests.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Aucune demande en attente.</p>
          ) : (
            <div className="space-y-2">
              {receivedRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-100 rounded-lg">
                  <span className="text-sm font-bold text-gray-700">{req.sender.username}</span>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => acceptMutation.mutate(req.id)}
                      className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
                      title="Accepter"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      onClick={() => rejectMutation.mutate(req.id)}
                      className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                      title="Refuser"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SECTION 3 : DEMANDES ENVOYÉES */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center space-x-1.5 border-b pb-2">
            <Clock size={18} className="text-gray-400" />
            <span>Invitations envoyées ({sentRequests.length})</span>
          </h3>
          {sentRequests.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Aucune demande envoyée.</p>
          ) : (
            <div className="space-y-2">
              {sentRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <span className="text-sm font-semibold text-gray-600">{req.receiver.username}</span>
                  <button
                    onClick={() => rejectMutation.mutate(req.id)}
                    className="flex items-center space-x-1 text-xs text-red-600 hover:bg-red-50 font-bold px-2 py-1 rounded-lg border border-red-200"
                    title="Annuler l'invitation"
                  >
                    <X size={12} />
                    <span>Annuler</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 4 : LISTE D'AMIS ACCEPTÉS */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
      <h3 className="font-semibold text-gray-800 mb-4 flex items-center space-x-1.5 border-b pb-2">
        <Users size={18} className="text-emerald-500" />
        <span>Mes Amis ({friends.length})</span>
      </h3>
      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-4">Chargement...</p>
      ) : friends.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Vous n'avez pas encore d'amis. Invitez-en pour chatter !</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {friends.map((f) => {
            const friend = f.sender.id === currentUser?.id ? f.receiver : f.sender;
            return (
              <div key={f.id} className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between">
                <div>
                  <p className="font-bold text-gray-800 text-sm">{friend.username}</p>
                  <p className="text-[10px] text-gray-500">Ami depuis le {new Date(f.updated_at).toLocaleDateString()}</p>
                </div>
                {/* BOUTON ÉCRIRE UN MESSAGE INSTANTANÉ ! */}
                <button
                  onClick={() => startChatMutation.mutate(friend.id)}
                  disabled={startChatMutation.isPending}
                  className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:bg-indigo-400"
                  title={`Écrire à ${friend.username}`}
                >
                  <MessageSquare size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}