# Changelog

Modifications de ce fork par rapport à [impulsion-com/agence-os](https://github.com/impulsion-com/agence-os)
(base : `e6eeb8c`).

## 0.1.1 (2026-10-30)

### Ajouté
- Déploiement Docker : `Dockerfile` en trois étapes (sortie Next.js `standalone`, utilisateur non-root,
  healthcheck), `docker-compose.yml` et `.dockerignore`.
- `docs/docker-coolify.md` : déploiement sur Coolify (Dockerfile ou Compose), Supabase Cloud ou auto-hébergé,
  authentification, tâches planifiées.
- `scripts/db-apply-local.sh` : applique le schéma sur un Supabase auto-hébergé.
- Inscription publique fermée dès qu'un compte existe : le lien « Créer un compte » disparaît et `/signup`
  renvoie vers `/login`. Les invitations d'équipe et du portail client restent possibles.
- `supabase/optional/inscriptions-sur-invitation.sql` : garde-fou côté base qui refuse les inscriptions non
  invitées, y compris celles faites directement auprès de l'API Supabase.

### Modifié
- `next.config.ts` : `output: "standalone"` uniquement si `DOCKER_BUILD=1` (Vercel et `npm start` inchangés).
