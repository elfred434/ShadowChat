import { api } from './client'
import type { User } from './auth'

export interface Message {
  id: number
  room: number
  sender: User
  content: string
  created_at: string
}

export async function getMessages(roomId: number, search?: string): Promise<Message[]> {
  const response = await api.get<Message[]>('messages/', { params: { room_id: roomId, ...(search ? { search } : {}) } })
  return response.data
}

export async function sendMessage(roomId: number, content: string): Promise<Message> {
  const response = await api.post<Message>('messages/', { room: roomId, content })
  return response.data
}
