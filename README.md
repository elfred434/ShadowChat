# ShadowChat

Application de messagerie privée : backend Django REST et frontend React/Vite.

## Prérequis

- Python 3.11 ou supérieur
- Node.js 20 ou supérieur

## Démarrage local

```bash
python -m venv .venv
. .venv/bin/activate          # Windows : .venv\Scripts\activate
pip install -r requirements.txt
python backend/manage.py migrate
python backend/manage.py runserver 0.0.0.0:8000
```

Dans un second terminal :

```bash
cd frontend
npm ci
npm run dev
```

Vite transmet automatiquement `/api` et `/media` vers Django en développement. Il ne faut donc pas utiliser `localhost` dans le code client. Pour une API séparée, définir `VITE_API_URL` (avec le suffixe `/api/`).

## Variables d'environnement

| Variable | Usage |
| --- | --- |
| `DJANGO_SECRET_KEY` | Clé secrète, obligatoire en production. |
| `DJANGO_DEBUG` | `false` en production. |
| `DJANGO_ALLOWED_HOSTS` | Liste CSV des hôtes autorisés. |
| `CORS_ALLOWED_ORIGINS` | Liste CSV des origines frontend autorisées. |
| `CSRF_TRUSTED_ORIGINS` | Liste CSV des origines approuvées par CSRF. |
| `VITE_API_URL` | URL publique de l'API, si elle n'est pas servie via le même domaine. |

Les secrets ne doivent jamais être committés. Utiliser un gestionnaire de secrets ou un fichier `.env` non versionné.

## Vérification

```bash
.venv/bin/python backend/manage.py check
.venv/bin/python backend/manage.py test chat
cd frontend && npm run build && npm run lint
```

## Sécurité

L'API utilise des sessions Django et la protection CSRF native. Toute requête qui lit ou écrit un salon est limitée à ses participants ; les nouveaux salons et DM ne peuvent être démarrés qu'avec des amis acceptés.
