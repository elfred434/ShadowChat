import { useEffect, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { verifyEmail } from '../api/account'
import { apiErrorMessage } from '../api/client'

export function VerifyEmailPage() {
  const { token } = useParams({ from: '/verifier-email/$token' })
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    verifyEmail(token)
      .then((response) => {
        if (!cancelled) {
          setState('success')
          setMessage(response.message)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState('error')
          setMessage(apiErrorMessage(err, 'Ce lien est invalide ou a déjà été utilisé.'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="flex items-center justify-center h-full bg-slate-50 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-md w-full max-w-sm border border-gray-100 dark:border-slate-700 text-center">
        <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-100">Vérification de l'e-mail</h2>
        {state === 'loading' && (
          <>
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" aria-hidden="true" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Vérification en cours…</p>
          </>
        )}
        {state === 'success' && (
          <div className="mb-4 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm rounded-lg px-3 py-2" role="status">
            {message}
          </div>
        )}
        {state === 'error' && (
          <div className="mb-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm rounded-lg px-3 py-2" role="alert">
            {message}
          </div>
        )}
        <Link to="/" className="text-sm font-semibold text-indigo-600 hover:underline">
          Aller à la messagerie
        </Link>
      </div>
    </div>
  )
}
