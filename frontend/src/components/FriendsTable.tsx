import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import type { SortingState } from "@tanstack/react-table";
import { MessageSquare, ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import type { User } from '../api/auth';
import type { Friendship } from '../api/friendships';

// On définit le type de données que chaque ligne de notre tableau va représenter
interface FriendRowData {
  friendshipId: number;
  friend: User;
  joinedAt: string;
}

interface FriendsTableProps {
  friendships: Friendship[];
  currentUser: User | null;
  onStartChat: (userId: number) => void;
}

// 1. Initialisation du helper de colonne de TanStack Table
const columnHelper = createColumnHelper<FriendRowData>();

export function FriendsTable({ friendships, currentUser, onStartChat }: FriendsTableProps) {
  // États de TanStack Table pour le tri et le filtrage
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  // 2. Transformation de nos amitiés brutes au format plat pour le tableau
  const data: FriendRowData[] = friendships.map((f) => {
    const friend = f.sender.id === currentUser?.id ? f.receiver : f.sender;
    return {
      friendshipId: f.id,
      friend: friend,
      joinedAt: f.updated_at,
    };
  });

  // 3. Définition des colonnes du tableau
  const columns = [
    // Colonne 1 : Pseudo de l'ami (Triable avec pastille de statut en ligne/hors-ligne)
    columnHelper.accessor('friend.username', {
      header: ({ column }) => {
        return (
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center space-x-1 hover:text-indigo-600 transition font-bold"
          >
            <span>Pseudo</span>
            {column.getIsSorted() === 'asc' ? (
              <ArrowUp size={14} />
            ) : column.getIsSorted() === 'desc' ? (
              <ArrowDown size={14} />
            ) : (
              <ArrowUpDown size={14} className="opacity-50" />
            )}
          </button>
        );
      },
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="flex items-center space-x-2">
            {/* Pastille de statut en ligne / hors-ligne */}
            <span 
              className={`w-2.5 h-2.5 rounded-full ${
                row.friend.is_online ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'
              }`} 
              title={row.friend.is_online ? 'En ligne' : 'Hors-ligne'}
            />
            <span className="font-semibold text-gray-800">{info.getValue()}</span>
          </div>
        );
      },
    }),

    // Colonne 2 : Adresse e-mail
    columnHelper.accessor('friend.email', {
      header: 'Adresse E-mail',
      cell: (info) => {
        const email = info.getValue();
        return email ? (
          <span className="text-gray-600">{email}</span>
        ) : (
          <span className="text-gray-400 italic text-xs">Non renseignée</span>
        );
      },
    }),

    // Colonne 3 : Date de début d'amitié (Triable)
    columnHelper.accessor('joinedAt', {
      header: ({ column }) => {
        return (
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center space-x-1 hover:text-indigo-600 transition font-bold"
          >
            <span>Ami depuis le</span>
            {column.getIsSorted() === 'asc' ? (
              <ArrowUp size={14} />
            ) : column.getIsSorted() === 'desc' ? (
              <ArrowDown size={14} />
            ) : (
              <ArrowUpDown size={14} className="opacity-50" />
            )}
          </button>
        );
      },
      cell: (info) => {
        const date = new Date(info.getValue());
        return <span className="text-gray-600">{date.toLocaleDateString()}</span>;
      },
    }),

    // Colonne 4 : Actions (Bouton d'envoi de message direct)
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: (info) => {
        const row = info.row.original;
        return (
          <button
            onClick={() => onStartChat(row.friend.id)}
            className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-sm"
            title={`Écrire à ${row.friend.username}`}
          >
            <MessageSquare size={14} />
            <span>Discuter</span>
          </button>
        );
      },
    }),
  ];

  // 4. Initialisation de l'instance de table de TanStack
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(), // Active le moteur de tri
    getFilteredRowModel: getFilteredRowModel(), // Active le moteur de filtrage global
  });

  return (
    <div className="space-y-4">
      {/* Input de recherche globale pour filtrer le tableau */}
      <div className="relative max-w-sm">
        <input
          type="text"
          placeholder="Rechercher un ami dans la liste..."
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-sm shadow-sm"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
        />
        <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
      </div>

      {/* Rendu HTML du Tableau stylisé avec Tailwind */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="bg-gray-50 border-b border-gray-200 text-gray-700">
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-6 py-4 font-bold select-none">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-8 text-gray-400 italic">
                  Aucun ami correspondant.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-indigo-50/30 transition">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-6 py-4 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}