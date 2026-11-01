# Fournisseur d'IA au choix

L'IA de la bibliothèque créa (étiquetage des pubs et des concepts, recommandations) est facultative. Sans clé, la
veille, le score et les filtres fonctionnent. Avec une clé, tu choisis ton fournisseur : Anthropic, OpenRouter ou
n'importe quelle API compatible OpenAI.

## Choisir un fournisseur

Une seule clé suffit. Les variables se posent dans l'environnement du serveur (`.env.local`, Coolify, Vercel…) ;
la page **Réglages > Installation** détecte la clé et propose un bouton « Tester ».

| Fournisseur | Variables | Modèles par défaut |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-haiku-4-5-20251001` (rapide), `claude-sonnet-5` (avancé) |
| OpenRouter | `OPENROUTER_API_KEY` | `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-4.5` |
| API compatible OpenAI (OpenAI, Gemini, Mistral, Ollama…) | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL_FAST`, `AI_MODEL_SMART` | aucun : les deux modèles sont obligatoires |

- `AI_BASE_URL` est l'adresse de l'API sans `/chat/completions` (par exemple `https://api.openai.com/v1`).
- `AI_MODEL_FAST` sert à l'étiquetage en masse (tâche simple : un modèle bon marché suffit). `AI_MODEL_SMART` sert aux
  recommandations. Les deux se surchargent aussi chez Anthropic et OpenRouter, avec les identifiants du fournisseur
  (chez OpenRouter, par exemple `google/gemini-2.5-flash`).
- Si plusieurs clés existent, l'ordre est : API libre, puis OpenRouter, puis Anthropic. `AI_PROVIDER` (`anthropic`,
  `openrouter` ou `openai`) force le choix.
- Rien ne change tant qu'on n'ajoute pas de nouvelle clé : une installation avec `ANTHROPIC_API_KEY` seule se
  comporte comme avant.

## Comment ça marche

- **Anthropic** : appel direct avec le SDK officiel, sortie contrainte par schéma, cache de prompt, et réflexion
  adaptative pour les recommandations.
- **OpenRouter et API compatible OpenAI** : appel « chat completions » avec une sortie JSON contrainte par schéma.
  Si le modèle ou le fournisseur ne gère pas les schémas, une seule nouvelle tentative est faite en JSON simple.
  Dans tous les cas, chaque réponse est validée par les mêmes contrôles (valeurs hors liste ramenées à une valeur
  neutre, pubs concurrentes inconnues écartées). Le cache de prompt et la réflexion adaptative d'Anthropic ne sont
  pas utilisés sur ce chemin : choisis un modèle de qualité pour les recommandations.
- Les erreurs sont expliquées en français (clé refusée, modèle introuvable, crédit insuffisant, limite atteinte,
  réponse tronquée), avec la variable à vérifier, sans jamais afficher la clé.

## Suivre les coûts

- Chaque recommandation enregistre son modèle et sa consommation (jetons d'entrée et de sortie, et le **coût réel en
  dollars** quand le fournisseur le donne, ce qui est le cas d'OpenRouter) dans la colonne `usage` de
  `creative_recommendations`.
- L'étiquetage en masse n'est pas journalisé dans l'application : suis-le dans le tableau de bord du fournisseur.
- Conseil : crée une clé dédiée à Agence OS avec une limite de dépense (chez OpenRouter : *Keys > Credit limit* ;
  chez Anthropic : une limite mensuelle sur l'espace de travail). Le nombre d'éléments tagués par synchro ou par clic
  est plafonné par `AI_TAG_LIMIT` (40 par défaut).
- Ordre de grandeur avec Anthropic : environ 1 € pour 1 000 éléments tagués, 5 à 10 centimes par recommandation.
  Avec un autre modèle, les prix du fournisseur s'appliquent.

## En cas de problème

| Message | À faire |
| --- | --- |
| « Clé refusée par … » | La clé est fausse, révoquée ou d'un autre compte. Vérifie la variable indiquée. |
| « Modèle introuvable chez … » | Vérifie l'identifiant dans `AI_MODEL_FAST` / `AI_MODEL_SMART`. |
| « Crédit insuffisant chez … » | Recharge le compte du fournisseur. |
| « renseigne AI_MODEL_FAST et AI_MODEL_SMART » | Une API libre exige les deux modèles. |
| « Le modèle n'a pas renvoyé de JSON lisible » | Choisis un modèle qui gère les sorties structurées. |
