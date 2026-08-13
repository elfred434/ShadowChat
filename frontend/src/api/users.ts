import { api } from './client'
import type { User } from './auth'

export async function getUsers(): Promise<User[]> {
  const response = await api.get<{ results: User[] }>('users/')
  return response.data.results
}

export async function blockUser(userId: number): Promise<void> {
  await api.post(`users/${userId}/block/`)
}

export async function unblockUser(userId: number): Promise<void> {
  await api.post(`users/${userId}/unblock/`)
}

export async function getBlockedUsers(): Promise<{ id: number; blocked: User; created_at: string }[]> {
  const response = await api.get<{ id: number; blocked: User; created_at: string }[]>('users/blocked/')
  return response.data
}
