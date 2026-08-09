import type { User } from "../api/auth";

interface AvatarProps{
    user: User | null;
    size?: 'xs' | 'sm' | 'md' | 'lg';
}

export function Avatar({user, size = 'md' }: AvatarProps){
    if(!user) return null
    const sizeClasses = {
        xs: 'w-6 h-6 text-[10px]',
        sm: 'w-8 h-8 text-xs',
        md: 'w-10 h-10 text-sm',
        lg: 'w-16 h-16 text-lg font-bold',
    }

    const getInitials = (username: string) =>{
        const parts = username.trim().split(' ');
        if(parts.length > 1){
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return username.substring(0, 2).toUpperCase();
    };
    const getAvatarBgColor = (username: string) => {
        const colors = [
      'bg-indigo-500 text-indigo-50',
      'bg-emerald-500 text-emerald-50',
      'bg-rose-500 text-rose-50',
      'bg-amber-500 text-amber-50',
      'bg-cyan-500 text-cyan-50',
      'bg-purple-500 text-purple-50',
      'bg-sky-500 text-sky-50',
    ];
    let sum = 0;
    for (let i = 0; i < username.length; i++) {
        sum += username.charCodeAt(i);
    }
    return colors[sum % colors.length];
    }

    return (
    <div className="relative inline-block">
      {user.avatar ? (
        // Si l'utilisateur possède une image de profil
        <img
          src={user.avatar}
          alt={user.username}
          className={`${sizeClasses[size]} rounded-full object-cover border border-gray-200/50 shadow-sm`}
        />
      ) : (
        // Sinon, génération d'un avatar textuel avec initiales stylisé
        <div
          className={`${sizeClasses[size]} ${getAvatarBgColor(user.username)} rounded-full flex items-center justify-center font-semibold uppercase shadow-sm select-none border border-transparent`}
        >
          {getInitials(user.username)}
        </div>
      )}

      {/* Point de statut en ligne/hors-ligne directement intégré sur le coin droit ! */}
      {user.is_online && (
        <span className={`absolute bottom-0 right-0 rounded-full bg-emerald-500 border-2 border-white ${
          size === 'xs' ? 'w-2 h-2' : size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'
        }`} />
      )}
    </div>
  );
}