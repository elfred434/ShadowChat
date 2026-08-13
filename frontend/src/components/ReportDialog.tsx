import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Flag, X } from 'lucide-react'
import { reportMessage, reportUser } from '../api/account'
import { apiErrorMessage } from '../api/client'

interface ReportDialogProps {
  kind: 'user' | 'message'
  targetId: number
  targetLabel: string
  onClose: () => void
  onReported: (message: string) => void
}

/** Modale de signalement (compte ou message) transmise à la modération. */
export function ReportDialog({ kind, targetId, targetLabel, onClose, onReported }: ReportDialogProps) {
  const [reason, setReason] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const mutation = useMutation({
    mutationFn: () => (kind === 'user' ? reportUser(targetId, reason) : reportMessage(targetId, reason)),
    onSuccess: (data) => onReported(data.message),
    onError: (err: unknown) => setErrorMsg(apiErrorMessage(err, 'Signalement impossible.')),
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Signaler ${targetLabel}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Flag size={16} className="text-red-500" />
            Signaler {targetLabel}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500">
            <X size={16} />
          </button>
        </div>
        {errorMsg && (
          <div className="mb-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm rounded-lg px-3 py-2" role="alert">
            {errorMsg}
          </div>
        )}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Décrivez le problème (contenu abusif, spam, harcèlement…)"
          rows={4}
          maxLength={500}
          aria-label="Motif du signalement"
          className="w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none dark:bg-slate-900 dark:text-gray-100"
          autoFocus
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={mutation.isPending || reason.trim().length === 0}
            onClick={() => mutation.mutate()}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
          >
            Envoyer le signalement
          </button>
        </div>
      </div>
    </div>
  )
}
