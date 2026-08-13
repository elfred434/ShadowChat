import React, { useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { loginUser } from '../api/auth'
import { completeLogin2fa } from '../api/account'
import { apiErrorMessage } from '../api/client'

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const finishLogin = () => {
    queryClient.invalidateQueries({ queryKey: ['currentUser'] })
    navigate({ to: '/' })
  }

  const loginMutation = useMutation({
    mutationFn: () => loginUser(username, password),
    onSuccess: (data) => {
      if ('requires_2fa' in data && data.requires_2fa) {
        setPendingToken(data.token)
        setErrorMsg('')
      } else {
        finishLogin()
      }
    },
    onError: (err: unknown) => {
      setErrorMsg(apiErrorMessage(err, 'Erreur lors de la connexion.'))
    },
  })

  const twoFaMutation = useMutation({
    mutationFn: () => completeLogin2fa(pendingToken!, code),
    onSuccess: finishLogin,
    onError: (err: unknown) => {
      setErrorMsg(apiErrorMessage(err, 'Code de vérification incorrect.'))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    loginMutation.mutate()
  }

  const handle2faSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    twoFaMutation.mutate()
  }

  return (
    <div className="flex items-center justify-center h-full bg-slate-50 dark:bg-slate-900">
      <form
        onSubmit={pendingToken ? handle2faSubmit : handleSubmit}
        className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-md w-full max-w-sm border border-gray-100 dark:border-slate-700"
      >
        <h2 className="text-2xl font-bold mb-1 text-center text-gray-800 dark:text-gray-100">Connexion</h2>
        <p className="text-center text-xs text-gray-400 mb-6">ShadowChat</p>
        {errorMsg && (
          <div className="mb-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm rounded-lg px-3 py-2" role="alert">
            {errorMsg}
          </div>
        )}

        {pendingToken ? (
          <>
            <div className="mb-4">
              <label htmlFor="2fa-code" className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2">
                Code de vérification (2FA)
              </label>
              <input
                id="2fa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-600 dark:text-gray-100"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
              />
              <p className="mt-2 text-xs text-gray-400">Saisissez le code affiché dans votre application d'authentification.</p>
            </div>
            <button
              type="submit"
              disabled={twoFaMutation.isPending}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
            >
              {twoFaMutation.isPending ? 'Vérification…' : 'Valider'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingToken(null)
                setCode('')
              }}
              className="w-full mt-2 text-xs text-gray-500 hover:underline"
            >
              Revenir à la connexion
            </button>
          </>
        ) : (
          <>
            <div className="mb-4">
              <label htmlFor="username" className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2">
                Nom d'utilisateur
              </label>
              <input
                id="username"
                type="text"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-600 dark:text-gray-100"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="mb-6">
              <label htmlFor="password" className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-600 dark:text-gray-100"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
            >
              {loginMutation.isPending ? 'Connexion en cours' : 'Se connecter'}
            </button>
            <div className="mt-3 text-right">
              <Link to="/mot-de-passe-oublie" className="text-xs text-indigo-600 hover:underline">
                Mot de passe oublié ?
              </Link>
            </div>
          </>
        )}

        <p className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
          Vous n'avez pas de compte ?{' '}
          <Link to="/register" className="text-indigo-600 hover:underline font-semibold">
            Créer un compte
          </Link>
        </p>
      </form>
    </div>
  )
}
