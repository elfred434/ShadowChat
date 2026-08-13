import { useCallback, useRef, useState } from 'react'

export interface ToastItem {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
}

let toastId = 0

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) clearTimeout(timer)
    timersRef.current.delete(id)
  }, [])

  const push = useCallback(
    (message: string, kind: ToastItem['kind'] = 'info') => {
      const id = ++toastId
      setToasts((current) => [...current.slice(-3), { id, message, kind }])
      const timer = setTimeout(() => dismiss(id), 4500)
      timersRef.current.set(id, timer)
    },
    [dismiss],
  )

  return { toasts, push, dismiss }
}
