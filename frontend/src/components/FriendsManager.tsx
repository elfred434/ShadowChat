import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getFriendships,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  searchNewFriends,
} from '../api/friendships';
import { getCurrentUser } from '../api/auth';
import { getOrCreateDM } from '../api/room';
import type { Room } from '../api/room';
import { FriendsTable } from './FriendsTable'; // AJOUT DE L'IMPORT
import { useUserSocketEvents } from '../hooks/userSocketContext';
import { blockUser, getBlockedUsers, unblockUser } from '../api/users';
import { UserPlus, Check, X, Search, Clock, Users, Ban } from 'lucide-react';

export function FriendsManager({ onStartChat }: { onStartChat: (room: Room) => void }) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const { subscribe } = useUserSocketEvents();

  // Temps réel : demande d'ami reçue/acceptée/refusée, blocage.
  useEffect(() => {
    return subscribe(({ event }) => {
      if (['friendship.requested', 'friendship.accepted', 'friendship.rejected', 'user.blocked', 'user.unblocked'].includes(event)) {
        queryClient.invalidateQueries({ queryKey: ['friendships'] });
        queryClient.invalidateQueries({ queryKey: ['newFriendsSearch', searchQuery] });
        queryClient.invalidateQueries({ queryKey: ['blockedUsers'] });
        queryClient.invalidateQueries({ queryKey: ['users'] });
      }
    });
  }, [subscribe, queryClient, searchQuery]);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
  });

  const { data: friendships = [], isLoading } = useQuery({
    queryKey: ['friendships'],
    queryFn: getFriendships,
    refetchInterval: 10_000,
  });

  const { data: blockedUsers = [] } = useQuery({
    queryKey: ['blockedUsers'],
    queryFn: getBlockedUsers,
  });

  const blockMutation = useMutation({
    mutationFn: blockUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blockedUsers'] });
      queryClient.invalidateQueries({ queryKey: ['friendships'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: unblockUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blockedUsers'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ['newFriendsSearch', searchQuery],
    queryFn: () => searchNewFriends(searchQuery),
    enabled: searchQuery.length > 0,
  });

  const sendRequestMutation = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] });
      queryClient.invalidateQueries({ queryKey: ['newFriendsSearch', searchQuery] });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: rejectFriendRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] });
    },
  });

  // Mutation pour créer/récupérer une conversation DM instantanée (utilisée par notre tableau)
  const startChatMutation = useMutation({
    mutationFn: getOrCreateDM,
    onSuccess: (room) => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      onStartChat(room);
    },
  });

  const friends = friendships.filter((f) => f.status === 'accepted');
  const receivedRequests = friendships.filter(
    (f) => f.status === 'pending' && f.receiver.id === currentUser?.id
  );
  const sentRequests = friendships.filter(
    (f) => f.status === 'pending' && f.sender.id === currentUser?.id
  );

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

      {/* SECTION 4 : INTEGRATION DU MAGNIFIQUE TABLEAU TANSTACK TABLE ! */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-4 flex items-center space-x-1.5 border-b pb-2">
          <Users size={18} className="text-indigo-600" />
          <span>Annuaire d'Amis Interactif ({friends.length})</span>
        </h3>
        
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-4">Chargement de la liste d'amis...</p>
        ) : friends.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            Vous n'avez pas encore d'amis acceptés. Utilisez la zone de recherche ci-dessus pour inviter des personnes !
          </p>
        ) : (
          // RENDU DU COMPOSANT TABLEAU
          <FriendsTable
            friendships={friends}
            currentUser={currentUser || null}
            onStartChat={(friendId) => startChatMutation.mutate(friendId)}
            onBlock={(friendId) => {
              if (window.confirm('Bloquer cet utilisateur ? L’amitié sera supprimée.')) {
                blockMutation.mutate(friendId);
              }
            }}
          />
        )}
      </div>

      {/* SECTION 5 : UTILISATEURS BLOQUÉS */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-4 flex items-center space-x-1.5 border-b pb-2">
          <Ban size={18} className="text-red-500" />
          <span>Utilisateurs bloqués ({blockedUsers.length})</span>
        </h3>
        {blockedUsers.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Aucun utilisateur bloqué.</p>
        ) : (
          <div className="space-y-2">
            {blockedUsers.map(({ id, blocked }) => (
              <div key={id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <span className="text-sm font-semibold text-gray-600">{blocked.username}</span>
                <button
                  onClick={() => unblockMutation.mutate(blocked.id)}
                  className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-200"
                >
                  Débloquer
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
