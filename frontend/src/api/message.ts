import { api } from './client'
import type { User } from './auth'

export interface Attachment {
  id: number
  url: string
  original_name: string
  content_type: string
  size: number
}

export interface ReactionSummary {
  emoji: string
  count: number
  me: boolean
}

export interface ParentPreview {
  id: number
  content: string
  is_deleted: boolean
  sender: string
}

export interface Message {
  id: number
  room: number
  sender: User
  content: string
  parent: number | null
  parent_preview: ParentPreview | null
  attachments: Attachment[]
  reactions: ReactionSummary[]
  read_by: number[]
  is_deleted: boolean
  is_pinned: boolean
  edited_at: string | null
  created_at: string
}

export interface MessagePage {
  results: Message[]
  next: string | null
  previous: string | null
}

export interface MessageQuery {
  roomId?: number
  search?: string
  authorId?: number
  since?: string
  until?: string
}

export async function getMessages(query: MessageQuery): Promise<MessagePage> {
  const params: Record<string, string | number> = {}
  if (query.roomId) params.room_id = query.roomId
  if (query.search) params.search = query.search
  if (query.authorId) params.author_id = query.authorId
  if (query.since) params.since = query.since
  if (query.until) params.until = query.until
  const response = await api.get<MessagePage>('messages/', { params })
  return response.data
}

export async function getMessagesPage(url: string): Promise<MessagePage> {
  const response = await api.get<MessagePage>(url)
  return response.data
}

export interface SendMessagePayload {
  room: number
  content: string
  parent?: number | null
  files?: File[]
}

export async function sendMessage(payload: SendMessagePayload): Promise<Message> {
  const formData = new FormData()
  formData.append('room', String(payload.room))
  formData.append('content', payload.content)
  if (payload.parent) formData.append('parent', String(payload.parent))
  payload.files?.forEach((file) => formData.append('files', file))
  const response = await api.post<Message>('messages/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function editMessage(messageId: number, content: string): Promise<Message> {
  const response = await api.patch<Message>(`messages/${messageId}/`, { content })
  return response.data
}

export async function deleteMessage(messageId: number): Promise<void> {
  await api.delete(`messages/${messageId}/`)
}

export async function reactToMessage(messageId: number, emoji: string): Promise<void> {
  await api.post(`messages/${messageId}/react/`, { emoji })
}

export async function unreactMessage(messageId: number, emoji: string): Promise<void> {
  await api.post(`messages/${messageId}/unreact/`, { emoji })
}

export async function pinMessage(messageId: number): Promise<void> {
  await api.post(`messages/${messageId}/pin/`)
}

export async function unpinMessage(messageId: number): Promise<void> {
  await api.post(`messages/${messageId}/unpin/`)
}

export async function markMessageRead(messageId: number): Promise<void> {
  await api.post(`messages/${messageId}/read/`)
}

export interface ReadReceipt {
  user: User
  read_at: string
}

export async function getMessageReceipts(messageId: number): Promise<ReadReceipt[]> {
  const response = await api.get<{ read_by: ReadReceipt[] }>(`messages/${messageId}/receipts/`)
  return response.data.read_by
}
