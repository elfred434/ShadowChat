# ShadowChat Frontend

Frontend **TanStack Start** (React 19, Tailwind CSS v4, Vite) de ShadowChat.

## Architecture

- **TanStack Start + Router** : routage fichier dans `src/routes/` (SPA,
  shell HTML généré par `__root.tsx`), route tree généré (`routeTree.gen.ts`).
- **TanStack Query** : état serveur (salons, messages paginés, notifications…).
- **TanStack Table** : annuaire d'amis interactif.
- **Temps réel** : client WebSocket (`src/api/ws.ts`) avec reconnexion
  automatique ; React Query sert de repli (polling) quand le socket est coupé.
- **Thème** : mode clair/sombre (`dark` class sur `<html>`), persisté.

## Commandes

```bash
npm ci
npm run dev          # serveur de développement (port 5173)
npm run build        # build de production (dist/client)
npm run lint         # ESLint + règles React
npm run generate-routes
```

En développement, Vite transmet `/api`, `/media`, `/health` et `/ws`
(WebSockets) vers le backend Django (Daphne) sur le port 8000.
