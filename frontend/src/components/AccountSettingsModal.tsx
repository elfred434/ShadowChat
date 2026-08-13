import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Laptop, Mail, ShieldCheck, X } from 'lucide-react'
import type { User } from '../api/auth'
import {
  changePassword,
  getSessions,
  resendVerificationEmail,
  revokeSession,
  totpDisable,
  totpEnable,
  totpSetup,
  type SessionInfo,
} from '../api/account'
import { apiErrorMessage } from '../api/client'

interface AccountSettingsModalProps {
  user: User
  onClose: () => void
}

type Feedback = { kind: 'success' | 'error'; message: string } | null

function FeedbackBox({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null
  return (
    <div
      role={feedback.kind === 'error' ? 'alert' : 'status'}
      className={`mb-3 text-sm rounded-lg px-3 py-2 border ${
        feedback.kind === 'success'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-900 dark:text-emerald-300'
          : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950 dark:border-red-900 dark:text-red-300'
      }`}
    >
      {feedback.message}
    </div>
  )
}

/** Compte & sécurité : e-mail, mot de passe, 2FA, sessions actives. */
export function AccountSettingsModal({ user, onClose }: AccountSettingsModalProps) {
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<Feedback>(null)

  // Mot de passe
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')

  // 2FA
  const [twoFaSecret, setTwoFaSecret] = useState<string | null>(null)
  const [twoFaCode, setTwoFaCode] = useState('')
  const [twoFaPassword, setTwoFaPassword] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const refreshUser = () => queryClient.invalidateQueries({ queryKey: ['currentUser'] })

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: getSessions,
  })

  const passwordMutation = useMutation({
    mutationFn: () => changePassword(oldPassword, newPassword, newPasswordConfirm),
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Mot de passe modifié.' })
      setOldPassword('')
      setNewPassword('')
      setNewPasswordConfirm('')
    },
    onError: (err: unknown) => setFeedback({ kind: 'error', message: apiErrorMessage(err, 'Modification impossible.') }),
  })

  const resendMutation = useMutation({
    mutationFn: resendVerificationEmail,
    onSuccess: (data) => setFeedback({ kind: 'success', message: data.message }),
    onError: (err: unknown) => setFeedback({ kind: 'error', message: apiErrorMessage(err, 'Envoi impossible.') }),
  })

  const setupMutation = useMutation({
    mutationFn: totpSetup,
    onSuccess: (data) => setTwoFaSecret(data.secret),
    onError: (err: unknown) => setFeedback({ kind: 'error', message: apiErrorMessage(err, 'Configuration impossible.') }),
  })

  const enableMutation = useMutation({
    mutationFn: () => totpEnable(twoFaCode),
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Double authentification activée.' })
      setTwoFaSecret(null)
      setTwoFaCode('')
      refreshUser()
    },
    onError: (err: unknown) => setFeedback({ kind: 'error', message: apiErrorMessage(err, 'Code incorrect.') }),
  })

  const disableMutation = useMutation({
    mutationFn: () => totpDisable(twoFaPassword),
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Double authentification désactivée.' })
      setTwoFaPassword('')
      refreshUser()
    },
    onError: (err: unknown) => setFeedback({ kind: 'error', message: apiErrorMessage(err, 'Mot de passe incorrect.') }),
  })

  const revokeMutation = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Session révoquée.' })
      refetchSessions()
    },
    onError: (err: unknown) => setFeedback({ kind: 'error', message: apiErrorMessage(err, 'Révocation impossible.') }),
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Compte et sécurité"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <ShieldCheck size={18} className="text-indigo-600" />
            Compte &amp; sécurité
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          <FeedbackBox feedback={feedback} />

          {/* Vérification e-mail */}
          <section aria-label="Vérification de l'adresse e-mail">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
              <Mail size={14} className="text-indigo-500" /> Adresse e-mail
            </h3>
            {user.email ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
                  {user.email}{' '}
                  <span className={user.email_verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                    ({user.email_verified ? 'vérifiée' : 'non vérifiée'})
                  </span>
                </p>
                {!user.email_verified && (
                  <button
                    type="button"
                    onClick={() => resendMutation.mutate()}
                    disabled={resendMutation.isPending}
                    className="text-xs font-semibold text-indigo-600 hover:underline shrink-0"
                  >
                    Renvoyer le lien
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Aucune adresse e-mail associée à ce compte.</p>
            )}
          </section>

          {/* Changement de mot de passe */}
          <section aria-label="Changement de mot de passe">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
              <KeyRound size={14} className="text-indigo-500" /> Changer le mot de passe
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="password"
                placeholder="Mot de passe actuel"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                aria-label="Mot de passe actuel"
                className="rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:text-gray-100"
              />
              <input
                type="password"
                placeholder="Nouveau"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                aria-label="Nouveau mot de passe"
                className="rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:text-gray-100"
              />
              <input
                type="password"
                placeholder="Confirmation"
                value={newPasswordConfirm}
                onChange={(event) => setNewPasswordConfirm(event.target.value)}
                aria-label="Confirmer le nouveau mot de passe"
                className="rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:text-gray-100"
              />
            </div>
            <button
              type="button"
              onClick={() => passwordMutation.mutate()}
              disabled={passwordMutation.isPending || !oldPassword || !newPassword}
              className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Enregistrer
            </button>
          </section>

          {/* Double authentification */}
          <section aria-label="Double authentification">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-indigo-500" /> Double authentification (TOTP)
            </h3>
            {user.two_factor_enabled ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-emerald-600 dark:text-emerald-400">Activée sur ce compte.</p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="Mot de passe pour désactiver"
                    value={twoFaPassword}
                    onChange={(event) => setTwoFaPassword(event.target.value)}
                    aria-label="Mot de passe pour désactiver la 2FA"
                    className="rounded-lg border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={() => disableMutation.mutate()}
                    disabled={disableMutation.isPending || !twoFaPassword}
                    className="rounded-lg border border-red-200 text-red-600 dark:border-red-900 dark:text-red-400 px-3 py-1.5 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                  >
                    Désactiver
                  </button>
                </div>
              </div>
            ) : twoFaSecret ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Ajoutez ce secret dans votre application d'authentification (Google Authenticator, Aegis…) :
                </p>
                <code className="block rounded-lg bg-gray-100 dark:bg-slate-900 px-3 py-2 text-xs break-all text-gray-700 dark:text-gray-200">
                  {twoFaSecret}
                </code>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Code affiché"
                    value={twoFaCode}
                    onChange={(event) => setTwoFaCode(event.target.value)}
                    aria-label="Code de vérification TOTP"
                    className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={() => enableMutation.mutate()}
                    disabled={enableMutation.isPending || !twoFaCode}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Activer
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setupMutation.mutate()}
                disabled={setupMutation.isPending}
                className="rounded-lg border border-indigo-200 text-indigo-600 dark:border-indigo-900 dark:text-indigo-400 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950"
              >
                Configurer la 2FA
              </button>
            )}
          </section>

          {/* Sessions actives */}
          <section aria-label="Sessions actives">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
              <Laptop size={14} className="text-indigo-500" /> Sessions actives ({sessions.length})
            </h3>
            <ul className="divide-y divide-gray-100 dark:divide-slate-700">
              {sessions.map((session: SessionInfo) => (
                <li key={session.session_key} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700 dark:text-gray-200 truncate">
                      Session <span className="font-mono text-xs">{session.session_key.slice(-8)}</span>
                      {session.is_current && <span className="ml-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">(cette session)</span>}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      Expire le {new Date(session.expire_date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </p>
                  </div>
                  {!session.is_current && (
                    <button
                      type="button"
                      onClick={() => revokeMutation.mutate(session.session_key)}
                      className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline shrink-0"
                    >
                      Révoquer
                    </button>
                  )}
                </li>
              ))}
              {sessions.length === 0 && <li className="py-2 text-sm text-gray-400">Aucune session active.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
