#!/bin/sh
# Point d'entrée du conteneur backend : migrations, fichiers statiques, puis la commande.
set -e

python backend/manage.py migrate --noinput
python backend/manage.py collectstatic --noinput

exec "$@"
