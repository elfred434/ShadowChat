import { createContext, useContext } from 'react'
import type { WsStatus } from '../api/ws'

export type SocketEvent = { event: string; payload: Record<string, unknown> }

export interface UserSocketContextValue {
  status: WsStatus
  subscribe: (callback: (event: SocketEvent) => void) => () => void
}

export const UserSocketContext = createContext<UserSocketContextValue | null>(null)

export function useUserSocketEvents(): UserSocketContextValue {
  const context = useContext(UserSocketContext)
  if (!context) throw new Error('useUserSocketEvents doit être utilisé dans <UserSocketProvider>.')
  return context
}
