# Déployer avec Docker (Coolify)

Le dépôt contient un `Dockerfile` (build multi-étapes, sortie Next.js `standalone`, utilisateur non-root,
healthcheck) et un `docker-compose.yml`. La base reste sur Supabase : seul le conteneur de l'app est déployé.

## Coolify, méthode recommandée (Dockerfile)

1. **New Resource > Application**, dépôt Git, **Build Pack : Dockerfile**, port exposé **3000**.
2. Onglet **Environment Variables** : colle les variables de `.env.example`.
   - Coche **Build Variable** pour `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_EDITION` et `NEXT_PUBLIC_SHORT_DOMAIN` : elles sont incrustées dans
     le code au build. Les modifier demande un **redeploy**, pas un simple restart.
   - Les autres (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, clés Meta, Google, Resend, Anthropic…) sont lues au
     démarrage.
3. **Domains** : `https://os.mon-agence.fr` (identique à `NEXT_PUBLIC_APP_URL`). Coolify gère le certificat.
4. **Deploy**. Le healthcheck du `Dockerfile` marque l'app saine quand `/` répond.

## Coolify, variante Docker Compose

Build Pack **Docker Compose**, fichier `docker-compose.yml`. Les variables se renseignent dans l'interface,
sans fichier `.env`. Supprime la section `ports` si tu laisses Traefik (Coolify) exposer le service, et
renseigne le domaine sur le service `app` (port 3000).

## Tâches planifiées

Elles tournent dans Supabase (pg_cron), pas dans le conteneur : depuis **Réglages > Installation**, programme-les
avec l'URL publique de l'app et `CRON_SECRET`. Rien de plus à faire côté Docker.

## Test local

```bash
cp .env.example .env   # renseigne au moins les trois variables Supabase et NEXT_PUBLIC_APP_URL
docker compose up --build
```

## Pourquoi `DOCKER_BUILD=1`

`next.config.ts` n'active `output: "standalone"` que si cette variable est présente (posée par le `Dockerfile`).
Le déploiement Vercel ou `npm run build && npm start` n'est pas modifié.

## Avec Supabase auto-hébergé sur Coolify

L'app ne dépend que de l'URL et des clés Supabase : elle fonctionne identiquement avec Supabase Cloud ou
auto-hébergé.

1. **Supabase** : dans Coolify, ajoute la ressource **Supabase** (New Resource > Services). Donne-lui un domaine
   public (ex. `api.mon-agence.fr`, port Kong 8000). Compte 2 à 3 Go de RAM pour la pile complète.
   Le Realtime ne sert qu'au rafraîchissement en direct de l'inbox : il peut rester désactivé.
2. **Clés** : récupère dans les variables du service `SERVICE_SUPABASEANON_KEY` et `SERVICE_SUPABASESERVICE_KEY`
   (les noms exacts peuvent varier selon la version du modèle).
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://api.mon-agence.fr` (domaine public, pas l'adresse interne)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = clé anon
   - `SUPABASE_SERVICE_ROLE_KEY` = clé service role
3. **Base** : applique le schéma une seule fois sur le conteneur Postgres du service :
   ```bash
   DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i 'supabase-db') ./scripts/db-apply-local.sh
   ```
   Après une mise à jour du code, applique les nouvelles migrations de `supabase/migrations/` de la même façon
   (`./scripts/db-apply-local.sh supabase/migrations/0122_xxx.sql`).
4. **Authentification** : dans les variables du service Supabase, `SITE_URL` (GOTRUE_SITE_URL) = l'URL de l'app, et
   ajoute-la à la liste des redirections autorisées (sinon les liens de confirmation pointent vers `localhost`).
   Si la confirmation par email est active et qu'aucun SMTP n'est configuré, **personne ne peut finir son
   inscription**, et le mot de passe oublié ne part pas. Deux solutions :
   - pour tester : `ENABLE_EMAIL_AUTOCONFIRM=true` (les comptes sont valides sans email) ;
   - en usage réel : un SMTP (Resend, Brevo…) via les variables `SMTP_*` du service.

   Les collègues n'ont rien d'autre à configurer : **Nouveau > Inviter un membre** génère un lien, la personne crée
   son compte avec cette adresse et rejoint l'espace. Le portail client (`/c/<slug>`) utilise les mêmes comptes.
5. **Tâches planifiées** : `pg_cron` et `pg_net` appellent l'app depuis le conteneur Postgres. Dans
   Réglages > Installation, programme-les : l'URL publique de l'app doit être joignable depuis ce conteneur.

Les scripts `db-apply.mjs` et `gen-types.sh` utilisent l'API Management de Supabase Cloud et ne servent pas
en auto-hébergé.

## Inscription fermée après le premier compte

Comme la plupart des apps auto-hébergées, le premier compte est libre ; ensuite le lien « Créer un compte » disparaît
et `/signup` renvoie vers `/login`. Les invitations d'équipe et du portail client continuent de fonctionner.

Pour que Supabase refuse aussi les inscriptions faites directement auprès de son API (la clé `anon` est publique),
applique une fois `supabase/optional/inscriptions-sur-invitation.sql` dans le SQL Editor. Pour rouvrir l'inscription :
`drop trigger invite_only_signup on auth.users;`.
