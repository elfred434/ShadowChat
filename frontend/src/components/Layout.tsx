import { Outlet, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser, logoutUser } from '../api/auth';
import { LogOut, Settings } from 'lucide-react';
import { Avatar } from './Avatar';
import { ProfilModal } from './ProfileModal';
import { NotificationsPanel } from './NotificationsPanel';
import { useState } from 'react';
export function Layout() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [showProfileModal, setShowProfileModal] = useState(false)

    const { data: user, isLoading } = useQuery({
        queryKey: ['currentUser'],
        queryFn: getCurrentUser,
        retry: false,
        staleTime: 1000 * 60 * 10
    })
    const logoutMutation = useMutation({
        mutationFn: logoutUser,
        onSuccess: () => {
            queryClient.setQueryData(['currentUser'], null);
            queryClient.invalidateQueries({ queryKey: ['currentUser'] });

            navigate({ to: '/login' });
        },
    });
    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-100 text-gray-900">
            <header className="flex items-center justify-between px-6 py-4 bg-indigo-600 text-white shadow-md">
                <h1 className="text-xl font-bold tracking-wide">
                    ShadowChat
                </h1>
                {isLoading ? (
                    <span className='text-sm opacity-75'>Chargement...</span>
                ) : user ? (
                    <div className='flex items-center space-x-4'>
                        <NotificationsPanel />
                        <button
                            onClick={() => setShowProfileModal(true)}
                            className="flex items-center space-x-2 bg-indigo-700 hover:bg-indigo-800 px-3 py-1.5 rounded-full border border-indigo-500 transition shadow-sm text-white"
                            title="Modifier mon profil"
                        >
                            {/* Utilisation de notre Avatar intelligent */}
                            <Avatar user={user} size="sm" />
                            <span className="font-semibold text-sm pr-1">{user.username}</span>
                            <Settings size={14} className="opacity-75" />
                        </button>
                        <button onClick={() => logoutMutation.mutate()}
                            disabled={logoutMutation.isPending}
                            className='flex items-center space-x-1 hover:text-red-300 text-sm font-medium
                            transition duration-150 bg-indigo-800 hover:bg-indigo-900 px-3 py-1.5 rounded-lg'
                            title='Se déconnecter'>
                            <LogOut size={16} />
                            <span>Déconnexion</span>
                        </button>
                    </div>
                ) : (
                    <Link to='/login'
                        className='bg-white text-indigo-600 hover:bg-indigo-50 px-4 py-2 rounded-lg font-semibold text-sm shadow-sm transition duration-150'>
                        Connexion
                    </Link>
                )}
                {/* <nav className='flex space-x-4'>
                    <Link to='/' className='hover:underline [&.active]:font-bold'>
                    Messagerie
                    </Link>
                    <Link to='/login' className='hover:underline [&.active]:font-bold'>
                    Connexion
                    </Link>
                </nav> */}
            </header>
            <main className='flex-1 overflow-hidden'>
                <Outlet />
            </main>

            {/* MODALE DE PERSONNALISATION DE PROFIL*/} 
            {showProfileModal && user && (
                <ProfilModal user={user} onClose={() => setShowProfileModal(false)}/>
            )}
        </div>
    )
}