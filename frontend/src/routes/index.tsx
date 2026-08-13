import { createFileRoute, redirect } from '@tanstack/react-router'
import { getCurrentUser } from '@/api/auth'
import { ChatDashboard } from '@/components/ChatDashboard'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    // Vérification côté client uniquement : le document initial est rendu
    // par le serveur de dev sans cookie de session.
    if (typeof window === 'undefined') return
    try {
      await getCurrentUser()
    } catch {
      throw redirect({ to: '/login' })
    }
  },
  validateSearch: (search: Record<string, unknown>): { room?: number } => ({
    room: typeof search.room === 'string' && search.room ? Number(search.room) : undefined,
  }),
  component: ChatDashboard,
})
