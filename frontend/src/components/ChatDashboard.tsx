import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRooms, createRoom, markRoomAsRead } from '../api/room';
import type { Room } from '../api/room';
import { getUsers } from '../api/users';
import { getMessages, sendMessage } from '../api/message';
import type { Message } from '../api/message';
import { getCurrentUser } from '../api/auth';
import { FriendsManager } from './FriendsManager'; // AJOUT DE L'IMPORT !
import { MessageSquare, Plus, Users, Send, UserCheck, Search, X } from 'lucide-react';
import { sendHeartbeat } from '../api/auth';
import { Avatar } from './Avatar';
export function ChatDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'chats' | 'friends'>('chats'); // Onglet actif !
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<number[]>([]);
  const [messageText, setMessageText] = useState('');
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');


  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
  });

  useEffect(() => {
    if (!currentUser) return;

    const typingRoomId = messageText.trim() && activeRoom ? activeRoom.id : null;
    sendHeartbeat(typingRoomId).catch(() => { });

    const interval = setInterval(() => {
      sendHeartbeat(typingRoomId).catch(() => { });
    }, 5000);
    return () => clearInterval(interval)
  }, [currentUser, messageText, activeRoom]);

  const { data: rooms = [], isLoading: loadingRooms } = useQuery({
    queryKey: ['rooms'],
    queryFn: getRooms,
    refetchInterval: 5000,
  });

  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ['messages', activeRoom?.id, searchQuery],
    queryFn: () => getMessages(activeRoom!.id, searchQuery),
    enabled: !!activeRoom && activeTab === 'chats', // N'exécute que si on est sur l'onglet chat
    refetchInterval: searchQuery ? undefined : 2000,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    enabled: showCreateModal,
  });

  const createRoomMutation = useMutation({
    mutationFn: createRoom,
    onSuccess: (newRoom) => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      setActiveRoom(newRoom);
      setShowCreateModal(false);
      setNewRoomName('');
      setSelectedParticipants([]);
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: () => sendMessage(activeRoom!.id, messageText),
    onSuccess: (newMessage) => {
      setMessageText('');
      queryClient.setQueryData<Message[]>(['messages', activeRoom?.id], (oldMessages = []) => [
        ...oldMessages,
        newMessage,
      ]);
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages]);

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedParticipants.length === 0) {
      alert('Veuillez sélectionner au moins un participant.');
      return;
    }
    createRoomMutation.mutate({
      name: newRoomName || undefined,
      is_group: selectedParticipants.length > 1,
      participant_ids: selectedParticipants,
    });
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;
    sendMessageMutation.mutate();
  };

  const toggleParticipant = (userId: number) => {
    setSelectedParticipants((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const markReadMutation = useMutation({
    mutationFn: markRoomAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['rooms']});
    }
  });
  useEffect(() => {
    if (activeRoom && activeTab === 'chats'){
      markReadMutation.mutate(activeRoom.id)
    }
  }, [activeRoom, activeTab, markReadMutation]);

  useEffect(() => {
    if (activeRoom && messages.length > 0){
      markRoomAsRead(activeRoom.id).catch(() => {});
    }
  }, [messages.length, activeRoom]);
  function highlightText(text: string, search: string){
    if(!search.trim()) return text;

    const regex = new RegExp(`(${search})`, 'gi');
    const parts = text.split(regex);
    return (
    <>
      {parts.map((part, index) => 
        part.toLowerCase() === search.toLowerCase() ? (
          <span key={index}
           className="bg-yellow-200 text-black px-0.5 rounded font-medium animate-pulse">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
  }
  return (
    <div className="flex h-full w-full bg-white relative">
      {/* BARRE LATÉRALE */}
      <div className="w-80 border-r border-gray-200 flex flex-col bg-gray-50 h-full">
        {/* SÉLECTEUR D'ONGLET GLOBAL */}
        <div className="grid grid-cols-2 border-b border-gray-200 text-center text-sm font-semibold">
          <button
            onClick={() => setActiveTab('chats')}
            className={`py-3 flex items-center justify-center space-x-1.5 transition ${activeTab === 'chats'
              ? 'border-b-2 border-indigo-600 text-indigo-600 bg-white'
              : 'text-gray-500 hover:text-gray-800'
              }`}
          >
            <MessageSquare size={16} />
            <span>Discussions</span>
          </button>
          <button
            onClick={() => setActiveTab('friends')}
            className={`py-3 flex items-center justify-center space-x-1.5 transition ${activeTab === 'friends'
              ? 'border-b-2 border-indigo-600 text-indigo-600 bg-white'
              : 'text-gray-500 hover:text-gray-800'
              }`}
          >
            <UserCheck size={16} />
            <span>Communauté</span>
          </button>
        </div>

        {/* LISTE DES DISCUSSIONS (Affichée uniquement sur l'onglet 'chats') */}
        {activeTab === 'chats' && (
          <>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-md text-gray-800">Mes salons</h2>
              <button
                onClick={() => setShowCreateModal(true)}
                className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition"
                title="Créer une discussion avec un ami"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {loadingRooms ? (
                <div className="text-center text-sm text-gray-500 py-4">Chargement...</div>
              ) : rooms.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-6 px-4">
                  Aucun salon de chat. Vous devez avoir des amis connectés pour lancer une discussion !
                </div>
              ) : (
                rooms.map((room) => {
                  const isActive = activeRoom?.id === room.id;

                  // On trouve l'autre participant pour un DM privé
                  const otherParticipant = !room.is_group
                    ? room.participants.find((p) => p.id !== currentUser?.id)
                    : null;

                  return (
                    <div
                      key={room.id}
                      onClick={() => {
                        setActiveRoom(room);
                      }}
                      className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition ${isActive ? 'bg-indigo-50 text-indigo-900 font-semibold' : 'hover:bg-gray-100 text-gray-700'
                        }`}
                    >
                      <div className="flex items-center space-x-3 truncate">
                        <div className="relative">
                          {room.is_group ? (
                            // Si c'est un groupe, on garde l'icône de groupe ou un avatar fictif
                            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center">
                              <Users size={18} />
                            </div>
                          ) : (
                            // Si c'est une discussion privée (DM), on affiche le magnifique avatar de notre ami !
                            <Avatar user={otherParticipant || null} size="md" />
                          )}
                        </div>
                        <div className="truncate">
                          <p className="text-sm truncate">
                            {room.name || room.participants.filter(p => p.id !== currentUser?.id).map((p) => p.username).join(', ') || 'Discussion privée'}
                          </p>
                          {/* Petit sous-titre optionnel pour le statut de l'ami */}
                          {!room.is_group && otherParticipant?.status_text && (
                            <p className="text-[10px] text-indigo-500 italic truncate font-light">
                              {otherParticipant.status_text}
                            </p>
                          )}
                          {room.unread_count > 0 && !isActive && (
                            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                              {room.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* LISTE RÉDUITE/INFO DANS LA BARRE LATÉRALE DE L'ONGLET 'FRIENDS' */}
        {activeTab === 'friends' && (
          <div className="p-4 flex-1 flex flex-col justify-center items-center text-center text-xs text-gray-400 space-y-2">
            <UserCheck size={32} className="text-indigo-300" />
            <p className="font-semibold">Gestionnaire d'amis ouvert</p>
            <p>Utilisez le panneau central de droite pour gérer vos contacts et envoyer des demandes d'invitations.</p>
          </div>
        )}
      </div>

      {/* ZONE PRINCIPALE DE DROITE (Dynamique : soit le chat soit le gestionnaire d'amis) */}
      <div className="flex-1 flex flex-col h-full bg-gray-100">
        {activeTab === 'friends' ? (
          <FriendsManager
            onStartChat={(room) => {
              setActiveRoom(room); // Ouvre ce salon dans l'UI de chat
              setActiveTab('chats'); // Bascule automatiquement sur l'onglet de messagerie
            }}
          />
        ) : activeRoom ? (
          <>
            {/* En-tête du salon */}
            <div className="p-4 bg-white border-b border-gray-200 flex items-center justify-between shadow-sm z-10">
              <div className="flex items-center space-x-3">
                {!activeRoom.is_group ? (
                  <Avatar user={activeRoom.participants.find(p => p.id !== currentUser?.id) || null} size="sm" />
                ) : (
                  <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center">
                    <Users size={14} />
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="font-bold text-gray-800">
                    {activeRoom.name || activeRoom.participants.filter(p => p.id !== currentUser?.id).map((p) => p.username).join(', ') || 'Discussion privée'}
                  </span>
                  {/* Affiche la bio ou le statut de l'ami dans l'en-tête de la conversation */}
                  {!activeRoom.is_group && (() => {
                    const friend = activeRoom.participants.find(p => p.id !== currentUser?.id);
                    return friend?.status_text && (
                      <span className="text-xs text-indigo-500 italic font-light">{friend.status_text}</span>
                    );
                  })()}
                </div>
              </div>

              {/* BARRE DE RECHERCHE INTEGRÉE */}
              <div className="flex items-center space-x-2">
                {showSearchBar && (
                  <div className="flex items-center bg-gray-50 border rounded-lg px-2 py-1 relative animate-scale-in">
                    <input
                      type="text"
                      placeholder="Chercher un mot..."
                      className="bg-transparent text-xs focus:outline-none w-40 pr-6 text-gray-800"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 text-gray-400 hover:text-gray-600 text-xs"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )}

                {/* Bouton Loupe */}
                <button
                  type="button"
                  onClick={() => {
                    setShowSearchBar(!showSearchBar);
                    if (showSearchBar) setSearchQuery(''); // Réinitialise si on ferme
                  }}
                  className={`p-1.5 rounded-lg transition ${
                    showSearchBar ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                  }`}
                  title="Rechercher des messages"
                >
                  <Search size={18} />
                </button>
              </div>
            </div>

            {/* Corps des messages */}
            <div className="flex-1 p-6 overflow-y-auto bg-gray-50 flex flex-col space-y-4">
              {loadingMessages ? (
                <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Chargement...</div>
              ) : messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                  <p className="text-sm">Aucun message ici.</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.sender.id === currentUser?.id;
                  return (
                 <div
                   key={msg.id}
                   className={`flex space-x-2.5 max-w-[75%] ${isMe ? 'self-end flex-row-reverse space-x-reverse' : 'self-start'}`}
                 >
                   {/* Avatar de l'expéditeur à côté du message (sauf pour nous, ou optionnel pour nous aussi !) */}
                   <Avatar user={msg.sender} size="sm" />

                   <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                     {!isMe && (
                       <span className="text-xs text-gray-500 mb-1 ml-1 font-medium">
                         {msg.sender.username}
                       </span>
                     )}
                     <div
                       className={`p-3 rounded-2xl shadow-sm text-sm ${
                         isMe
                           ? 'bg-indigo-600 text-white rounded-tr-none' // Notre message
                           : 'bg-white text-gray-800 rounded-tl-none border border-gray-100' // Message de l'ami
                       }`}
                     >
                       <p className="break-words">{highlightText(msg.content, searchQuery)}</p>
                     </div>
                     <span className="text-[10px] text-gray-400 mt-1 px-1">
                       {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                     </span>
                   </div>
                 </div>
               );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
            {/* Indicateur de saisie en temps réel */}
            {activeRoom && (() => {
              const typingUser = activeRoom.participants.find(
                (p) => p.id !== currentUser?.id && p.is_typing_in === activeRoom.id
              );
              if (typingUser) {
                return (
                  <div className="px-6 py-2 text-xs text-gray-500 italic bg-gray-50/50 flex items-center space-x-2 animate-pulse">
                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></span>
                    <span>{typingUser.username} est en train d'écrire...</span>
                  </div>
                );
              }
              return null;
            })()}

            {/* Zone d'envoi */}
            <div className="p-4 bg-white border-t border-gray-200">
              <form className="flex space-x-2" onSubmit={handleSendMessage}>
                <input
                  type="text"
                  placeholder="Écrivez votre message..."
                  className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 text-sm"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  disabled={sendMessageMutation.isPending}
                />
                <button
                  type="submit"
                  disabled={sendMessageMutation.isPending || !messageText.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold p-2.5 rounded-lg flex items-center justify-center transition"
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
            <MessageSquare size={48} className="mb-4 text-gray-300" />
            <p className="text-lg font-medium">Sélectionnez une discussion</p>
            <p className="text-sm font-light">Ou cliquez sur l'onglet Communauté pour vous faire des amis !</p>
          </div>
        )}
      </div>

      {/* MODALE DE CRÉATION DE DISCUSSION (Seuls vos Amis Acceptés s'afficheront !) */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-gray-200">
              <h3 className="font-bold text-lg text-gray-800">Lancer une discussion</h3>
            </div>
            <form onSubmit={handleCreateRoom} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Nom de la discussion de groupe (optionnel)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Projet Dev, Famille..."
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Sélectionner un ou plusieurs amis
                </label>
                <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1 bg-gray-50">
                  {users.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-4">
                      Vous n'avez pas d'amis acceptés. Ajoutez-en d'abord dans l'onglet Communauté !
                    </p>
                  ) : (
                    users.map((user) => (
                      <div
                        key={user.id}
                        onClick={() => toggleParticipant(user.id)}
                        className={`flex items-center space-x-3 p-2 rounded-md cursor-pointer transition ${selectedParticipants.includes(user.id)
                          ? 'bg-indigo-100 text-indigo-900 font-semibold'
                          : 'hover:bg-gray-200 text-gray-700'
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedParticipants.includes(user.id)}
                          onChange={() => { }}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm">{user.username}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex space-x-3 pt-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setSelectedParticipants([]);
                    setNewRoomName('');
                  }}
                  className="px-4 py-2 border rounded-lg text-gray-700 text-sm font-semibold hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={createRoomMutation.isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg disabled:bg-indigo-400"
                >
                  {createRoomMutation.isPending ? 'Création...' : 'Discuter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}