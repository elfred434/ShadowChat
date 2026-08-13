import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import {
  Archive,
  LogOut,
  MessageSquare,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  Settings,
  UserCheck,
  Users,
  WifiOff,
  X,
} from 'lucide-react'
import { getCurrentUser, sendHeartbeat, type User } from '../api/auth'
import type { Message, MessagePage } from '../api/message'
import {
  deleteMessage,
  editMessage,
  getMessages,
  getMessagesPage,
  pinMessage,
  reactToMessage,
  sendMessage,
  unreactMessage,
  unpinMessage,
} from '../api/message'
import type { Room } from '../api/room'
import { archiveRoom, createRoom, getRooms, leaveRoom, markRoomAsRead } from '../api/room'
import { getUsers } from '../api/users'
import { useRoomSocket } from '../hooks/useSockets'
import { useUserSocketEvents } from '../hooks/userSocketContext'
import { useToasts } from '../hooks/useToasts'
import { FriendsManager } from './FriendsManager'
import { GroupSettingsModal } from './GroupSettingsModal'
import { MessageBubble } from './MessageBubble'
import { ReportDialog } from './ReportDialog'
import { ToastContainer } from './Toast'
import { Avatar } from './Avatar'

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
])

function updateMessageInPages(
  pages: MessagePage[] | undefined,
  messageId: number,
  updater: (message: Message) => Message,
): MessagePage[] | undefined {
  if (!pages) return pages
  return pages.map((page) => ({
    ...page,
    results: page.results.map((message) => (message.id === messageId ? updater(message) : message)),
  }))
}

export function ChatDashboard() {
  const queryClient = useQueryClient()
  const { toasts, push, dismiss } = useToasts()
  const { status: userSocketStatus, subscribe } = useUserSocketEvents()

  const [activeTab, setActiveTab] = useState<'chats' | 'friends'>('chats')
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [selectedParticipants, setSelectedParticipants] = useState<number[]>([])
  const [messageText, setMessageText] = useState('')
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [showSearchBar, setShowSearchBar] = useState(false)
  const [showSearchFilters, setShowSearchFilters] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchAuthorId, setSearchAuthorId] = useState<number | ''>('')
  const [searchSince, setSearchSince] = useState('')
  const [searchUntil, setSearchUntil] = useState('')
  const [showGroupSettings, setShowGroupSettings] = useState(false)
  const [showRoomMenu, setShowRoomMenu] = useState(false)
  const [reportTarget, setReportTarget] = useState<Message | null>(null)
  const [typingUsers, setTypingUsers] = useState<Map<number, boolean>>(new Map())
  const [presence, setPresence] = useState<Record<number, boolean>>({})

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentReceiptsRef = useRef<Set<number>>(new Set())

  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })

  const { data: rooms = [], isLoading: loadingRooms } = useQuery({
    queryKey: ['rooms'],
    queryFn: getRooms,
    refetchInterval: 30_000,
  })

  const friends = useFriends(currentUser?.id)
  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? null

  // Navigation depuis une notification ou une invitation : ouvrir le salon demandé.
  // Ajustement d'état déclenché par un changement d'URL (pattern React recommandé).
  const search = useSearch({ from: '/' })
  const [lastRoomParam, setLastRoomParam] = useState<number | undefined>(undefined)
  if (search.room && search.room !== lastRoomParam) {
    setLastRoomParam(search.room)
    setActiveRoomId(search.room)
  }

  // --- Socket personnel : notifications, présence, non-lus, invitations --------------------
  useEffect(() => {
    return subscribe(({ event, payload }) => {
      switch (event) {
        case 'notification.created':
          push('Nouvelle notification.', 'info')
          break
        case 'friendship.requested':
          push('Nouvelle demande d’ami !', 'info')
          queryClient.invalidateQueries({ queryKey: ['friendships'] })
          break
        case 'friendship.accepted':
        case 'friendship.rejected':
          queryClient.invalidateQueries({ queryKey: ['friendships'] })
          queryClient.invalidateQueries({ queryKey: ['users'] })
          break
        case 'presence.changed': {
          const userId = Number(payload.user_id)
          const online = Boolean(payload.online)
          setPresence((current) => ({ ...current, [userId]: online }))
          queryClient.invalidateQueries({ queryKey: ['users'] })
          queryClient.invalidateQueries({ queryKey: ['rooms'] })
          break
        }
        case 'room.unread_changed': {
          const roomId = Number(payload.room_id)
          if (roomId !== activeRoomId) {
            queryClient.setQueryData<Room[]>(['rooms'], (current = []) =>
              current.map((room) =>
                room.id === roomId ? { ...room, unread_count: room.unread_count + 1 } : room,
              ),
            )
          }
          break
        }
        case 'room.read':
          queryClient.invalidateQueries({ queryKey: ['rooms'] })
          break
        case 'room.removed':
        case 'room.joined':
          queryClient.invalidateQueries({ queryKey: ['rooms'] })
          if (Number(payload.room_id) === activeRoomId) setActiveRoomId(null)
          break
        default:
          break
      }
    })
  }, [subscribe, push, queryClient, activeRoomId])

  // --- Socket du salon actif : messages, frappe, accusés de lecture ------------------------
  // Le gestionnaire d'événements est conservé dans une ref pour rester toujours à jour.
  const roomEventHandlerRef = useRef<(event: string, payload: Record<string, unknown>) => void>(() => undefined)
  const { status: roomSocketStatus, send: sendRoomEvent } = useRoomSocket(activeRoomId, (event, payload) =>
    roomEventHandlerRef.current(event, payload),
  )

  useEffect(() => {
    roomEventHandlerRef.current = (event, payload) => {
        switch (event) {
          case 'message.created': {
            const message = payload as unknown as Message
            queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
              ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
              (data) => {
                if (!data) return data
                const [firstPage, ...restPages] = data.pages
                if (firstPage.results.some((existing) => existing.id === message.id)) return data
                return { ...data, pages: [{ ...firstPage, results: [message, ...firstPage.results] }, ...restPages] }
              },
            )
            queryClient.invalidateQueries({ queryKey: ['rooms'] })
            if (message.sender.id !== currentUser?.id) {
              sendRoomEvent('messages.read', { message_ids: [message.id] })
            }
            break
          }
          case 'message.edited': {
            const message = payload as unknown as Message
            queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
              ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
              (data) =>
                data ? { ...data, pages: updateMessageInPages(data.pages, message.id, () => message)! } : data,
            )
            break
          }
          case 'message.deleted': {
            const messageId = Number(payload.message_id)
            queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
              ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
              (data) =>
                data
                  ? {
                      ...data,
                      pages: updateMessageInPages(data.pages, messageId, (message) => ({ ...message, is_deleted: true, content: '' }))!,
                    }
                  : data,
            )
            break
          }
          case 'message.reactions_changed': {
            const messageId = Number(payload.message_id)
            const reactions = (payload.reactions ?? []) as Message['reactions']
            queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
              ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
              (data) =>
                data
                  ? {
                      ...data,
                      pages: updateMessageInPages(data.pages, messageId, (message) => ({ ...message, reactions }))!,
                    }
                  : data,
            )
            break
          }
          case 'receipts.updated': {
            const readerId = Number(payload.user_id)
            const messageIds = (payload.message_ids ?? []) as number[]
            queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
              ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
              (data) =>
                data
                  ? {
                      ...data,
                      pages: data.pages.map((page) => ({
                        ...page,
                        results: page.results.map((message) =>
                          messageIds.includes(message.id) && !message.read_by.includes(readerId)
                            ? { ...message, read_by: [...message.read_by, readerId] }
                            : message,
                        ),
                      })),
                    }
                  : data,
            )
            break
          }
          case 'message.pinned': {
            const message = payload as unknown as Message
            queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
              ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
              (data) =>
                data
                  ? {
                      ...data,
                      pages: data.pages.map((page) => ({
                        ...page,
                        results: page.results.map((existing) =>
                          existing.id === message.id
                            ? { ...existing, is_pinned: true }
                            : { ...existing, is_pinned: false },
                        ),
                      })),
                    }
                  : data,
            )
            queryClient.invalidateQueries({ queryKey: ['rooms'] })
            break
          }
          case 'room.pinned_changed':
          case 'room.updated':
            queryClient.invalidateQueries({ queryKey: ['rooms'] })
            break
          case 'room.deleted':
            if (Number(payload.room_id) === activeRoomId) setActiveRoomId(null)
            queryClient.invalidateQueries({ queryKey: ['rooms'] })
            break
          case 'typing.changed': {
            const userId = Number(payload.user_id)
            setTypingUsers((current) => {
              const next = new Map(current)
              if (payload.is_typing) {
                next.set(userId, true)
                window.setTimeout(() => {
                  setTypingUsers((inner) => {
                    const updated = new Map(inner)
                    updated.delete(userId)
                    return updated
                  })
                }, 5000)
              } else {
                next.delete(userId)
              }
              return next
            })
            break
          }
          case 'activity.created':
            queryClient.invalidateQueries({ queryKey: ['activity', activeRoomId] })
            break
          default:
            break
        }
    }
  })

  const wsOffline = userSocketStatus !== 'connected' && roomSocketStatus !== 'connected'

  // --- Repli HTTP (polling) quand le WebSocket n'est pas disponible -----------------------
  useEffect(() => {
    if (userSocketStatus === 'connected') return
    const typingRoomId = messageText.trim() && activeRoom ? activeRoom.id : null
    sendHeartbeat(typingRoomId).catch(() => undefined)
    const interval = setInterval(() => sendHeartbeat(typingRoomId).catch(() => undefined), 10_000)
    return () => clearInterval(interval)
  }, [userSocketStatus, messageText, activeRoom])

  // --- Historique paginé + chargement progressif ------------------------------------------
  const messagesQuery = useInfiniteQuery<MessagePage, Error, InfiniteData<MessagePage>, (string | number | null)[], string | null>({
    queryKey: ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      pageParam
        ? getMessagesPage(pageParam)
        : getMessages({
            roomId: activeRoomId!,
            search: searchQuery,
            authorId: searchAuthorId || undefined,
            since: searchSince,
            until: searchUntil,
          }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.next,
    enabled: !!activeRoomId && activeTab === 'chats',
    refetchInterval: roomSocketStatus !== 'connected' ? 4000 : false,
  })

  const messages = useMemo(() => {
    const pages = messagesQuery.data?.pages ?? []
    return [...pages].reverse().flatMap((page) => [...page.results].reverse())
  }, [messagesQuery.data])

  // Chargement des messages plus anciens en haut de la liste (scroll infini).
  useEffect(() => {
    const sentinel = topSentinelRef.current
    if (!sentinel || !messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) messagesQuery.fetchNextPage()
      },
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [messagesQuery])

  // --- Accusés de lecture des messages entrants -------------------------------------------
  useEffect(() => {
    if (!activeRoom || roomSocketStatus !== 'connected') return
    const incoming = messages.filter(
      (message) => message.sender.id !== currentUser?.id && !sentReceiptsRef.current.has(message.id),
    )
    if (incoming.length > 0) {
      const newIds = incoming.map((message) => message.id)
      incoming.forEach((message) => sentReceiptsRef.current.add(message.id))
      sendRoomEvent('messages.read', { message_ids: newIds })
    }
  }, [messages, activeRoom, currentUser, roomSocketStatus, sendRoomEvent])

  // --- Marquer le salon comme lu ----------------------------------------------------------
  useEffect(() => {
    if (activeRoom && activeTab === 'chats') {
      markRoomAsRead(activeRoom.id).catch(() => undefined)
      if (roomSocketStatus === 'connected') sendRoomEvent('mark.read', { room_id: activeRoom.id })
      queryClient.setQueryData<Room[]>(['rooms'], (current = []) =>
        current.map((room) => (room.id === activeRoom.id ? { ...room, unread_count: 0 } : room)),
      )
    }
  }, [activeRoom, activeTab, roomSocketStatus, sendRoomEvent, queryClient])

  // --- Défilement automatique --------------------------------------------------------------
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    if (activeRoom && messages.length > 0) scrollToBottom(false)
  }, [activeRoom, messages.length, scrollToBottom])

  // --- Frappe via WebSocket ----------------------------------------------------------------
  useEffect(() => {
    if (!activeRoom || roomSocketStatus !== 'connected') return
    const isTyping = messageText.trim().length > 0
    sendRoomEvent(isTyping ? 'typing.start' : 'typing.stop', { room_id: activeRoom.id })
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    if (isTyping) {
      typingTimeoutRef.current = setTimeout(() => {
        sendRoomEvent('typing.stop', { room_id: activeRoom.id })
      }, 3000)
    }
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [messageText, activeRoom, roomSocketStatus, sendRoomEvent])

  // --- Mutations ---------------------------------------------------------------------------
  const createRoomMutation = useMutation({
    mutationFn: createRoom,
    onSuccess: (newRoom) => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      setActiveRoomId(newRoom.id)
      setShowCreateModal(false)
      setNewRoomName('')
      setSelectedParticipants([])
    },
    onError: () => push('Création du salon impossible.', 'error'),
  })

  const sendMessageMutation = useMutation({
    mutationFn: () =>
      sendMessage({
        room: activeRoom!.id,
        content: messageText.trim(),
        parent: replyingTo?.id ?? null,
        files: pendingFiles,
      }),
    onSuccess: (newMessage) => {
      setMessageText('')
      setPendingFiles([])
      setReplyingTo(null)
      // Le message créé est diffusé par WebSocket ; en mode repli (polling),
      // on l'insère manuellement.
      if (roomSocketStatus !== 'connected') {
        queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
          ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
          (data) => {
            if (!data) return data
            const [firstPage, ...restPages] = data.pages
            return { ...data, pages: [{ ...firstPage, results: [newMessage, ...firstPage.results] }, ...restPages] }
          },
        )
      }
    },
    onError: () => push('Impossible d’envoyer le message.', 'error'),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) => editMessage(id, content),
    onSuccess: (updated) => {
      queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
        ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
        (data) =>
          data ? { ...data, pages: updateMessageInPages(data.pages, updated.id, () => updated)! } : data,
      )
    },
    onError: () => push('Modification impossible.', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMessage(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
        ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
        (data) =>
          data
            ? {
                ...data,
                pages: updateMessageInPages(data.pages, id, (message) => ({ ...message, is_deleted: true, content: '' }))!,
              }
            : data,
      )
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    },
    onError: () => push('Suppression impossible.', 'error'),
  })

  const reactMutation = useMutation({
    mutationFn: ({ id, emoji, remove }: { id: number; emoji: string; remove: boolean }) =>
      remove ? unreactMessage(id, emoji) : reactToMessage(id, emoji),
    onSuccess: (_data, variables) => {
      // Mise à jour optimiste ; l'événement WebSocket fournit l'état définitif.
      queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
        ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
        (data) =>
          data
            ? {
                ...data,
                pages: updateMessageInPages(data.pages, variables.id, (message) => {
                  const existing = message.reactions.find((reaction) => reaction.emoji === variables.emoji)
                  let reactions: Message['reactions']
                  if (variables.remove) {
                    reactions = message.reactions
                      .map((reaction) =>
                        reaction.emoji === variables.emoji
                          ? { ...reaction, count: Math.max(0, reaction.count - 1), me: false }
                          : reaction,
                      )
                      .filter((reaction) => reaction.count > 0)
                  } else if (existing) {
                    reactions = message.reactions.map((reaction) =>
                      reaction.emoji === variables.emoji ? { ...reaction, count: reaction.count + 1, me: true } : reaction,
                    )
                  } else {
                    reactions = [...message.reactions, { emoji: variables.emoji, count: 1, me: true }]
                  }
                  return { ...message, reactions }
                })!,
              }
            : data,
      )
    },
    onError: () => push('Réaction impossible.', 'error'),
  })

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) =>
      pinned ? unpinMessage(id) : pinMessage(id),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
        ['messages', activeRoomId, searchQuery, searchAuthorId, searchSince, searchUntil],
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  results: page.results.map((message) => ({
                    ...message,
                    is_pinned: message.id === variables.id ? !variables.pinned : false,
                  })),
                })),
              }
            : data,
      )
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    },
    onError: () => push('Épinglage impossible.', 'error'),
  })

  // --- Actions utilisateur ------------------------------------------------------------------
  const handleSendMessage = (event: React.FormEvent) => {
    event.preventDefault()
    if (!activeRoom) return
    if (!messageText.trim() && pendingFiles.length === 0) return
    sendMessageMutation.mutate()
  }

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return
    const accepted: File[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        push(`« ${file.name} » dépasse 25 Mo.`, 'error')
        continue
      }
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        push(`Type de fichier non autorisé : ${file.name}`, 'error')
        continue
      }
      accepted.push(file)
    }
    if (accepted.length > 0) {
      setPendingFiles((current) => [...current, ...accepted].slice(0, 5))
      push(`${accepted.length} pièce(s) jointe(s) ajoutée(s).`, 'success')
    }
  }

  const handleCreateRoom = (event: React.FormEvent) => {
    event.preventDefault()
    if (selectedParticipants.length === 0) {
      push('Sélectionnez au moins un ami.', 'error')
      return
    }
    createRoomMutation.mutate({
      name: newRoomName || undefined,
      participant_ids: selectedParticipants,
    })
  }

  const typingNames = Array.from(typingUsers.keys())
    .filter((userId) => userId !== currentUser?.id)
    .map((userId) => activeRoom?.participants.find((participant) => participant.id === userId)?.username)
    .filter(Boolean) as string[]

  const roomTitle = activeRoom
    ? activeRoom.name ||
      activeRoom.participants.filter((participant) => participant.id !== currentUser?.id).map((participant) => participant.username).join(', ') ||
      'Discussion privée'
    : ''

  const pinnedMessage = activeRoom?.pinned_message ?? null

  return (
    <div className="flex h-full w-full bg-white dark:bg-slate-900 relative">
      {/* BARRE LATÉRALE */}
      <div className="w-80 border-r border-gray-200 dark:border-slate-700 flex flex-col bg-gray-50 dark:bg-slate-900 h-full">
        <div className="grid grid-cols-2 border-b border-gray-200 text-center text-sm font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('chats')}
            className={`py-3 flex items-center justify-center space-x-1.5 transition ${
              activeTab === 'chats' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-white' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <MessageSquare size={16} />
            <span>Discussions</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('friends')}
            className={`py-3 flex items-center justify-center space-x-1.5 transition ${
              activeTab === 'friends' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-white' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <UserCheck size={16} />
            <span>Communauté</span>
          </button>
        </div>

        {activeTab === 'chats' && (
          <>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-md text-gray-800">Mes salons</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition"
                title="Créer une discussion"
                aria-label="Créer une discussion"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {loadingRooms ? (
                <div className="text-center text-sm text-gray-500 py-4">Chargement...</div>
              ) : rooms.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-6 px-4">
                  Aucun salon de chat. Vous devez avoir des amis pour lancer une discussion !
                </div>
              ) : (
                rooms.map((room) => {
                  const isActive = activeRoomId === room.id
                  const otherParticipant = !room.is_group ? room.participants.find((participant) => participant.id !== currentUser?.id) : null
                  const isOnline = otherParticipant ? presence[otherParticipant.id] ?? otherParticipant.is_online : false
                  return (
                    <button
                      type="button"
                      key={room.id}
                      onClick={() => setActiveRoomId(room.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg cursor-pointer transition text-left ${
                        isActive ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-900 dark:text-indigo-200 font-semibold' : 'hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <div className="flex items-center space-x-3 truncate">
                        <div className="relative shrink-0">
                          {room.is_group ? (
                            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center overflow-hidden">
                              {room.avatar ? <img src={room.avatar} alt="" className="w-full h-full object-cover" /> : <Users size={18} />}
                            </div>
                          ) : (
                            <Avatar user={otherParticipant || null} size="md" online={otherParticipant ? isOnline : undefined} />
                          )}
                        </div>
                        <div className="truncate">
                          <p className="text-sm truncate">
                            {room.name ||
                              room.participants.filter((participant) => participant.id !== currentUser?.id).map((participant) => participant.username).join(', ') ||
                              'Discussion privée'}
                          </p>
                          {room.last_message && (
                            <p className="text-[11px] text-gray-400 truncate font-normal">
                              {room.last_message.is_deleted
                                ? 'Message supprimé'
                                : room.last_message.attachments.length > 0 && !room.last_message.content
                                  ? '📎 Pièce jointe'
                                  : room.last_message.content}
                            </p>
                          )}
                        </div>
                      </div>
                      {room.unread_count > 0 && !isActive && (
                        <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm shrink-0">
                          {room.unread_count}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </>
        )}

        {activeTab === 'friends' && (
          <div className="p-4 flex-1 flex flex-col justify-center items-center text-center text-xs text-gray-400 space-y-2">
            <UserCheck size={32} className="text-indigo-300" />
            <p className="font-semibold">Gestionnaire d'amis ouvert</p>
            <p>Utilisez le panneau central pour gérer vos contacts et demandes d'invitation.</p>
          </div>
        )}
      </div>

      {/* ZONE PRINCIPALE */}
      <div className="flex-1 flex flex-col h-full bg-gray-100 dark:bg-slate-900">
        {activeTab === 'friends' ? (
          <FriendsManager
            onStartChat={(room) => {
              setActiveRoomId(room.id)
              setActiveTab('chats')
            }}
          />
        ) : activeRoom ? (
          <>
            {/* EN-TÊTE DU SALON */}
            <div className="px-4 py-2.5 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between shadow-sm z-10">
              <div className="flex items-center space-x-3 min-w-0">
                {!activeRoom.is_group ? (
                  <Avatar
                    user={activeRoom.participants.find((participant) => participant.id !== currentUser?.id) || null}
                    size="sm"
                    online={(() => {
                      const friend = activeRoom.participants.find((participant) => participant.id !== currentUser?.id)
                      return friend ? presence[friend.id] ?? friend.is_online : undefined
                    })()}
                  />
                ) : (
                  <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center overflow-hidden">
                    {activeRoom.avatar ? <img src={activeRoom.avatar} alt="" className="w-full h-full object-cover" /> : <Users size={14} />}
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-gray-800 truncate">{roomTitle}</span>
                  {!activeRoom.is_group ? (
                    (() => {
                      const friend = activeRoom.participants.find((participant) => participant.id !== currentUser?.id)
                      const isOnline = friend ? presence[friend.id] ?? friend.is_online : false
                      if (typingNames.length > 0) return <span className="text-xs text-indigo-500 italic">est en train d'écrire…</span>
                      return (
                        <span className={`text-xs ${isOnline ? 'text-emerald-600' : 'text-gray-400'}`}>
                          {isOnline ? 'En ligne' : friend?.status_text || 'Hors ligne'}
                        </span>
                      )
                    })()
                  ) : (
                    <span className="text-xs text-gray-400">
                      {typingNames.length > 0 ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'écrivent' : 'écrit'}…` : `${activeRoom.member_count} membres`}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {wsOffline && (
                  <span className="flex items-center gap-1.5 text-[11px] text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-1" title="Connexion temps réel indisponible — mode polling">
                    <WifiOff size={12} /> Repli polling
                  </span>
                )}
                {showSearchBar && (
                  <div className="flex items-center bg-gray-50 dark:bg-slate-700 border rounded-lg px-2 py-1">
                    <input
                      type="text"
                      placeholder="Chercher un mot..."
                      className="bg-transparent text-xs focus:outline-none w-40 pr-6 text-gray-800 dark:text-gray-100"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      aria-label="Rechercher dans les messages"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSearchFilters((value) => !value)}
                      className={`p-1 rounded ${showSearchFilters ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                      title="Filtres avancés"
                      aria-label="Filtres de recherche avancés"
                    >
                      <Settings size={13} />
                    </button>
                    {searchQuery && (
                      <button type="button" onClick={() => setSearchQuery('')} aria-label="Effacer la recherche" className="text-gray-400 hover:text-gray-600">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowSearchBar((value) => !value)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                  title="Rechercher dans la conversation"
                  aria-label="Rechercher dans la conversation"
                >
                  <Search size={16} />
                </button>
                {activeRoom.is_group && activeRoom.can_manage && (
                  <button
                    type="button"
                    onClick={() => setShowGroupSettings(true)}
                    className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                    title="Paramètres du groupe"
                    aria-label="Paramètres du groupe"
                  >
                    <Settings size={16} />
                  </button>
                )}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowRoomMenu((value) => !value)}
                    className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                    title="Actions du salon"
                    aria-label="Actions du salon"
                  >
                    <LogOut size={16} />
                  </button>
                  {showRoomMenu && (
                    <div className="absolute right-0 top-10 w-44 rounded-xl bg-white border border-gray-200 shadow-lg py-1 z-40">
                      {activeRoom.is_group && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowRoomMenu(false)
                            setShowGroupSettings(true)
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Paramètres du groupe
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setShowRoomMenu(false)
                          leaveRoom(activeRoom.id)
                            .then(() => {
                              push('Vous avez quitté le salon.', 'success')
                              setActiveRoomId(null)
                              queryClient.invalidateQueries({ queryKey: ['rooms'] })
                            })
                            .catch(() => push('Action impossible.', 'error'))
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                      >
                        <LogOut size={12} /> Quitter le salon
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowRoomMenu(false)
                          archiveRoom(activeRoom.id)
                            .then(() => {
                              push('Salon archivé.', 'success')
                              setActiveRoomId(null)
                              queryClient.invalidateQueries({ queryKey: ['rooms'] })
                            })
                            .catch(() => push('Action impossible.', 'error'))
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                      >
                        <Archive size={12} /> Archiver
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* FILTRES DE RECHERCHE AVANCÉS */}
            {showSearchBar && showSearchFilters && (
              <div className="px-4 py-2 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex flex-wrap items-center gap-2 text-xs z-10">
                <label className="flex items-center gap-1 text-gray-500">
                  Auteur
                  <select
                    value={searchAuthorId}
                    onChange={(event) => setSearchAuthorId(event.target.value ? Number(event.target.value) : '')}
                    className="border border-gray-300 rounded px-1.5 py-1"
                    aria-label="Filtrer par auteur"
                  >
                    <option value="">Tous</option>
                    {activeRoom.participants.map((participant) => (
                      <option key={participant.id} value={participant.id}>
                        {participant.username}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1 text-gray-500">
                  Du
                  <input
                    type="date"
                    value={searchSince}
                    onChange={(event) => setSearchSince(event.target.value)}
                    className="border border-gray-300 rounded px-1.5 py-1"
                    aria-label="Date de début"
                  />
                </label>
                <label className="flex items-center gap-1 text-gray-500">
                  Au
                  <input
                    type="date"
                    value={searchUntil}
                    onChange={(event) => setSearchUntil(event.target.value)}
                    className="border border-gray-300 rounded px-1.5 py-1"
                    aria-label="Date de fin"
                  />
                </label>
              </div>
            )}

            {/* MESSAGE ÉPINGLÉ */}
            {pinnedMessage && !pinnedMessage.is_deleted && (
              <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs z-10">
                <Pin size={12} className="text-amber-600 shrink-0" />
                <span className="text-amber-800 font-medium shrink-0">Épinglé :</span>
                <span className="text-amber-700 truncate flex-1">
                  {pinnedMessage.content || '📎 Pièce jointe'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const element = document.getElementById(`message-${pinnedMessage.id}`)
                    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}
                  className="text-amber-700 underline"
                >
                  Voir
                </button>
                <button
                  type="button"
                  onClick={() => pinMutation.mutate({ id: pinnedMessage.id, pinned: true })}
                  aria-label="Désépingler"
                  className="text-amber-700 hover:text-amber-900"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {/* LISTE DES MESSAGES */}
            <div className="flex-1 overflow-y-auto py-2" aria-live="polite">
              {messagesQuery.hasNextPage && (
                <div ref={topSentinelRef} className="flex justify-center py-2">
                  <button
                    type="button"
                    onClick={() => messagesQuery.fetchNextPage()}
                    disabled={messagesQuery.isFetchingNextPage}
                    className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                  >
                    {messagesQuery.isFetchingNextPage ? 'Chargement…' : 'Messages précédents'}
                  </button>
                </div>
              )}
              {messagesQuery.isLoading ? (
                <div className="text-center text-sm text-gray-400 py-10">Chargement des messages…</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-sm text-gray-400 py-10">Aucun message. Dites bonjour ! 👋</div>
              ) : (
                messages.map((message, index) => {
                  const previous = index > 0 ? messages[index - 1] : null
                  const showSender = activeRoom.is_group && (previous == null || previous.sender.id !== message.sender.id)
                  return (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      currentUser={currentUser!}
                      isGroup={activeRoom.is_group}
                      showSender={showSender}
                      canManage={activeRoom.can_manage}
                      onReply={setReplyingTo}
                      onEdit={(id, content) => editMutation.mutate({ id, content })}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onReact={(id, emoji) => reactMutation.mutate({ id, emoji, remove: false })}
                      onPinToggle={(message) => pinMutation.mutate({ id: message.id, pinned: message.is_pinned })}
                      onReport={setReportTarget}
                    />
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* COMPOSEUR */}
            <form onSubmit={handleSendMessage} className="p-3 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 space-y-2">
              {replyingTo && (
                <div className="flex items-center gap-2 rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs text-indigo-700">
                  <span className="truncate flex-1">
                    Réponse à <span className="font-semibold">{replyingTo.sender.username}</span> :{' '}
                    <span className="text-indigo-500">{replyingTo.content.slice(0, 80)}</span>
                  </span>
                  <button type="button" onClick={() => setReplyingTo(null)} aria-label="Annuler la réponse" className="text-indigo-500 hover:text-indigo-700">
                    <X size={14} />
                  </button>
                </div>
              )}

              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.map((file, index) => (
                    <span key={`${file.name}-${index}`} className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                      <Paperclip size={11} />
                      <span className="max-w-[140px] truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                        aria-label={`Retirer ${file.name}`}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2.5 rounded-lg text-gray-500 hover:bg-gray-100"
                  title="Joindre un fichier"
                  aria-label="Joindre un fichier"
                >
                  <Paperclip size={18} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
                  onChange={(event) => handleFilesSelected(event.target.files)}
                />
                <textarea
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      if (messageText.trim() || pendingFiles.length > 0) handleSendMessage(event)
                    }
                    if (event.key === 'Escape') setReplyingTo(null)
                  }}
                  placeholder="Écrivez un message… (Entrée pour envoyer)"
                  rows={1}
                  aria-label="Message"
                  className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-32"
                />
                <button
                  type="submit"
                  disabled={sendMessageMutation.isPending || (!messageText.trim() && pendingFiles.length === 0)}
                  className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition"
                  aria-label="Envoyer le message"
                  title="Envoyer"
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 space-y-3">
            <MessageSquare size={48} className="text-indigo-200" />
            <p className="text-sm font-medium">Sélectionnez une discussion pour commencer</p>
            <p className="text-xs">Vos messages apparaissent en temps réel grâce aux WebSockets.</p>
          </div>
        )}
      </div>

      {/* MODALE DE CRÉATION DE SALON */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Créer une discussion"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCreateModal(false)
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">Nouvelle discussion</h2>
              <button type="button" onClick={() => setShowCreateModal(false)} aria-label="Fermer" className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label htmlFor="room-name" className="block text-xs font-medium text-gray-500 mb-1">
                  Nom du groupe (optionnel, si plus d'un ami)
                </label>
                <input
                  id="room-name"
                  type="text"
                  value={newRoomName}
                  onChange={(event) => setNewRoomName(event.target.value)}
                  placeholder="Nom du groupe"
                  className="w-full rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <span className="block text-xs font-medium text-gray-500 mb-1">Participants (vos amis)</span>
                <FriendsChecklist
                  selected={selectedParticipants}
                  onToggle={(userId) =>
                    setSelectedParticipants((current) =>
                      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
                    )
                  }
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={createRoomMutation.isPending || selectedParticipants.length === 0}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold"
                >
                  Créer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PARAMÈTRES DU GROUPE */}
      {showGroupSettings && activeRoom && currentUser && (
        <GroupSettingsModal
          room={activeRoom}
          currentUser={currentUser}
          friends={friends}
          onClose={() => setShowGroupSettings(false)}
          onRoomChanged={() => queryClient.invalidateQueries({ queryKey: ['rooms'] })}
          onRoomDeleted={() => {
            setShowGroupSettings(false)
            setActiveRoomId(null)
            queryClient.invalidateQueries({ queryKey: ['rooms'] })
          }}
          onToast={push}
        />
      )}

      {reportTarget && (
        <ReportDialog
          kind="message"
          targetId={reportTarget.id}
          targetLabel="le message"
          onClose={() => setReportTarget(null)}
          onReported={(message) => {
            push(message, 'success')
            setReportTarget(null)
          }}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

/** Liste d'amis cochables pour la création de salon. */
function FriendsChecklist({ selected, onToggle }: { selected: number[]; onToggle: (userId: number) => void }) {
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    enabled: true,
  })
  if (users.length === 0) {
    return <p className="text-xs text-gray-400">Aucun ami disponible. Ajoutez des amis d'abord.</p>
  }
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
      {users.map((user) => (
        <label key={user.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={selected.includes(user.id)}
            onChange={() => onToggle(user.id)}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <Avatar user={user} size="sm" />
          <span className="text-sm text-gray-700">{user.username}</span>
        </label>
      ))}
    </div>
  )
}

/** Récupère la liste des amis (hook séparé pour éviter les violations des règles des hooks). */
function useFriends(currentUserId?: number): User[] {
  const { data = [] } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    enabled: currentUserId != null,
  })
  return data
}
