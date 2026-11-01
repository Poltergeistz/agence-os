# Spec : réservation « coordonnées d'abord » (formulaire puis calendrier)

Statut : à valider avant implémentation. Aucune ligne de code n'est écrite.
Cible : fork `Poltergeistz/agence-os`, branche `feature/booking-contact-first`, créée depuis `main` (pas depuis la branche Docker).

## 1. Objectif

Sur la page publique d'un type de rendez-vous (ex. `/b/david-journo/appel-decouverte`), le visiteur remplit ses
coordonnées **avant** de voir le calendrier. Dès la validation du formulaire, la personne est enregistrée au CRM,
même si elle ne réserve jamais. Elle choisit ensuite un créneau, et un clic confirme le rendez-vous.

Gain mesurable : les visiteurs qui abandonnent entre le formulaire et le calendrier deviennent des leads à relancer
au lieu d'être perdus.

### Hors périmètre (v1)

- Verrouiller l'API des créneaux (`/api/booking/slots`) : le calendrier reste public côté serveur, seul l'affichage
  est conditionné. Rien de sensible dans les créneaux libres, et un jeton signé de plus serait de la complexité
  spéculative. À reconsidérer si du scraping apparaît.
- Tâche de relance automatique, purge RGPD des leads sans rendez-vous, envoi d'emails à un lead sans rendez-vous.
- Report d'un rendez-vous : le flux `/b/r/[token]` ne change pas.
- Événements de tracking pour le lead (seul le rendez-vous en émet déjà).

## 2. État actuel (relevé dans le code)

| Élément | Où | Comportement |
| --- | --- | --- |
| Étapes du composant | `src/components/booking/public-booker.tsx` | `pick` (calendrier + créneaux) → `form` → `done` |
| Questions | `booking_types.questions` (jsonb), `readQuestions()` dans `shared.ts` | liste configurable par type |
| Validation serveur | `book()` dans `src/lib/booking/server.ts` | questions obligatoires, valeurs `select`, téléphone si lieu « phone » : **logique noyée dans `book()`** |
| Réservation | `POST /api/booking/book`, `BookSchema` | reçoit nom, email, réponses, créneau ; limite 12 requêtes/min/IP ; pot de miel `website_url` |
| CRM | `syncCrm()` | contact par email, entreprise, **réutilise un deal ouvert du contact**, sinon en crée un à l'étape « découverte » ; activité `meeting` |
| Tests | `src/lib/booking/tests/slots.test.mjs` | `node:test` sur des modules purs, sans base ni serveur |
| Schéma | migration `0073_booking.sql`, version courante 121 | `SCHEMA_VERSION` dans `src/lib/setup/checks.ts` |

Constat clé : `syncCrm` réutilise déjà un deal ouvert du contact. Un lead capturé avant la réservation sera donc
retrouvé automatiquement au moment de réserver, sans nouvelle table.

## 3. Comportement cible

### 3.1 Machine d'états du composant

```
              contactFirst=true                         contactFirst=false (comportement actuel)
   ┌──────────┐  valider   ┌──────────┐ choisir ┌──────┐        pick ──choisir──▶ form ──▶ done
   │  info    │──────────▶ │   pick   │───────▶ │ done │
   └──────────┘            └──────────┘  (1 clic)└──────┘
        ▲                       │ 409 créneau pris : reste sur pick, recharge
        └──── « Modifier mes informations »
```

Rendu (d'après une capture de référence) : l'étape `info` n'est **pas** un écran séparé. La
page garde ses deux colonnes. À gauche, le formulaire (titre, « Étape 1/2 », texte « À lire attentivement »,
champs, mention RGPD, bouton « Continuer »). À droite, le calendrier est **visible mais flouté et inerte**, avec une
bulle « Merci de remplir le formulaire avant de choisir votre créneau horaire ». « Continuer » enregistre le lead,
retire le flou du calendrier et passe l'indicateur à « Étape 2/2 ». Conséquence : `info` et `pick` partagent la même mise
en page, seul l'état « verrouillé » du calendrier change (voir 3.6).

Règles :
- `contactFirst` actif, pas de report : démarrage à `info`.
- `contactFirst` actif, report (`reschedule` présent) : démarrage à `pick` avec nom et email préremplis, car la
  personne est déjà connue.
- `contactFirst` inactif : flux actuel inchangé (non-régression).
- Sur `pick` après `info`, choisir un créneau appelle directement la réservation (plus d'étape `form`).
- Retour de `pick` vers `info` possible, les valeurs saisies sont conservées.
- Choisir un créneau affiche d'abord « Confirmer {heure} » (3.8), la réservation part au second tap.
- Une erreur 409 sur la réservation renvoie à `pick` et recharge les créneaux (comme aujourd'hui).
- Les valeurs du formulaire restent en mémoire du composant : pas de session serveur ni de cookie.

### 3.2 Capture du lead (`POST /api/booking/lead`)

Appelé à la validation de `info`. Réponse : `{ ok: true }` **dans tous les cas valides**, pour ne pas révéler si un
email existe déjà (pas d'énumération).

Effets, tous idempotents :
1. Valider comme `book()` : mêmes règles de nom, email, questions obligatoires, valeurs `select`, téléphone.
2. Créer ou retrouver entreprise et contact (même logique que `syncCrm`).
3. Si le contact n'a pas de deal ouvert : créer un deal à la **première étape ouverte** du pipeline (« Nouveau lead »,
   pas « Appel découverte »), `source = "Formulaire de réservation"` (ou source UTM si présente).
4. Ajouter une activité `note` : « Formulaire rempli, pas encore de rendez-vous » + réponses aux questions.
   Pas d'activité si le deal existait déjà et que les réponses sont identiques à la dernière note de ce type (un
   double envoi ne pollue pas la fiche).
5. Notifier l'hôte : « Nouveau lead : {nom}, n'a pas encore réservé ».

Sécurité : limite 6 requêtes/min/IP (plus stricte que `book`), pot de miel `website_url`, corps validé par zod, aucun
accès direct à la base côté client. Rejet 404 si le type n'existe pas, est inactif, ou n'a pas `contact_first`.

### 3.3 Réservation après un lead

`book()` est inchangé dans son contrat. Seul `syncCrm` gagne une règle : si le deal réutilisé est à une étape
**antérieure** à l'étape d'entrée des rendez-vous, il avance à cette étape. Un deal déjà plus loin (proposition,
négociation) n'est jamais reculé. L'activité `meeting` s'ajoute comme aujourd'hui.

### 3.4 Réglage par type

Nouveau champ `booking_types.contact_first boolean not null default false` (le mode de contact est décrit en 3.7). Case à cocher dans
`type-modal.tsx` : « Demander les coordonnées avant le calendrier (les visiteurs sont enregistrés au CRM même sans
rendez-vous) ». Une seule option : le flux et la capture sont liés, car l'un sans l'autre n'a pas de sens.
Défaut `false` : aucun type existant ne change de comportement.

### 3.5 Mention RGPD

Sous le bouton de `info`, à la place du texte actuel : « Vos informations sont enregistrées pour vous recontacter,
même si vous ne réservez pas de créneau. » La durée de conservation est à décider côté responsable de traitement
(hors v1).

### 3.6 Détails d'interface relevés sur la capture de référence

| Observé | Reprise dans la v1 |
| --- | --- |
| Calendrier visible pendant le formulaire | oui, **flouté** (décision) : prop `locked` sur le calendrier, `filter: blur`, `pointer-events: none`, bulle `role="status"` |
| « Étape 1/2 » au-dessus du texte | oui : indicateur piloté par `flow.ts` (`stepIndex`) |
| Texte d'introduction long, défilant (« À lire attentivement ») | oui : `type.description`, zone à hauteur limitée avec défilement |
| Le **téléphone en premier**, avec drapeau et préfixe +33, puis « Prénom et Nom » | oui (décision : reproduction fidèle) : champ téléphone avec drapeau et préfixe pays, placé en tête, puis « Prénom et Nom ». L'email n'est pas visible sur la capture (formulaire coupé) : conservé après le nom, car la réservation et la confirmation en ont besoin |
| Mention de consentement avec liens « conditions » et « politique de confidentialité » | oui : deux URL configurables dans le profil de réservation (migration 0122), mention affichée sans lien si elles sont vides |
| Bouton « Continuer » pleine largeur | oui |
| Jour du mois courant marqué d'un point, jours disponibles surlignés | déjà fait par le calendrier actuel |
| Pastille flottante : photo du fondateur, « Dépose ta candidature », compte à rebours « Il ne reste que quelques places » | **non** : c'est un widget embarqué sur le site marketing, pas la page de réservation. Le compte à rebours est une rareté fabriquée, contraire à ta ligne « sous-promesse » : à ne pas copier |

Le téléphone en premier a une logique : un numéro est la meilleure clé de relance d'un lead qui abandonne. Mais cela
ajoute au schéma (`contacts.phone` existe déjà, `bookings.phone` aussi) la validation d'un format international, donc
un module pur de plus (`phone.ts`, voir 5.5).

### 3.7 Champs affichés et moyen de contact

Les questions supplémentaires viennent déjà de la configuration du type (éditeur `type-modal.tsx`) : le formulaire de
l'étape `info` les lit telles quelles, rien à ajouter pour elles. En revanche **l'email est aujourd'hui obligatoire en
dur** (`BookSchema`, `bookings.email`, confirmation, invitation Google, rappels, rattachement CRM). Pouvoir choisir
« téléphone », « email » ou « les deux » demande donc un réglage et des garde-fous.

Nouveau champ `booking_types.contact_mode text not null default 'email' check (contact_mode in ('email','phone','both'))` :

| Mode | Obligatoire | Facultatif | Comportement |
| --- | --- | --- | --- |
| `email` (défaut, comportement actuel) | nom, email | téléphone s'il est dans les questions | inchangé |
| `phone` | nom, téléphone | email | voir ci-dessous |
| `both` | nom, téléphone, email | | téléphone rendu en premier |

Conséquences d'un rendez-vous **sans email** (mode `phone`, email laissé vide) :
- Pas d'email de confirmation, de report/annulation ni de rappel : la page de confirmation affiche le récapitulatif,
  le lien « Déplacer ou annuler » et le fichier `.ics` (déjà présents). Le lieu « téléphone » devient le cas naturel.
- Pas d'invité sur l'évènement Google Agenda (l'évènement de David est créé quand même).
- Le CRM retrouve le contact par **téléphone normalisé** (E.164) à défaut d'email : le module `phone.ts` devient
  indispensable et non plus un confort. Sans lui, un même prospect créerait des doublons.
- Le lead partiel s'identifie par email, sinon par téléphone : `contactKey({ email, phone })`.
- Rappels : filtrés sur `email <> ''`.

Garde-fou : la validation refuse un formulaire où aucun moyen de contact n'est fourni, quel que soit le mode.
Dans l'éditeur du type : liste « Moyen de contact demandé » avec ces trois choix, et avertissement « sans email, aucun
message de confirmation ni rappel ne sera envoyé » en mode `phone`.

### 3.8 Qualité d'interface

Déclencheur de la capture (décision du 30 octobre 2026) : **à la sortie d'un champ de contact devenu valide**
(téléphone ou email selon le mode), puis de nouveau au clic sur « Continuer ». Un visiteur qui renseigne son contact
puis quitte la page est donc enregistré.

Cadre RGPD à poser avant de s'en servir (je ne suis pas juriste, à faire valider) :
- La mention actuelle (« En saisissant vos informations, vous acceptez que vos données soient enregistrées… »)
  reste visible **avant** les champs, avec liens vers conditions et politique de confidentialité. Elle informe, mais
  ne vaut pas à elle seule consentement au sens strict.
- Base juridique à choisir et écrire dans ta politique de confidentialité : intérêt légitime (éviter la perte de
  données d'une démarche commencée) plutôt que consentement. C'est le responsable de traitement, toi, qui la choisit.
- Durée de conservation courte et purge automatique des leads jamais réservés (30 à 90 jours à fixer).
- La note CRM indique l'origine : « capté à la saisie » ou « formulaire validé ».

À traiter dans la v1 :
- **Calendrier verrouillé réellement inerte** : attribut `inert` (clavier et lecteurs d'écran), pas seulement le
  flou et `pointer-events: none`.
- **Échec de la capture sans blocage** : si `POST /api/booking/lead` échoue (réseau, 429), on passe quand même à
  l'étape 2. La réservation envoie de toute façon les coordonnées. Pas de message d'erreur bloquant.
- **Double envoi** : bouton désactivé pendant l'appel, indicateur « Enregistrement… ».
- **Erreurs de champ** sous chaque champ (« Numéro invalide », « Adresse email invalide »), focus sur le premier
  champ en erreur, pas de validation au premier caractère tapé.
- **Focus** : après « Continuer », le focus va sur le premier jour disponible et un `aria-live` annonce « Étape 2
  sur 2, choisissez un créneau ».
- **Zone d'intro** : pas de défilement imbriqué sur mobile (piège au toucher). Texte complet affiché, ou replié
  derrière « Lire la suite » au-delà de quelques lignes.
- **Confirmation du créneau** : un tap sur un horaire le transforme en bouton « Confirmer 10:00 » (même ligne),
  pour éviter une réservation par erreur au pouce. Remplace la réservation instantanée du 3.1.
- **Rechargement de la page à l'étape 2** : les valeurs saisies sont conservées dans `sessionStorage` (par type),
  effacées à la confirmation. Retour à l'étape 1 sans ressaisie.
- **Mobile d'abord** (CSS écrit pour le téléphone, la mise en deux colonnes arrive à partir de 860 px) :
  - étape 1 : une colonne, le calendrier n'est pas affiché (une ligne « Étape 2 : vous choisirez votre créneau
    juste après » à la place du flou, qui n'apporte rien sur petit écran) ;
  - champs en 16 px (sinon iOS zoome), cibles tactiles d'au moins 44 px, clavier adapté (`inputmode` tel et email,
    `autocomplete` correct) ;
  - étape 2 : récapitulatif sur une ligne avec « Modifier », calendrier pleine largeur, horaires en grille de trois
    colonnes, bouton « Confirmer 10:00, lundi 2 novembre » collé en bas de l'écran (`position: sticky`, marge de
    sécurité iOS) ;
  - aucune largeur fixe, pas de défilement horizontal (vérifié à 390 px).

### 3.9 Définition : lead non booké

Lisibilité dans le CRM : une étape dédiée **« Lead non booké »** (à créer une fois dans les réglages du pipeline, en
première colonne). Le code l'utilise s'il la trouve (nom contenant « non booké », sans tenir compte de la casse ni des
accents), sinon il retombe sur la première étape ouverte. Les deals ajoutés à la main ne sont pas concernés. Le
tableau ci-dessous parle de « Nouveau lead » pour le cas sans cette étape.

Un visiteur qui laisse son contact sans réserver est un **lead non booké**, pas un rendez-vous manqué. Il n'existe
aucune ligne `bookings` pour lui, seulement un contact et un deal au CRM. Aucun champ de plus : l'état se déduit.

| État | Contact | Deal | Ligne `bookings` |
| --- | --- | --- | --- |
| Lead non booké | oui | à la première étape ouverte (« Nouveau lead »), source « Formulaire de réservation » | aucune |
| Lead booké | oui | avancé à « Appel découverte » | oui, confirmée |
| Rendez-vous annulé | oui | inchangé | statut `cancelled` (il redevient lead non booké si aucun autre rendez-vous) |

Entonnoir lisible sans développement supplémentaire, avec trois chiffres : leads captés (contacts créés avec la
source « Formulaire de réservation »), leads validés (note « Formulaire rempli »), leads bookés (contact avec au
moins un rendez-vous confirmé). Le taux de réservation est bookés ÷ captés.

Les leads non bookés restent à « Nouveau lead » jusqu'à la purge : à la fin du délai de conservation, le deal passe à
« Perdu » (raison « jamais réservé ») avant la suppression des données personnelles, pour garder le compte dans
l'entonnoir.

## 4. Découpage du code (clean code)

Principe : toute décision logique sort dans un module **pur** (sans `server-only`, sans alias `@/`, imports relatifs
`.ts`) pour être testable avec `node --experimental-strip-types --test`, comme `engine.ts`. Les fichiers d'IO restent
fins.

| Fichier | Rôle | Nature |
| --- | --- | --- |
| `src/lib/booking/flow.ts` (nouveau) | machine d'états `initialStep(cfg)`, `nextStep(step, event, cfg)` | pur |
| `src/lib/booking/answers.ts` (nouveau) | `validateAnswers(type, input)` extrait de `book()`, partagé par `book()` et `captureLead()` | pur |
| `src/lib/booking/contact.ts` (nouveau) | `ContactMode`, `fieldsFor(mode)`, `contactKey`, `canEmail`, schéma de contact selon le mode | pur |
| `src/lib/booking/phone.ts` (nouveau) | normalisation E.164, validation | pur |
| `src/lib/booking/capture.ts` (nouveau) | `shouldCapture(...)` : quand envoyer un lead partiel | pur |
| `src/lib/booking/lead.ts` (nouveau) | `LeadSchema` (zod), `planLead({ stages, openDeal, lastNote, input })` retourne un plan d'opérations, `advanceStage(current, entry, stages)` | pur |
| `src/lib/booking/server.ts` | `captureLead(input)` exécute le plan (IO), `book()` appelle `validateAnswers`, `syncCrm` appelle `advanceStage` | IO |
| `src/app/api/booking/lead/route.ts` (nouveau) | limite de débit, parse, appelle `captureLead`, réponse neutre | IO fin |
| `src/components/booking/public-booker.tsx` | consomme `flow.ts`, ajoute le rendu de `info` (réutilise les champs du formulaire actuel extraits en sous-composant `ContactFields`) | UI |
| `src/components/booking/type-modal.tsx` | case `contact_first` | UI |
| `src/app/b/[user]/[type]/page.tsx` | passe `contactFirst` au composant | UI |
| `supabase/migrations/0122_booking_contact_first.sql` (nouveau) | colonnes `contact_first`, `contact_mode`, URL conditions et confidentialité | SQL |
| `src/lib/database.types.ts`, `src/lib/setup/checks.ts` | type du champ ; `SCHEMA_VERSION = 122` | types |
| `supabase/setup.sql` | régénéré par `node scripts/build-setup-sql.mjs` | généré |

Conventions : pas de commentaires explicatifs verbeux dans le code (les explications vivent dans ce document), pas de
dépendance ajoutée, pas d'abstraction sans deux usages réels.

## 5. TDD : tests à écrire avant le code

Commande : `node --experimental-strip-types --test src/lib/booking/tests/`. Ajouter au `package.json` un script
`"test:unit": "node --experimental-strip-types --test src/lib/booking/tests/"` (pas de glob global : `mcp.test.mjs`
exige un serveur de dev et une base).

Cycle pour chaque module : écrire le test, le voir échouer pour la bonne raison, écrire le minimum, le voir passer,
puis refactorer. Ordre d'exécution ci-dessous.

### 5.1 `flow.test.mjs` (machine d'états)

1. `contactFirst=false`, pas de report : étape initiale `pick`.
2. `contactFirst=true`, pas de report : étape initiale `info`.
3. `contactFirst=true`, report : étape initiale `pick`.
4. `info` + `INFO_SUBMITTED` : `pick`.
5. `pick` + `SLOT_CHOSEN` avec `contactFirst=true` : `submitting` (réservation immédiate, pas de `form`).
6. `pick` + `SLOT_CHOSEN` avec `contactFirst=false` : `form` (non-régression).
7. `submitting` + `BOOKED` : `done`.
8. `submitting` + `SLOT_TAKEN` (409) : `pick`.
9. `submitting` + `FAILED` : reste sur l'étape précédente avec l'erreur (pas de perte des valeurs).
10. `pick` + `EDIT_INFO` avec `contactFirst=true` : `info`.
11. Événement impossible depuis une étape (ex. `BOOKED` depuis `info`) : étape inchangée.

Ajouts liés au rendu verrouillé (même fichier) :
12. `calendarLocked('info', cfg)` vrai ; `calendarLocked('pick', cfg)` faux ; toujours faux si `contactFirst=false`.
13. `stepIndex` : `info` = 1, `pick` et `submitting` = 2, sur 2 ; sans `contactFirst`, aucun indicateur.

### 5.2 `answers.test.mjs` (extraction depuis `book()`, à écrire AVANT l'extraction)

Ces tests fixent le comportement actuel pour que le refactor ne le casse pas.
1. Question obligatoire vide : erreur « Le champ « X » est obligatoire. ».
2. Valeur `select` hors options : erreur « Valeur invalide pour « X ». ».
3. Valeur `select` valide : conservée.
4. Texte court tronqué à 300 caractères, `textarea` à 3000.
5. Lieu « phone » sans question `phone` définie : téléphone exigé, ajouté aux réponses, tronqué à 40.
6. Lieu « phone » avec question `phone` non obligatoire : devient obligatoire.
7. Réponse à une clé inconnue : ignorée.
8. Espaces autour des valeurs : retirés.

### 5.3 `lead.test.mjs`

`LeadSchema` :
1. Nom de moins de 2 caractères : refus ; email invalide : refus ; email normalisé en minuscules et sans espaces.
2. `website_url` non vide (robot) : refus.
3. Pas de champ créneau requis (différence avec `BookSchema`).

`planLead` (entrées : étapes du pipeline, deal ouvert éventuel, dernière note éventuelle, saisie) :
4. Aucun deal ouvert : plan = créer deal à la **première** étape ouverte (jamais « découverte ») + note + notification.
5. Deal ouvert existant : plan = pas de nouveau deal.
6. Deal existant, réponses différentes de la dernière note : note ajoutée.
7. Deal existant, réponses identiques : aucune note (idempotence), aucune notification.
8. Source = `utm_source / utm_campaign` si présents, sinon « Formulaire de réservation ».
9. Titre du deal = « {Type} · {entreprise ou nom} » tronqué à 200.
10. Aucune étape ouverte dans le pipeline : plan avec `stage = null`, sans lever d'erreur.
10 bis. Étape « Lead non booké » présente (n'importe où dans le pipeline) : choisie de préférence à la première étape ouverte.

`advanceStage` :
11. Deal à « Nouveau lead », étape d'entrée « Appel découverte » : avance.
12. Deal à « Proposition envoyée » : ne recule pas.
13. Deal déjà à l'étape d'entrée : inchangé.
14. Deal à une étape fermée (gagné/perdu) : inchangé.

Capture à la saisie (`capture.test.mjs`) :
15. Contact invalide (email mal formé, numéro trop court) : pas d'envoi.
16. Contact valide à la sortie du champ : envoi, nom facultatif.
17. Même contenu déjà envoyé : pas de second envoi (pas de rafale d'appels).
18. Contenu modifié depuis le dernier envoi : nouvel envoi.
19. Clic sur « Continuer » : envoi final même si le contenu n'a pas changé (marque le lead « formulaire validé »).
20. Lead partiel sans nom : accepté par `LeadSchema` (nom facultatif, 2 caractères minimum s'il est donné), deal titré
    avec l'email ou le téléphone.

### 5.4 Intégration (niveau 2, base de dev, même style que `mcp.test.mjs`)

Script `src/lib/booking/tests/lead.integration.test.mjs`, exige `npm run dev` et `.env.local`, crée et supprime ses
données de test.
1. `POST /api/booking/lead` sur un type sans `contact_first` : 404.
2. Même requête sur un type `contact_first` : 200 `{ ok: true }`, un contact et un deal à « Nouveau lead » existent.
3. Même requête rejouée : toujours un seul deal, une seule note.
4. Email inconnu et email connu : corps de réponse identique (pas d'énumération).
5. `POST /api/booking/book` ensuite avec le même email : le deal existant avance à « Appel découverte », une seule
   fiche contact, une activité `meeting`.
6. 7e appel en moins d'une minute depuis la même IP : 429.
7. Pot de miel rempli : 400.

### 5.6 `contact.test.mjs` (mode de contact)

1. Mode `email` : email exigé, téléphone facultatif (non-régression).
2. Mode `phone` : téléphone exigé et valide, email facultatif ; email invalide fourni : refus.
3. Mode `both` : les deux exigés.
4. Aucun moyen de contact fourni : refus, dans les trois modes.
5. `contactKey` : l'email normalisé s'il existe, sinon le téléphone en E.164, sinon refus.
6. `canEmail({ email })` : faux pour une chaîne vide, vrai sinon (pilote confirmation, invité Google, rappels).
7. `fieldsFor(mode)` : ordre et caractère obligatoire des champs rendus (téléphone en tête en modes `phone` et `both`).

### 5.5 `phone.test.mjs` (indispensable : rattachement CRM par téléphone, voir 3.7)

1. `0612345678` avec pays FR : normalisé en `+33612345678`.
2. `+33 6 12 34 56 78` et `06.12.34.56.78` : même résultat.
3. Préfixe seul (`+33`) ou moins de 8 chiffres : refus.
4. Lettres ou caractères parasites : refus.
5. Numéro étranger déjà au format international (`+41 79 …`) : conservé.

### 5.7 Vérification manuelle (une fois, avant release)

1. Type avec la case décochée : flux identique à aujourd'hui.
2. Type coché : formulaire d'abord, calendrier après, un clic confirme, mail de confirmation reçu.
   Refaire avec le mode `phone` et l'email vide : réservation créée, aucun email envoyé, `.ics` disponible, un seul
   contact au CRM si on réserve deux fois avec le même numéro écrit de deux façons.
3. Abandon après le formulaire : le lead apparaît dans le CRM à « Nouveau lead » avec la note.
4. Report via le lien de l'email : arrive directement sur le calendrier.
5. Mobile : le formulaire et le calendrier restent utilisables.

## 6. Ordre d'implémentation

1. Branche `feature/booking-contact-first`, script `test:unit`.
2. `answers.test.mjs`, puis extraction de `validateAnswers` (refactor sous filet, comportement identique).
3. `flow.test.mjs`, puis `flow.ts`.
4. `lead.test.mjs`, puis `lead.ts`.
5. Migration `0122`, types, `SCHEMA_VERSION`, régénération de `setup.sql`.
6. `captureLead`, route `/api/booking/lead`, règle `advanceStage` dans `syncCrm`, test d'intégration.
7. UI : `ContactFields`, étape `info`, case dans `type-modal`, page publique.
8. `npm run lint`, `npm run build`, `npm run test:unit`, test d'intégration, vérification manuelle.
9. `CHANGELOG.md`, `docs/docker-coolify.md` (nouvelle migration à appliquer avant la mise à jour).

## 7. Mise en production

Ordre impératif pour ne rien casser :
1. **Appliquer la migration `0122` sur le Supabase Cloud** (SQL Editor ou outil MCP). Le code lit la colonne
   `contact_first` : sans elle, la page publique échoue.
2. Construire l'image `0.1.2` (arguments de build identiques à `0.1.1`), vérifier la clé anon dans le bundle, pousser.
3. Passer le tag Coolify à `0.1.2`. Ne pas déclencher de déploiement manuel en plus d'un push git (double build).
4. Cocher « coordonnées avant le calendrier » sur « Appel découverte », tester avec un email personnel.

Retour arrière : repasser le tag Coolify à `0.1.1`. La colonne reste en base sans effet (défaut `false`).

## 8. Décisions

Prises (30 octobre 2026) :
1. Flux en deux écrans (« Étape 1/2 » formulaire, « Étape 2/2 » créneaux), calendrier **flouté** tant que le formulaire n'est pas validé.
2. **Lead partiel** (niveau 2) : capture au CRM dès la validation du formulaire.
3. Une seule option `contact_first` pour le flux et la capture.
4. Deal d'un lead à « Nouveau lead », avancé à « Appel découverte » à la réservation.
5. API des créneaux non verrouillée en v1.
6. **Reproduction fidèle de la capture** : téléphone en premier avec préfixe pays (5.5), liens conditions et
   confidentialité, calendrier flouté, « Étape 1/2 », texte d'intro défilant, bouton « Continuer » pleine largeur.
7. **Moyen de contact au choix par type** : `email`, `phone` ou `both` (3.7), défaut `email`.
8. Aucun compte à rebours ni rareté affichée.
9. Aucune mention de l'outil de référence dans le code, les textes ou la documentation.

Restant à fixer avant du trafic payant : base juridique écrite dans la politique de confidentialité, durée de
conservation et purge des leads jamais réservés.

## 9. Reste à faire

État au 1er novembre 2026 : fonctionnalité codée, testée (83 tests unitaires, 50 vérifications e2e), poussée sur
`feature/booking-contact-first`. Non fusionnée, non déployée.

### Mise en ligne (dans cet ordre)
- [ ] Appliquer la migration `0122` sur le Supabase de production, **avant** l'image : la page publique lit les
      nouvelles colonnes.
- [ ] Construire et pousser l'image `0.1.2`, puis passer le tag Coolify dessus (pas de déploiement manuel en plus du
      push, ça double le build).
- [ ] Créer l'étape « Lead non booké » en première colonne du pipeline (Réglages > Pipeline).
- [ ] Cocher « Demander les coordonnées avant d'afficher les créneaux » sur « Appel découverte ».
- [ ] Renseigner les liens conditions et confidentialité (Réservation > page publique).
- [ ] Décider : ouvrir une pull request vers `main` du fork, ou rester sur la branche.

### Interface
- [ ] **Sélecteur de pays avec drapeau** : le préfixe est fixé à +33 (drapeau français). Un numéro étranger se saisit
      en `+41…`. Pas indispensable pour l'instant.
- [ ] Ordre des champs en mode email : le code garde nom, email, téléphone (comme avant), la maquette mettait l'email
      avant le nom. À trancher.
- [ ] Validation d'email côté navigateur volontairement simple (le serveur reste strict) : la durcir si besoin.

### À vérifier à la main (pas couvert par le e2e)
- [ ] Mode téléphone sans email : annulation, rappels, report par le lien, invité Google Agenda, `.ics`.
- [ ] Report d'un rendez-vous (`/b/r/[token]`) sur un type « coordonnées d'abord ».
- [ ] Rendu sur un vrai téléphone (iOS Safari : zoom des champs, barre « Confirmer » collée en bas).

### RGPD et données
- [ ] Écrire la base juridique (intérêt légitime) dans la politique de confidentialité. À faire relire.
- [ ] Fixer la durée de conservation des leads jamais réservés (30 à 90 jours) et **automatiser la purge** :
      deal à « Perdu » (raison « jamais réservé »), puis suppression des données personnelles.
- [ ] Prévoir la désinscription / le droit d'opposition dans toute relance envoyée à un lead.

### Livraison automatique (idée de David, 1er novembre 2026)
Versionner `main` en semver et laisser une CI construire l'image Docker à chaque version.
- [ ] Un tag `vX.Y.Z` sur `main` déclenche un workflow qui construit l'image et la pousse sur Docker Hub
      (`poltergeistz/agence-os:X.Y.Z`, plus `latest`). Coolify reste épinglé sur le numéro de version.
- [ ] Prérequis : le `Dockerfile`, le compose et `next.config.ts` (branche `feature/docker`) doivent d'abord être dans
      `main` du fork. Aujourd'hui ils n'y sont pas, volontairement.
- [ ] Contrainte à garder en tête : les variables `NEXT_PUBLIC_*` (URL Supabase, clé anon, URL de l'app) sont figées
      dans l'image à la construction. La CI les reçoit en secrets de dépôt (valeurs publiques) et l'image produite est
      donc propre à ton instance. Pour une image réutilisable ailleurs, il faudrait injecter ces valeurs au démarrage.
- [ ] Choix de l'outil : GitHub Actions (le fork est sur GitHub, rien à héberger) ou Woodpecker (ton Forgejo).
- [ ] Choix du versionnage : tag manuel, ou génération automatique (release-please, depuis les messages de commit).
- [ ] Aligner `package.json` (0.1.0) sur la version de l'image en cours (0.1.1).
- [ ] La migration SQL doit toujours passer **avant** le déploiement de l'image : à rappeler dans les notes de version.

### Évolutions possibles
- [ ] Relance des leads non bookés : v1 = tâche CRM à J+1, v2 = envoi automatique (cas à tester : a-t-il réservé
      entre-temps, désinscription, fréquence).
- [ ] **Squelette de calendrier à la place du calendrier flouté (bureau uniquement).** Aujourd'hui l'arrière-plan
      flouté de l'étape 1 est le vrai calendrier, avec les vraies disponibilités, rendu inerte. Cible : une grille
      factice grisée, et les créneaux ne sont demandés à `/api/booking/slots` qu'après « Continuer » (moins d'appels
      pour les visiteurs qui abandonnent, rien à lire dans la page avant la validation). Coût : un court chargement
      à l'étape 2. Sur mobile le calendrier est déjà masqué à l'étape 1, mais la requête des créneaux part quand même
      au chargement : à décaler aussi. N'empêche pas l'accès direct à l'API (voir le jeton signé ci-dessous).
- [ ] Capture à la saisie plus fine (par champ) une fois l'avis RGPD obtenu.
- [ ] Verrouillage de l'API des créneaux par jeton signé, seulement si du scraping apparaît.
- [ ] Entonnoir (captés, validés, bookés) affiché dans le tableau de bord plutôt que lu dans le CRM.

### Outils
- Tests unitaires : `npm run test:unit`. E2E : `npm run test:e2e` (serveur de dev + `.env.local` pointant sur une
  base de DEV, jamais la production). Une base jetable se monte avec la CLI Supabase hors du dépôt (configuration
  minimale : `-x studio,logflare,vector,edge-runtime,imgproxy,mailpit,realtime,postgres-meta,supavisor`).
- La maquette interactive du formulaire est dans l'espace artefacts de David (« Maquette réservation coordonnées
  d'abord »).
