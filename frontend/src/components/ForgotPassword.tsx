import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { requestPasswordReset } from '../api/account'
import { apiErrorMessage } from '../api/client'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  const mutation = useMutation({
    mutationFn: () => requestPasswordReset(email),
    onSuccess: () => setSent(true),
    onError: (err: unknown) => {
      // Message générique : ne pas révéler si l'adresse existe.
      void apiErrorMessage(err, '')
    },
  })

  return (
    <div className="flex items-center justify-center h-full bg-slate-50 dark:bg-slate-900">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
        className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-md w-full max-w-sm border border-gray-100 dark:border-slate-700"
      >
        <h2 className="text-xl font-bold mb-1 text-center text-gray-800 dark:text-gray-100">Mot de passe oublié</h2>
        <p className="text-center text-xs text-gray-400 mb-6">
          Nous vous enverrons un lien de réinitialisation (valable 15 minutes).
        </p>
        {sent ? (
          <div className="text-center" role="status">
            <div className="mb-4 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm rounded-lg px-3 py-2">
              Si cette adresse est associée à un compte, un e-mail vient d'être envoyé.
            </div>
            <Link to="/login" className="text-sm text-indigo-600 hover:underline">
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label htmlFor="reset-email" className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2">
                Adresse e-mail
              </label>
              <input
                id="reset-email"
                type="email"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-600 dark:text-gray-100"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
            >
              {mutation.isPending ? 'Envoi…' : 'Envoyer le lien'}
            </button>
            <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
              <Link to="/login" className="text-indigo-600 hover:underline">
                Retour à la connexion
              </Link>
            </p>
          </>
        )}
      </form>
    </div>
  )
}
