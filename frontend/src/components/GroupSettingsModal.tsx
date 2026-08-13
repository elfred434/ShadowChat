import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Ban,
  Copy,
  Crown,
  Link2,
  LogOut,
  Shield,
  ShieldOff,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import type { User } from '../api/auth'
import type { Membership, Room } from '../api/room'
import {
  addMembers,
  archiveRoom,
  banMember,
  createInviteLink,
  deleteRoom,
  getActivityLogs,
  leaveRoom,
  muteMember,
  removeMember,
  setMemberRole,
  transferOwnership,
  updateRoom,
} from '../api/room'
import { Avatar } from './Avatar'

interface GroupSettingsModalProps {
  room: Room
  currentUser: User
  friends: User[]
  onClose: () => void
  onRoomChanged: () => void
  onRoomDeleted: () => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}

const ROLE_LABELS: Record<Membership['role'], string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  member: 'Membre',
}

export function GroupSettingsModal({
  room,
  currentUser,
  friends,
  onClose,
  onRoomChanged,
  onRoomDeleted,
  onToast,
}: GroupSettingsModalProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(room.name ?? '')
  const [description, setDescription] = useState(room.description ?? '')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [tab, setTab] = useState<'membres' | 'activite'>('membres')
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('')

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['rooms'] })
    queryClient.invalidateQueries({ queryKey: ['room', room.id] })
    onRoomChanged()
  }

  const activityQuery = useQuery({
    queryKey: ['activity', room.id],
    queryFn: () => getActivityLogs(room.id),
    enabled: tab === 'activite',
  })

  const saveInfoMutation = useMutation({
    mutationFn: () => updateRoom(room.id, { name, description, avatar_file: avatarFile }),
    onSuccess: () => {
      onToast('Salon mis à jour.', 'success')
      refresh()
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error.response as { data?: { error?: string } }).data?.error
          : undefined
      onToast(message ?? 'Échec de la mise à jour.', 'error')
    },
  })

  const memberMutation = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: () => refresh(),
    onError: (error: unknown) => {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error.response as { data?: { error?: string } }).data?.error
          : undefined
      onToast(message ?? 'Action impossible.', 'error')
    },
  })

  const inviteMutation = useMutation({
    mutationFn: () => createInviteLink(room.id),
    onSuccess: (url) => {
      navigator.clipboard?.writeText(url).catch(() => undefined)
      onToast('Lien d’invitation copié dans le presse-papiers.', 'success')
    },
    onError: () => onToast('Impossible de créer le lien.', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteRoom(room.id),
    onSuccess: () => {
      onToast('Groupe supprimé.', 'success')
      onRoomDeleted()
    },
    onError: () => onToast('Suppression impossible.', 'error'),
  })

  const memberships: Membership[] = room.memberships ?? []
  const addableFriends = friends.filter((friend) => !memberships.some((membership) => membership.user.id === friend.id))
  const canManage = room.can_manage || room.my_role === 'owner'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Paramètres du groupe"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Users size={18} className="text-indigo-600" />
            Paramètres du groupe
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {canManage ? (
            <section aria-label="Informations du groupe">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Informations</h3>
              <div className="flex items-start gap-4">
                {avatarFile ? (
                  <img src={URL.createObjectURL(avatarFile)} alt="Aperçu de l'avatar" className="w-16 h-16 rounded-full object-cover" />
                ) : room.avatar ? (
                  <img src={room.avatar} alt="Avatar du groupe" className="w-16 h-16 rounded-full object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                    <Users size={24} />
                  </div>
                )}
                <div className="flex-1 space-y-2">
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Nom du groupe"
                    aria-label="Nom du groupe"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Description"
                    rows={2}
                    aria-label="Description du groupe"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-medium text-indigo-600 cursor-pointer hover:underline">
                      Changer l’avatar
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={saveInfoMutation.isPending}
                      onClick={() => saveInfoMutation.mutate()}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Enregistrer
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section aria-label="Nom et description">
              <h2 className="text-lg font-bold text-gray-800">{room.name ?? 'Groupe'}</h2>
              {room.description && <p className="text-sm text-gray-500 mt-1">{room.description}</p>}
            </section>
          )}

          {canManage && (
            <section aria-label="Invitation">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Invitation par lien temporaire</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => inviteMutation.mutate()}
                  className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  <Link2 size={14} />
                  {room.invite_url ? 'Régénérer et copier le lien' : 'Créer un lien d’invitation'}
                </button>
                {room.invite_url && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(room.invite_url!).catch(() => undefined)
                      onToast('Lien copié.', 'success')
                    }}
                    aria-label="Copier le lien d'invitation"
                    className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                  >
                    <Copy size={14} />
                  </button>
                )}
              </div>
            </section>
          )}

          <section aria-label="Membres">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">
                Membres ({memberships.length})
              </h3>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setTab('membres')}
                  className={`px-3 py-1.5 font-medium ${tab === 'membres' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  Membres
                </button>
                <button
                  type="button"
                  onClick={() => setTab('activite')}
                  className={`px-3 py-1.5 font-medium ${tab === 'activite' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  Activité
                </button>
              </div>
            </div>

            {tab === 'membres' ? (
              <>
                {canManage && addableFriends.length > 0 && (
                  <div className="flex gap-2 mb-3">
                    <select
                      value={selectedUserId}
                      onChange={(event) => setSelectedUserId(event.target.value ? Number(event.target.value) : '')}
                      aria-label="Ajouter un ami au groupe"
                      className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                    >
                      <option value="">Ajouter un ami…</option>
                      {addableFriends.map((friend) => (
                        <option key={friend.id} value={friend.id}>
                          {friend.username}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={selectedUserId === ''}
                      onClick={() => {
                        memberMutation.mutate(() => addMembers(room.id, [selectedUserId as number]))
                        setSelectedUserId('')
                      }}
                      className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <UserPlus size={12} /> Ajouter
                    </button>
                  </div>
                )}

                <ul className="divide-y divide-gray-100">
                  {memberships.map((membership) => {
                    const isSelf = membership.user.id === currentUser.id
                    const roleIcon = membership.role === 'owner' ? <Crown size={12} className="text-amber-500" /> : membership.role === 'admin' ? <Shield size={12} className="text-indigo-500" /> : null
                    return (
                      <li key={membership.id} className="flex items-center gap-3 py-2">
                        <Avatar user={membership.user} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800 truncate">
                            <span className="truncate">{membership.user.username}</span>
                            {roleIcon}
                            {isSelf && <span className="text-[10px] text-gray-400">(vous)</span>}
                            {membership.is_muted && <VolumeX size={12} className="text-orange-500" aria-label="En sourdine" />}
                            {membership.is_banned && <Ban size={12} className="text-red-500" aria-label="Banni" />}
                          </div>
                          <span className="text-[11px] text-gray-400">{ROLE_LABELS[membership.role]}</span>
                        </div>

                        {canManage && !isSelf && (
                          <div className="flex items-center gap-1">
                            {membership.role !== 'admin' && (
                              <button
                                type="button"
                                title="Promouvoir administrateur"
                                aria-label={`Promouvoir ${membership.user.username} administrateur`}
                                onClick={() => memberMutation.mutate(() => setMemberRole(room.id, membership.user.id, 'admin'))}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
                              >
                                <Shield size={14} />
                              </button>
                            )}
                            {membership.role === 'admin' && room.my_role === 'owner' && (
                              <button
                                type="button"
                                title="Rétrograder membre"
                                aria-label={`Rétrograder ${membership.user.username}`}
                                onClick={() => memberMutation.mutate(() => setMemberRole(room.id, membership.user.id, 'member'))}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
                              >
                                <ShieldOff size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              title={membership.is_muted ? 'Rétablir' : 'Mettre en sourdine'}
                              aria-label={membership.is_muted ? `Rétablir ${membership.user.username}` : `Mettre ${membership.user.username} en sourdine`}
                              onClick={() => memberMutation.mutate(() => muteMember(room.id, membership.user.id))}
                              className={`p-1.5 rounded-lg hover:bg-gray-100 ${membership.is_muted ? 'text-orange-500' : 'text-gray-500'}`}
                            >
                              {membership.is_muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                            </button>
                            <button
                              type="button"
                              title={membership.is_banned ? 'Débannir' : 'Bannir'}
                              aria-label={membership.is_banned ? `Débannir ${membership.user.username}` : `Bannir ${membership.user.username}`}
                              onClick={() => memberMutation.mutate(() => banMember(room.id, membership.user.id))}
                              className={`p-1.5 rounded-lg hover:bg-red-50 ${membership.is_banned ? 'text-red-500' : 'text-gray-500 hover:text-red-600'}`}
                            >
                              <Ban size={14} />
                            </button>
                            <button
                              type="button"
                              title="Retirer du groupe"
                              aria-label={`Retirer ${membership.user.username} du groupe`}
                              onClick={() => memberMutation.mutate(() => removeMember(room.id, membership.user.id))}
                              className="p-1.5 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"
                            >
                              <UserMinus size={14} />
                            </button>
                          </div>
                        )}
                        {room.my_role === 'owner' && !isSelf && (
                          <button
                            type="button"
                            title="Transférer la propriété"
                            aria-label={`Transférer la propriété à ${membership.user.username}`}
                            onClick={() => memberMutation.mutate(() => transferOwnership(room.id, membership.user.id))}
                            className="text-[10px] font-medium text-amber-600 hover:underline"
                          >
                            Transférer
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {activityQuery.isLoading && <li className="py-3 text-gray-400 text-xs">Chargement…</li>}
                {activityQuery.data?.length === 0 && <li className="py-3 text-gray-400 text-xs">Aucune activité récente.</li>}
                {activityQuery.data?.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-2">
                    <Avatar user={entry.user} size="sm" />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-gray-800 text-xs">{entry.user?.username ?? 'Système'}</span>{' '}
                      <span className="text-gray-500 text-xs">{entry.action_display}</span>
                      {entry.details && 'username' in entry.details && (
                        <span className="text-gray-500 text-xs"> : {String(entry.details.username)}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {new Date(entry.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Zone dangereuse" className="border-t border-gray-100 pt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                memberMutation.mutate(async () => {
                  await leaveRoom(room.id)
                  onRoomDeleted()
                })
              }
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              <LogOut size={14} /> Quitter le groupe
            </button>
            <button
              type="button"
              onClick={() => memberMutation.mutate(() => archiveRoom(room.id).then(() => onRoomDeleted()))}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              <Archive size={14} /> Archiver
            </button>
            {room.my_role === 'owner' && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Supprimer définitivement ce groupe et tous ses messages ?')) deleteMutation.mutate()
                }}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-100"
              >
                <Trash2 size={14} /> Supprimer le groupe
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
