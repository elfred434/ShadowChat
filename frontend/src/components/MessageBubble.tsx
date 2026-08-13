import { useMemo, useRef, useState } from 'react'
import { Check, CheckCheck, CornerUpLeft, FileText, Pencil, Pin, Smile, Trash2 } from 'lucide-react'
import type { Message } from '../api/message'
import type { User } from '../api/auth'
import { Avatar } from './Avatar'
import { ReactionPicker } from './ReactionPicker'

interface MessageBubbleProps {
  message: Message
  currentUser: User
  isGroup: boolean
  showSender: boolean
  canManage: boolean
  onReply: (message: Message) => void
  onEdit: (messageId: number, content: string) => void
  onDelete: (messageId: number) => void
  onReact: (messageId: number, emoji: string) => void
  onPinToggle: (message: Message) => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function isImageAttachment(contentType: string): boolean {
  return contentType.startsWith('image/')
}

export function MessageBubble({
  message,
  currentUser,
  isGroup,
  showSender,
  canManage,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onPinToggle,
}: MessageBubbleProps) {
  const mine = message.sender.id === currentUser.id
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [showPicker, setShowPicker] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const readers = useMemo(() => message.read_by ?? [], [message.read_by])

  const submitEdit = () => {
    const content = draft.trim()
    if (content && content !== message.content) onEdit(message.id, content)
    setEditing(false)
    setMenuOpen(false)
  }

  if (message.is_deleted) {
    return (
      <div className={`px-4 py-1.5 ${mine ? 'text-right' : ''}`}>
        <span className="text-xs italic text-gray-400">Message supprimé</span>
      </div>
    )
  }

  return (
    <div className={`group flex gap-2 px-4 py-1 hover:bg-gray-50 ${mine ? 'flex-row-reverse' : ''}`}>
      <div className="w-8 shrink-0">
        {(isGroup || !mine) && showSender && <Avatar user={message.sender} size="sm" />}
      </div>
      <div className={`max-w-[75%] min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {isGroup && showSender && (
          <span className="text-[11px] font-medium text-gray-500 ml-1 mb-0.5">{message.sender.username}</span>
        )}

        {message.parent_preview && (
          <button
            type="button"
            onClick={() => document.getElementById(`message-${message.parent_preview!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className={`mb-1 flex items-center gap-1 text-[11px] text-gray-500 bg-gray-100 hover:bg-gray-200 rounded px-2 py-0.5 max-w-full ${mine ? 'justify-end' : ''}`}
          >
            <CornerUpLeft size={11} className="shrink-0" />
            <span className="truncate">
              {message.parent_preview.is_deleted ? 'Message supprimé' : `Réponse à ${message.parent_preview.sender}`}
            </span>
          </button>
        )}

        <div
          id={`message-${message.id}`}
          className={`relative rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap shadow-sm ${
            mine ? 'bg-indigo-600 text-white rounded-br-md' : 'bg-white text-gray-800 rounded-bl-md border border-gray-200'
          } ${message.is_pinned ? 'ring-2 ring-amber-400' : ''}`}
        >
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitEdit()
                  if (event.key === 'Escape') setEditing(false)
                }}
                className="w-64 bg-transparent outline-none placeholder:text-gray-300"
                aria-label="Modifier le message"
              />
              <button type="button" onClick={submitEdit} className="text-xs opacity-80 hover:opacity-100" aria-label="Enregistrer">
                <Check size={14} />
              </button>
            </div>
          ) : (
            <p>
              {message.content}
              {message.edited_at && <span className="text-[10px] opacity-60 ml-1">(modifié)</span>}
            </p>
          )}

          {message.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              {message.attachments.map((attachment) =>
                isImageAttachment(attachment.content_type) ? (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Ouvrir l'image ${attachment.original_name}`}
                  >
                    <img
                      src={attachment.url}
                      alt={attachment.original_name}
                      loading="lazy"
                      className="max-h-56 max-w-full rounded-lg object-cover"
                    />
                  </a>
                ) : (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                      mine ? 'bg-white/15 hover:bg-white/25' : 'bg-gray-100 hover:bg-gray-200'
                    }`}
                  >
                    <FileText size={16} className="shrink-0" />
                    <span className="flex flex-col min-w-0">
                      <span className="truncate font-medium">{attachment.original_name}</span>
                      <span className="opacity-70">{formatSize(attachment.size)}</span>
                    </span>
                  </a>
                ),
              )}
            </div>
          )}

          <div className={`flex items-center gap-1 text-[10px] mt-0.5 ${mine ? 'justify-end text-white/70' : 'text-gray-400'}`}>
            <span>{formatTime(message.created_at)}</span>
            {isGroup && message.is_pinned && <Pin size={10} className="text-amber-500" aria-label="Message épinglé" />}
            {mine &&
              (readers.length > 0 ? (
                <CheckCheck size={12} className="text-sky-300" aria-label="Lu" />
              ) : (
                <Check size={12} aria-label="Envoyé" />
              ))}
            {isGroup && readers.length > 0 && !mine && (
              <span className="text-gray-400">Lu par {readers.length}</span>
            )}
          </div>

          {/* Actions au survol */}
          {!editing && (
            <div
              className={`absolute -top-3 flex items-center gap-0.5 rounded-full border border-gray-200 bg-white shadow-sm px-1 py-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${
                mine ? 'right-2' : 'left-2'
              }`}
            >
              <button
                type="button"
                onClick={() => onReply(message)}
                title="Répondre"
                aria-label="Répondre"
                className="p-1 rounded-full text-gray-500 hover:bg-gray-100"
              >
                <CornerUpLeft size={12} />
              </button>
              <button
                type="button"
                onClick={() => setShowPicker((open) => !open)}
                title="Réagir"
                aria-label="Réagir avec un émoji"
                className="p-1 rounded-full text-gray-500 hover:bg-gray-100"
              >
                <Smile size={12} />
              </button>
              {showPicker && (
                <ReactionPicker
                  onPick={(emoji) => {
                    onReact(message.id, emoji)
                    setShowPicker(false)
                  }}
                  onClose={() => setShowPicker(false)}
                />
              )}
              <button
                type="button"
                onClick={() => onPinToggle(message)}
                title={message.is_pinned ? 'Désépingler' : 'Épingler'}
                aria-label={message.is_pinned ? 'Désépingler le message' : 'Épingler le message'}
                className={`p-1 rounded-full hover:bg-gray-100 ${message.is_pinned ? 'text-amber-500' : 'text-gray-500'}`}
              >
                <Pin size={12} />
              </button>
              {mine && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(message.content)
                    setEditing(true)
                    setMenuOpen(false)
                    window.setTimeout(() => inputRef.current?.focus(), 0)
                  }}
                  title="Modifier"
                  aria-label="Modifier le message"
                  className="p-1 rounded-full text-gray-500 hover:bg-gray-100"
                >
                  <Pencil size={12} />
                </button>
              )}
              {(mine || canManage) &&
                (confirmDelete ? (
                  <span className="flex items-center gap-1 px-1">
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(message.id)
                        setConfirmDelete(false)
                        setMenuOpen(false)
                      }}
                      className="text-[10px] font-semibold text-red-600"
                    >
                      Confirmer
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-[10px] text-gray-500"
                    >
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(true)
                      setMenuOpen(false)
                    }}
                    title="Supprimer"
                    aria-label="Supprimer le message"
                    className="p-1 rounded-full text-gray-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={12} />
                  </button>
                ))}
            </div>
          )}
          {menuOpen && <div className="hidden" aria-hidden="true" />}
        </div>

        {message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => (reaction.me ? onReact(message.id, reaction.emoji) : onReact(message.id, reaction.emoji))}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                  reaction.me
                    ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
                title={reaction.me ? 'Retirer ma réaction' : 'Ajouter cette réaction'}
              >
                <span>{reaction.emoji}</span>
                <span className="text-[10px] font-medium">{reaction.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
