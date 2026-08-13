// Client WebSocket temps réel avec reconnexion automatique (backoff exponentiel).
// Le polling React Query reste le mécanisme de repli quand le socket est déconnecté.

export type WsStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

export type WsEvent = { event: string; payload: Record<string, unknown> }

export class ChatSocket {
  private socket: WebSocket | null = null
  private url: string
  private listeners = new Map<string, Set<(payload: Record<string, unknown>) => void>>()
  private statusListeners = new Set<(status: WsStatus) => void>()
  private status: WsStatus = 'offline'
  private shouldReconnect = true
  private reconnectAttempts = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private closedByUser = false

  constructor(url: string) {
    this.url = url
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.closedByUser = false
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.onopen = () => {
      this.reconnectAttempts = 0
      this.setStatus('connected')
      this.startHeartbeat()
    }
    socket.onmessage = (raw) => {
      try {
        const message = JSON.parse(raw.data as string) as WsEvent
        this.listeners.get(message.event)?.forEach((callback) => callback(message.payload ?? {}))
        this.listeners.get('*')?.forEach((callback) => callback({ event: message.event, ...(message.payload ?? {}) }))
      } catch {
        // message non-JSON : ignoré
      }
    }
    socket.onclose = () => {
      this.stopHeartbeat()
      if (!this.shouldReconnect || this.closedByUser) {
        this.setStatus('offline')
        return
      }
      this.scheduleReconnect()
    }
    socket.onerror = () => {
      socket.close()
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000)
    this.reconnectAttempts += 1
    this.setStatus('reconnecting')
    window.setTimeout(() => {
      if (this.shouldReconnect && !this.closedByUser) this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => this.send('ping'), 25_000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  send(event: string, payload: Record<string, unknown> = {}): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ event, payload }))
      return true
    }
    return false
  }

  on(event: string, callback: (payload: Record<string, unknown>) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(callback)
    return () => this.listeners.get(event)?.delete(callback)
  }

  onStatus(callback: (status: WsStatus) => void): () => void {
    this.statusListeners.add(callback)
    callback(this.status)
    return () => this.statusListeners.delete(callback)
  }

  get currentStatus(): WsStatus {
    return this.status
  }

  private setStatus(status: WsStatus): void {
    if (this.status === status) return
    this.status = status
    this.statusListeners.forEach((callback) => callback(status))
  }

  close(): void {
    this.closedByUser = true
    this.shouldReconnect = false
    this.stopHeartbeat()
    this.socket?.close()
    this.setStatus('offline')
  }
}

// URL du WebSocket : même origine (proxée par Vite/Nginx), ou VITE_WS_URL explicite.
function buildWsUrl(path: string): string {
  if (import.meta.env.VITE_WS_URL) {
    return `${import.meta.env.VITE_WS_URL}${path}`
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

export function createRoomSocket(roomId: number): ChatSocket {
  return new ChatSocket(buildWsUrl(`/ws/rooms/${roomId}/`))
}

export function createUserSocket(): ChatSocket {
  return new ChatSocket(buildWsUrl('/ws/user/'))
}
