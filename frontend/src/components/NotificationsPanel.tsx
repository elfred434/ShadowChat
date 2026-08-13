import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bell, BellOff, CheckCheck, MessageSquare, Reply, UserPlus, Users } from 'lucide-react'
import { getNotifications, getUnreadCount, markAllNotificationsRead, markNotificationRead, notificationLabel, type Notification } from '../api/notifications'
import { useUserSocketEvents } from '../hooks/userSocketContext'
import { Avatar } from './Avatar'

function TypeIcon({ type }: { type: Notification['type'] }) {
  switch (type) {
    case 'friend_request':
    case 'friend_accepted':
    case 'friend_rejected':
      return <UserPlus size={14} className="text-indigo-500" />
    case 'mention':
      return <MessageSquare size={14} className="text-amber-500" />
    case 'reply':
      return <Reply size={14} className="text-emerald-500" />
    case 'group_invite':
      return <Users size={14} className="text-purple-500" />
  }
}

export function NotificationsPanel() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { subscribe } = useUserSocketEvents()

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    refetchInterval: 30_000,
  })

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    const unsubscribe = subscribe(({ event }) => {
      if (event === 'notification.created') {
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
        queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
      }
    })
    return unsubscribe
  }, [subscribe, queryClient])

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
    },
  })

  const openNotification = (notification: Notification) => {
    markNotificationRead(notification.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
    })
    if (notification.room) {
      setOpen(false)
      navigate({ to: '/', search: { room: notification.room.id } })
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Notifications (${unreadCount} non lues)`}
        aria-expanded={open}
        className="relative p-2 rounded-full hover:bg-indigo-500 transition"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 max-h-[70vh] flex flex-col rounded-xl bg-white text-gray-800 shadow-2xl border border-gray-200 z-50">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-bold">Notifications</h2>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllMutation.mutate()}
                className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
              >
                <CheckCheck size={12} /> Tout marquer comme lu
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-gray-400">
                <BellOff size={24} />
                <p className="text-xs">Aucune notification pour le moment.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      className={`w-full flex items-start gap-2.5 px-4 py-3 text-left hover:bg-gray-50 ${notification.read_at ? '' : 'bg-indigo-50/60'}`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {notification.actor ? <Avatar user={notification.actor} size="sm" /> : <TypeIcon type={notification.type} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-700 leading-snug">
                          <span className="font-semibold">{notification.actor?.username ?? 'Quelqu’un'}</span>{' '}
                          {notificationLabel(notification.type)}
                        </p>
                        {notification.message && (
                          <p className="text-[11px] text-gray-400 truncate mt-0.5">« {notification.message.content} »</p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {new Date(notification.created_at).toLocaleString('fr-FR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      {!notification.read_at && <span className="w-2 h-2 mt-1.5 rounded-full bg-indigo-500 shrink-0" aria-label="Non lue" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
