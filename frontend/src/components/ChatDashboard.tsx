import React, { useEffect, useRef, useState } from "react";
import {useQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import {getRooms, createRoom} from '../api/room';
import type {Room} from '../api/room';
import {MessageSquare, Plus, Users, Hash, Send} from 'lucide-react';
import { getUsers } from "../api/users";
import {getMessages, sendMessages} from '../api/message';
import type {Message} from '../api/message';
import { getCurrentUser } from "../api/auth";

export function ChatDashboard() {
  const queryClient = useQueryClient();
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<number[]>([]);
  const [messageText, setMessageText] = useState('');

  const messageEndRef = useRef<HTMLDivElement>(null);
  const {data: currentUser} = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
  })

  const{data: rooms = [], isLoading: loadingRooms}= useQuery({
    queryKey: ['rooms'],
    queryFn: getRooms,
    refetchInterval: 5000,
  });

  const {data: messages = [], isLoading: loadingMessages} = useQuery({
    queryKey: ['messages', activeRoom?.id],
    queryFn: () => getMessages(activeRoom!.id),
    enabled: !!activeRoom,
    refetchInterval: 2000,
  })
  const {data: users = []} = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    enabled: showCreateModal,
  });
  const createRoomMutation = useMutation({
    mutationFn: createRoom,
    onSuccess: (newRoom) => {
      queryClient.invalidateQueries({queryKey: ['rooms']});
      setActiveRoom(newRoom);
      setShowCreateModal(false);
      setNewRoomName('');
      setSelectedParticipants([]);
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: () => sendMessages(activeRoom!.id, messageText),
    onSuccess: (newMessage) => {
      setMessageText('');
      queryClient.setQueryData<Message[]>(['messages', activeRoom?.id], (oldMessages = [])=>[
        ...oldMessages,
        newMessage,
      ]);
      queryClient.invalidateQueries({queryKey: ['rooms']});
    },
  });

  const scrollToBottom = () => {
    messageEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages]);

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedParticipants.length === 0) {
      alert('Veuillez sélectionnnez au moins un participant.');
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
    
  }
  const toggleParticipant = (userId: number) => {
    setSelectedParticipants((prev) => 
    prev.includes(userId) ? prev.filter((id) => id !== userId): [...prev, userId]);

  };
  
  return (
    <div className="flex h-full w-full bg-white relative">
      {/* BARRE LATÉRALE - LISTE DES DISCUSSIONS */}
      <div className="w-80 border-r border-gray-200 flex flex-col bg-gray-50 h-full">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-lg text-gray-800">Discussions</h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition"
            title="Nouvelle discussion"
          >
            <Plus size={18} />
          </button>
        </div>

        {/* Liste des salons */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {loadingRooms ? (
            <div className="text-center text-sm text-gray-500 py-4">Chargement des salons...</div>
          ) : rooms.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-4">Aucune discussion lancée. Cliquez sur '+' !</div>
          ) : (
            rooms.map((room) => {
              const isActive = activeRoom?.id === room.id;
              return (
                <div
                  key={room.id}
                  onClick={() => setActiveRoom(room)}
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition ${
                    isActive ? 'bg-indigo-50 text-indigo-900 font-semibold' : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-center space-x-3 truncate">
                    {room.is_group ? <Users size={18} className="text-indigo-500" /> : <MessageSquare size={18} className="text-gray-400" />}
                    <div className="truncate">
                      <p className="text-sm truncate">
                        {room.name || room.participants.filter(p => p.id !== currentUser?.id).map((p) => p.username).join(', ') || 'Discussion privée'}
                      </p>
                      {room.last_message && (
                        <p className="text-xs text-gray-400 truncate font-normal">
                          <span className="font-medium text-gray-600">{room.last_message.sender.username}:</span> {room.last_message.content}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ZONE PRINCIPALE - MESSAGES */}
      <div className="flex-1 flex flex-col h-full bg-gray-100">
        {activeRoom ? (
          <>
            {/* En-tête du salon */}
            <div className="p-4 bg-white border-b border-gray-200 flex items-center justify-between shadow-sm">
              <div className="flex items-center space-x-2">
                <Hash size={20} className="text-indigo-600" />
                <span className="font-bold text-gray-800">
                  {activeRoom.name || activeRoom.participants.filter(p => p.id !== currentUser?.id).map((p) => p.username).join(', ') || 'Discussion privée'}
                </span>
              </div>
            </div>

            {/* Corps des messages */}
            <div className="flex-1 p-6 overflow-y-auto bg-gray-50 flex flex-col space-y-4">
              {loadingMessages ? (
                <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Chargement des messages...</div>
              ) : messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                  <p className="text-sm">Aucun message dans ce salon.</p>
                  <p className="text-xs">Soyez le premier à envoyer un message !</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.sender.id === currentUser?.id;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col max-w-[70%] ${
                        isMe ? 'self-end items-end' : 'self-start items-start'
                      }`}
                    >
                      {/* Afficher l'expéditeur si ce n'est pas nous */}
                      {!isMe && (
                        <span className="text-xs text-gray-500 mb-1 ml-1 font-medium">
                          {msg.sender.username}
                        </span>
                      )}
                      <div
                        className={`p-3 rounded-2xl shadow-sm text-sm ${
                          isMe
                            ? 'bg-indigo-600 text-white rounded-br-none'
                            : 'bg-white text-gray-800 rounded-bl-none border border-gray-100'
                        }`}
                      >
                        <p className="break-words">{msg.content}</p>
                      </div>
                      <span className="text-[10px] text-gray-400 mt-1 px-1">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })
              )}
              {/* Point de repère pour le scroll */}
              <div ref={messageEndRef} />
            </div>

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
            <p className="text-sm">Ou démarrez-en une nouvelle avec vos amis !</p>
          </div>
        )}
      </div>

      {/* MODALE DE CRÉATION DE DISCUSSION */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-gray-200">
              <h3 className="font-bold text-lg text-gray-800">Créer une discussion</h3>
            </div>
            <form onSubmit={handleCreateRoom} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Nom du groupe (optionnel)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Équipe Dev, Famille..."
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Sélectionner les participants (requis)
                </label>
                <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1 bg-gray-50">
                  {users.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-2">Aucun autre utilisateur enregistré.</p>
                  ) : (
                    users.map((user) => (
                      <div
                        key={user.id}
                        onClick={() => toggleParticipant(user.id)}
                        className={`flex items-center space-x-3 p-2 rounded-md cursor-pointer transition ${
                          selectedParticipants.includes(user.id)
                            ? 'bg-indigo-100 text-indigo-900 font-semibold'
                            : 'hover:bg-gray-200 text-gray-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedParticipants.includes(user.id)}
                          onChange={() => {}}
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
                  {createRoomMutation.isPending ? 'Création...' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}