import { api } from './client'
import type { User } from './auth'

export interface Notification {
  id: number
  type: 'friend_request' | 'friend_accepted' | 'friend_rejected' | 'mention' | 'reply' | 'group_invite'
  actor: User | null
  room: { id: number; name: string | null; is_group: boolean } | null
  message: { id: number; content: string; room_id: number } | null
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export async function getNotifications(): Promise<Notification[]> {
  const response = await api.get<{ results: Notification[]; count: number }>('notifications/')
  return response.data.results
}

export async function getUnreadCount(): Promise<number> {
  const response = await api.get<{ unread_count: number }>('notifications/unread_count/')
  return response.data.unread_count
}

export async function markNotificationRead(id: number): Promise<void> {
  await api.post(`notifications/${id}/mark_read/`)
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('notifications/mark_all_read/')
}

export function notificationLabel(type: Notification['type']): string {
  switch (type) {
    case 'friend_request':
      return 'vous a envoyé une demande d’ami'
    case 'friend_accepted':
      return 'a accepté votre demande d’ami'
    case 'friend_rejected':
      return 'a refusé votre demande d’ami'
    case 'mention':
      return 'vous a mentionné dans un message'
    case 'reply':
      return 'a répondu à votre message'
    case 'group_invite':
      return 'vous a ajouté à un groupe'
    default:
      return 'nouvelle notification'
  }
}
