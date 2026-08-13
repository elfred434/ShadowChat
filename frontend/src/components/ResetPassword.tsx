import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { confirmPasswordReset } from '../api/account'
import { apiErrorMessage } from '../api/client'

export function ResetPassword() {
  const { token } = useParams({ from: '/reinitialiser/$token' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const mutation = useMutation({
    mutationFn: () => confirmPasswordReset(token, password, confirm),
    onSuccess: () => setDone(true),
    onError: (err: unknown) => setErrorMsg(apiErrorMessage(err, 'Réinitialisation impossible.')),
  })

  return (
    <div className="flex items-center justify-center h-full bg-slate-50 dark:bg-slate-900">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setErrorMsg('')
          mutation.mutate()
        }}
        className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-md w-full max-w-sm border border-gray-100 dark:border-slate-700"
      >
        <h2 className="text-xl font-bold mb-6 text-center text-gray-800 dark:text-gray-100">Nouveau mot de passe</h2>
        {done ? (
          <div className="text-center" role="status">
            <div className="mb-4 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm rounded-lg px-3 py-2">
              Mot de passe réinitialisé avec succès.
            </div>
            <Link to="/login" className="text-sm font-semibold text-indigo-600 hover:underline">
              Se connecter
            </Link>
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="mb-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm rounded-lg px-3 py-2" role="alert">
                {errorMsg}
              </div>
            )}
            <div className="mb-4">
              <label htmlFor="new-password" className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2">
                Nouveau mot de passe
              </label>
              <input
                id="new-password"
                type="password"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-600 dark:text-gray-100"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="mb-6">
              <label htmlFor="new-password-confirm" className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2">
                Confirmer le mot de passe
              </label>
              <input
                id="new-password-confirm"
                type="password"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-600 dark:text-gray-100"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
            >
              {mutation.isPending ? 'Enregistrement…' : 'Réinitialiser le mot de passe'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
