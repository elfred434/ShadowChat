import { useEffect, useRef, useState } from 'react'
import { createRoomSocket, type WsStatus } from '../api/ws'

/**
 * Socket d'un salon (`/ws/rooms/<id>/`) : messages, frappe, accusés de lecture.
 * `roomId` null déconnecte le socket (aucun salon actif).
 * Le callback est mémorisé en interne : il peut être une fermeture fraîche.
 */
export function useRoomSocket(
  roomId: number | null,
  onEvent: (event: string, payload: Record<string, unknown>) => void,
) {
  const callbackRef = useRef(onEvent)
  const [status, setStatus] = useState<WsStatus>('offline')
  const socketRef = useRef<ReturnType<typeof createRoomSocket> | null>(null)

  useEffect(() => {
    callbackRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (roomId == null) {
      socketRef.current?.close()
      socketRef.current = null
      return
    }
    const socket = createRoomSocket(roomId)
    socketRef.current = socket
    socket.connect()
    const offStatus = socket.onStatus(setStatus)
    const offEvent = socket.on('*', (payload) => {
      const event = (payload as { event?: string }).event ?? ''
      callbackRef.current(event, payload as Record<string, unknown>)
    })
    return () => {
      offStatus()
      offEvent()
      socket.close()
      socketRef.current = null
    }
  }, [roomId])

  const send = (event: string, payload: Record<string, unknown> = {}) => {
    socketRef.current?.send(event, payload)
  }

  return { status: roomId == null ? 'offline' : status, send }
}
