# ShadowChat

Application de messagerie privée en temps réel : backend Django REST + Channels
(WebSockets), frontend **TanStack Start** (React, Tailwind CSS, Vite).

## Fonctionnalités

- **Temps réel** : messages, frappe, présence, accusés de lecture, notifications
  et compteurs de non-lus diffusés par WebSocket (Django Channels + Redis),
  avec repli automatique sur du polling HTTP si le socket est indisponible.
- **Messagerie complète** : édition et suppression de ses messages, réponses
  (fils), réactions emoji, pièces jointes sécurisées (images, PDF, documents),
  messages épinglés, recherche par salon/auteur/période, pagination par curseur.
- **Groupes** : propriétaire, administrateurs et membres, modification du nom /
  description / avatar, ajout et retrait de membres, lien d'invitation temporaire,
  bannissement, mise en sourdine, quitter / archiver / supprimer, journal
  d'activité.
- **Notifications** persistantes : demandes d'amis, mentions, réponses,
  invitations à un groupe.
- **Compte & sécurité** : vérification d'adresse e-mail, réinitialisation de
  mot de passe par e-mail, changement de mot de passe, authentification à deux
  facteurs (TOTP), gestion des sessions actives (révocation à distance),
  blocage d'utilisateurs, signalements avec tableau de modération (admin Django).
- **Confidentialité** : CSRF et sessions durcies, limitation de débit (connexion,
  inscription, messages, recherche, invitations, réinitialisation, 2FA,
  signalements).
- **Exploitation** : PostgreSQL + Redis, Docker Compose (avec service de
  sauvegardes), CI GitHub Actions, endpoint `/health/`, Sentry, logs structurés
  JSON, stockage objet S3/R2/MinIO optionnel.

## Architecture frontend (TanStack Start)

- Routage fichier (`src/routes/`), shell HTML généré par `__root.tsx`,
  `routeTree.gen.ts`, SPA statique (sortie `dist/client`).
- TanStack Query (état serveur) + TanStack Table (annuaire d'amis).
- Client WebSocket (`src/api/ws.ts`) avec reconnexion automatique.
- Mode sombre (classe `dark` sur `<html>`, préférence persistée).

## Prérequis

- Python 3.11 ou supérieur
- Node.js 20 ou supérieur
- PostgreSQL et Redis en production (facultatifs en développement)

## Démarrage local (développement)

```bash
python -m venv .venv
. .venv/bin/activate          # Windows : .venv\Scripts\activate
pip install -r requirements-dev.txt
python backend/manage.py migrate
python backend/manage.py runserver 0.0.0.0:8000   # ou : daphne backend.asgi:application
```

Dans un second terminal :

```bash
cd frontend
npm ci
npm run dev
```

Vite transmet automatiquement `/api`, `/media`, `/ws` et `/health` vers Django
en développement. Il ne faut donc pas utiliser `localhost` dans le code client.
Pour une API séparée, définir `VITE_API_URL` (avec le suffixe `/api/`) et
`VITE_WS_URL`.

En développement, SQLite, le cache mémoire et la couche de canaux en mémoire
sont utilisés par défaut. Pour brancher PostgreSQL et Redis localement :

```bash
export DATABASE_URL=postgres://shadowchat:shadowchat@localhost:5432/shadowchat
export REDIS_URL=redis://localhost:6379/0
```

## Démarrage avec Docker Compose (production-like)

```bash
cp .env.example .env   # puis renseigner les secrets
docker compose up --build
```

La stack démarre PostgreSQL 16, Redis 7, le backend Django (Daphne, ASGI +
WebSockets) et le frontend TanStack Start compilé servi par Nginx (proxy
`/api`, `/ws`, `/admin`, `/health`, fichiers statiques et médias). Le frontend
est accessible sur le port `FRONTEND_PORT` (8080 par défaut).

Sauvegardes périodiques (optionnel) :

```bash
docker compose --profile backup up -d backup   # pg_dump + médias, rétention 14 j
```

## Variables d'environnement

Voir `.env.example` pour la liste complète. Les principales :

| Variable | Usage |
| --- | --- |
| `DJANGO_SECRET_KEY` | Clé secrète, obligatoire en production. |
| `DJANGO_DEBUG` | `false` en production. |
| `DJANGO_ALLOWED_HOSTS` | Liste CSV des hôtes autorisés. |
| `DATABASE_URL` | URL PostgreSQL (`postgres://user:pass@host/db`). |
| `REDIS_URL` | URL Redis (cache + canaux WebSocket). |
| `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` | Origines frontend autorisées. |
| `DJANGO_TRUST_PROXY` | `true` derrière un reverse proxy TLS (Nginx/Traefik). |
| `STORAGE_BACKEND` + `AWS_*` | Stockage objet : `filesystem`, `s3`, `r2` ou `minio`. |
| `SENTRY_DSN` | Active Sentry (exceptions + traces). |
| `DJANGO_LOG_JSON` | Logs structurés JSON (défaut `true` hors debug). |
| `EMAIL_*` | Configuration SMTP (e-mails transactionnels). |
| `PUBLIC_SITE_URL` | Origine publique (liens d'invitation, e-mails). |
| `VITE_API_URL` / `VITE_WS_URL` | URL publiques de l'API et du WebSocket. |

Les secrets ne doivent jamais être committés. Utiliser un gestionnaire de
secrets ou un fichier `.env` non versionné.

## Protocole WebSocket

| Socket | Rôle |
| --- | --- |
| `/ws/rooms/<id>/` | Événements du salon : `message.created`, `message.edited`, `message.deleted`, `message.reactions_changed`, `message.pinned`, `room.updated`, `room.deleted`, `typing.changed`, `receipts.updated`, `activity.created`. Émission client : `typing.start`, `typing.stop`, `mark.read`, `messages.read`, `ping`. |
| `/ws/user/` | Événements personnels : `notification.created`, `presence.changed`, `room.unread_changed`, `room.read`, `room.removed`, `room.joined`, `friendship.*`, `user.blocked`, `user.unblocked`. |

Les sockets utilisent la session Django (cookie) pour l'authentification et
vérifient l'origine du handshake (protection anti-détournement).

## Vérification

```bash
# Backend : lint, format, migrations, tests
ruff check backend && ruff format --check backend
.venv/bin/python backend/manage.py makemigrations --check --dry-run
.venv/bin/python backend/manage.py test chat

# Frontend
cd frontend && npm run typecheck && npm run lint && npm run build
```

La CI GitHub Actions exécute automatiquement ces vérifications (tests sur
PostgreSQL + Redis, audit des dépendances) à chaque push et pull request.

## Sécurité

L'API utilise des sessions Django et la protection CSRF native. Toute requête
qui lit ou écrit un salon est limitée à ses participants (membres non bannis) ;
les DM ne peuvent être démarrés qu'entre amis acceptés ; les rôles de groupe
(propriétaire > administrateur > membre) encadrent la gestion ; le blocage
supprime les amitiés ; la limitation de débit protège connexion, inscription,
messages, recherches, réinitialisation de mot de passe, 2FA et signalements ;
les pièces jointes sont validées (type MIME, extension, taille, intégrité des
images) ; la 2FA TOTP renforce la connexion et la rotation du hash de session
invalide les autres sessions lors d'un changement de mot de passe.
