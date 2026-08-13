import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { ToastItem } from '../hooks/useToasts'

export function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm shadow-lg border text-gray-800 bg-white animate-toast-in ${
            toast.kind === 'success' ? 'border-green-200' : toast.kind === 'error' ? 'border-red-200' : 'border-indigo-200'
          }`}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 size={16} className="text-green-600 shrink-0" />
          ) : toast.kind === 'error' ? (
            <XCircle size={16} className="text-red-600 shrink-0" />
          ) : (
            <Info size={16} className="text-indigo-600 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Fermer la notification"
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
