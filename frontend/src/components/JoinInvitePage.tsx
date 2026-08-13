import { useEffect, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { joinRoomByToken } from '../api/room'

/** Rejoint un groupe via un lien d'invitation temporaire (`/#/rejoindre/<token>`). */
export function JoinInvitePage() {
  const navigate = useNavigate()
  const { token } = useParams({ from: '/rejoindre/$token' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    joinRoomByToken(token)
      .then((room) => {
        if (!cancelled) {
          navigate({ to: '/', search: { room: room.id } })
        }
      })
      .catch(() => {
        if (!cancelled) setError('Ce lien d’invitation est invalide ou a expiré.')
      })
    return () => {
      cancelled = true
    }
  }, [token, navigate])

  const goHome = () => navigate({ to: '/', search: {} })

  return (
    <div className="flex h-full items-center justify-center bg-gray-50">
      <div className="rounded-2xl bg-white border border-gray-200 shadow-sm px-8 py-10 text-center max-w-sm">
        {error ? (
          <>
            <h1 className="text-lg font-bold text-gray-800 mb-2">Invitation impossible</h1>
            <p className="text-sm text-gray-500 mb-4">{error}</p>
            <button
              type="button"
              onClick={goHome}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2"
            >
              Retour à la messagerie
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" aria-hidden="true" />
            <h1 className="text-lg font-bold text-gray-800 mb-1">Rejoindre le groupe…</h1>
            <p className="text-sm text-gray-500">Vérification du lien d’invitation.</p>
          </>
        )}
      </div>
    </div>
  )
}
