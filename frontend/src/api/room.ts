import { api } from './client'
import type { User } from './auth'
import type { Message } from './message'

export interface Membership {
  id: number
  user: User
  role: 'owner' | 'admin' | 'member'
  is_muted: boolean
  is_banned: boolean
  joined_at: string
}

export interface ActivityEntry {
  id: number
  user: User | null
  action: string
  action_display: string
  details: Record<string, unknown>
  created_at: string
}

export interface Room {
  id: number
  name: string | null
  description: string | null
  is_group: boolean
  participants: User[]
  memberships: Membership[]
  owner: number | null
  avatar: string | null
  last_message: Message | null
  unread_count: number
  pinned_message: Message | null
  my_role: 'owner' | 'admin' | 'member' | null
  can_manage: boolean
  is_archived: boolean
  invite_url: string | null
  member_count: number
  created_at: string
  updated_at: string
}

export async function getRooms(): Promise<Room[]> {
  const response = await api.get<{ results: Room[]; count: number }>('rooms/')
  return response.data.results
}

export async function getRoom(roomId: number): Promise<Room> {
  const response = await api.get<Room>(`rooms/${roomId}/`)
  return response.data
}

export async function createRoom(data: {
  name?: string
  participant_ids: number[]
}): Promise<Room> {
  const response = await api.post<Room>('rooms/', data)
  return response.data
}

export async function getOrCreateDM(userId: number): Promise<Room> {
  const response = await api.post<Room>('rooms/get_or_create_dm/', { user_id: userId })
  return response.data
}

export async function markRoomAsRead(roomId: number): Promise<void> {
  await api.post(`rooms/${roomId}/mark_as_read/`)
}

export async function updateRoom(
  roomId: number,
  data: { name?: string; description?: string; avatar_file?: File | null },
): Promise<Room> {
  const formData = new FormData()
  if (data.name !== undefined) formData.append('name', data.name)
  if (data.description !== undefined) formData.append('description', data.description)
  if (data.avatar_file) formData.append('avatar_file', data.avatar_file)
  const response = await api.patch<Room>(`rooms/${roomId}/`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function deleteRoom(roomId: number): Promise<void> {
  await api.delete(`rooms/${roomId}/`)
}

export async function leaveRoom(roomId: number): Promise<void> {
  await api.post(`rooms/${roomId}/leave/`)
}

export async function archiveRoom(roomId: number): Promise<{ archived: boolean }> {
  const response = await api.post<{ archived: boolean }>(`rooms/${roomId}/archive/`)
  return response.data
}

export async function addMembers(roomId: number, userIds: number[]): Promise<void> {
  await api.post(`rooms/${roomId}/add_members/`, { user_ids: userIds })
}

export async function removeMember(roomId: number, userId: number): Promise<void> {
  await api.post(`rooms/${roomId}/remove_member/`, { user_id: userId })
}

export async function transferOwnership(roomId: number, userId: number): Promise<void> {
  await api.post(`rooms/${roomId}/transfer_ownership/`, { user_id: userId })
}

export async function setMemberRole(roomId: number, userId: number, role: 'admin' | 'member'): Promise<void> {
  await api.post(`rooms/${roomId}/set_role/`, { user_id: userId, role })
}

export async function muteMember(roomId: number, userId: number): Promise<void> {
  await api.post(`rooms/${roomId}/mute/`, { user_id: userId })
}

export async function banMember(roomId: number, userId: number): Promise<void> {
  await api.post(`rooms/${roomId}/ban/`, { user_id: userId })
}

export async function createInviteLink(roomId: number): Promise<string> {
  const response = await api.post<{ invite_url: string }>(`rooms/${roomId}/invite_link/`)
  return response.data.invite_url
}

export async function joinRoomByToken(token: string): Promise<Room> {
  const response = await api.post<Room>('rooms/join/', { token })
  return response.data
}

export async function getActivityLogs(roomId: number): Promise<ActivityEntry[]> {
  const response = await api.get<{ results: ActivityEntry[] }>(`rooms/${roomId}/activity/`)
  return response.data.results
}
