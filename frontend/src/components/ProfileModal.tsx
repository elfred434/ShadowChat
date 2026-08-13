import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateProfile, type User } from "../api/auth";
import { apiErrorMessage } from "../api/client";
import { X, Upload, MessageSquare, BookOpen } from 'lucide-react';
import { Avatar } from "./Avatar";

interface ProfileModalProps {
    user: User;
    onClose: () => void;
}

export function ProfilModal({ user, onClose }: ProfileModalProps) {
    const queryClient = useQueryClient();
    const [bio, setBio] = useState(user.bio || '');
    const [statusText, setStatusText] = useState(user.status_text || '');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatar || null);
    const [errorMsg, setErrorMag] = useState('');

    const updateProfileMutation = useMutation({
        mutationFn: () => updateProfile({
            bio,
            status_text: statusText,
            avatar: avatarFile,
        }),
        onSuccess: (updatedUser) => {
            queryClient.setQueryData(['currentUser'], updatedUser);
            queryClient.invalidateQueries({ queryKey: ['currentUser'] });
            queryClient.invalidateQueries({ queryKey: ['rooms'] });
            queryClient.invalidateQueries({ queryKey: ['friendships'] });
            onClose();
        },
        onError: (err: unknown) => {
            setErrorMag(apiErrorMessage(err, 'Erreur lors du chargement du profil.'));
        },
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setAvatarFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setAvatarPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        updateProfileMutation.mutate();
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 animate-scale-in">
                <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-bold text-lg text-gray-800">Personnaliser votre Profil</h3>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {errorMsg && (
                        <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100">
                            {errorMsg}
                        </div>
                    )}

                    {/* ZONE PHOTO DE PROFIL / AVATAR */}
                    <div className="flex flex-col items-center space-y-3">
                        <div className="relative group cursor-pointer">
                            {avatarPreview ? (
                                <img
                                    src={avatarPreview}
                                    alt="Aperçu"
                                    className="w-20 h-100 w-20 h-20 rounded-full object-cover border-2 border-indigo-500 shadow-md group-hover:opacity-75 transition"
                                />
                            ) : (
                                <Avatar user={user} size="lg" />
                            )}
                            {/* Overlay de survol pour téléverser */}
                            <label className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40 rounded-full opacity-0 group-hover:opacity-100 transition text-white text-xs cursor-pointer">
                                <Upload size={18} />
                                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                            </label>
                        </div>
                        <span className="text-[10px] text-gray-400">Cliquez pour modifier votre photo de profil</span>
                    </div>

                    {/* TEXTE DE STATUT */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center space-x-1">
                            <MessageSquare size={14} className="text-gray-400" />
                            <span>Statut personnalisé</span>
                        </label>
                        <input
                            type="text"
                            placeholder="Ex: En réunion ☕, À la salle 🏋️‍♂️..."
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm bg-gray-50"
                            value={statusText}
                            onChange={(e) => setStatusText(e.target.value)}
                            maxLength={100}
                        />
                    </div>

                    {/* BIOGRAPHIE */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center space-x-1">
                            <BookOpen size={14} className="text-gray-400" />
                            <span>Ma Biographie</span>
                        </label>
                        <textarea
                            placeholder="Parlez-nous un peu de vous..."
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm bg-gray-50 h-24 resize-none"
                            value={bio}
                            onChange={(e) => setBio(e.target.value)}
                            maxLength={500}
                        />
                    </div>

                    {/* ACTIONS */}
                    <div className="flex space-x-3 pt-2 justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border rounded-lg text-gray-700 text-sm font-semibold hover:bg-gray-100"
                        >
                            Annuler
                        </button>
                        <button
                            type="submit"
                            disabled={updateProfileMutation.isPending}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg disabled:bg-indigo-400"
                        >
                            {updateProfileMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}