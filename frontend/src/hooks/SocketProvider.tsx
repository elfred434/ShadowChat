import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createUserSocket, type WsStatus } from '../api/ws'
import { UserSocketContext, type SocketEvent } from './userSocketContext'

/**
 * Connexion WebSocket personnelle unique pour toute l'application
 * (notifications, présence, demandes d'amis, compteurs de non-lus).
 */
export function UserSocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WsStatus>('offline')
  const listenersRef = useRef(new Set<(event: SocketEvent) => void>())

  useEffect(() => {
    const socket = createUserSocket()
    socket.connect()
    const offStatus = socket.onStatus(setStatus)
    const offEvent = socket.on('*', (payload) => {
      const event = (payload as { event?: string }).event ?? ''
      listenersRef.current.forEach((listener) => listener({ event, payload: payload as Record<string, unknown> }))
    })
    return () => {
      offStatus()
      offEvent()
      socket.close()
    }
  }, [])

  const subscribe = (callback: (event: SocketEvent) => void) => {
    listenersRef.current.add(callback)
    return () => listenersRef.current.delete(callback)
  }

  return <UserSocketContext.Provider value={{ status, subscribe }}>{children}</UserSocketContext.Provider>
}
