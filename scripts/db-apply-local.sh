#!/usr/bin/env bash
# Applique un fichier SQL sur un Supabase auto-hébergé (par défaut supabase/setup.sql).
# Usage : DB_CONTAINER=<conteneur postgres> ./scripts/db-apply-local.sh [fichier.sql]
#     ou  DATABASE_URL=postgres://postgres:<mdp>@<hote>:5432/postgres ./scripts/db-apply-local.sh [fichier.sql]
set -euo pipefail
FILE="${1:-supabase/setup.sql}"
[ -f "$FILE" ] || { echo "Fichier introuvable : $FILE" >&2; exit 1; }

if [ -n "${DB_CONTAINER:-}" ]; then
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$FILE"
elif [ -n "${DATABASE_URL:-}" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$FILE"
else
  echo "Renseigne DB_CONTAINER ou DATABASE_URL" >&2
  exit 1
fi
