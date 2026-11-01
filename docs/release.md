# Versions et image Docker

À chaque fusion dans `main`, le workflow `.github/workflows/release.yml` décide s'il faut publier une version.

## Ce que décide le message de commit

| Début du message | Effet |
| --- | --- |
| `feat:` ou `feat(zone):` | version mineure (0.2.0 → 0.3.0) |
| `fix:` ou `fix(zone):` | version corrective (0.2.0 → 0.2.1) |
| `feat!:`, `fix!:` ou `BREAKING CHANGE:` dans le corps | version majeure |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:` ou aucun préfixe | aucune version |

Avec « Squash and merge », c'est le **titre de la pull request** qui compte : écris-le avec le préfixe
(`feat(réservation): formulaire coordonnées d'abord`).

## Ce que fait la CI quand une version est due

1. Calcule le numéro suivant à partir du dernier tag.
2. Commite `CHANGELOG.md`, `package.json` et `package-lock.json` (`chore(release): X.Y.Z [skip ci]`).
3. Pose le tag `vX.Y.Z` et crée la fiche de version sur GitHub.
4. Construit l'image avec les variables `NEXT_PUBLIC_*` du dépôt et la publie : `poltergeistz/agence-os:X.Y.Z`
   et `latest`.

## Réglages GitHub nécessaires

- Environnement `DOCKERHUB_TOKEN` : secret `DOCKERHUB_TOKEN` (jeton Docker Hub, droit lecture et écriture).
- Variables : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`
  (obligatoires), `DOCKERHUB_USERNAME`, `NEXT_PUBLIC_EDITION`, `NEXT_PUBLIC_SHORT_DOMAIN` (facultatives).
- Un tag de départ doit exister (`v0.1.1`), sinon la première version serait `1.0.0`.

## Mise en production

Les migrations SQL passent **avant** le déploiement de l'image. Ensuite, dans Coolify, remplace le tag de l'image
par la nouvelle version (pas de déploiement manuel en plus d'un push, ça double la construction).
