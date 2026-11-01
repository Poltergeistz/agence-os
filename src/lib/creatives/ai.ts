import "server-only";

import { AiError } from "./ai-chat";
import { aiEnabled, askJson, modelsOf } from "./ai-client";
import { RecommendationSchema, TagBatchSchema, mockRecommendation, mockTags, validateRecommendation, validateTagBatch, type RecoInput, type Recommendation } from "./ai-parse";
import type { IntelTags } from "./intel-core";

// IA de la bibliothèque créa (facultative) : tagging en masse et recommandations.
// Fournisseur au choix (voir ai-provider.ts et ai-client.ts) : Anthropic, OpenRouter ou toute API
// compatible OpenAI. Sans clé, tout le reste fonctionne ; AI_MOCK=1 (interne, tests) renvoie des
// réponses simulées sans appel réseau.

export { AiError, aiEnabled };
export const AI_MODEL_FAST = () => modelsOf().fast;
export const AI_MODEL_SMART = () => modelsOf().smart;
const mock = () => process.env.AI_MOCK === "1";

/** Nombre maximum d'éléments tagués par synchro ou par clic (maîtrise du coût). */
export const AI_TAG_LIMIT = Math.max(0, Number(process.env.AI_TAG_LIMIT || 40)) || 40;
const BATCH = 10;

// ---------------------------------------------------------------------
// Tagging (modèle rapide, par lots de 10)
// ---------------------------------------------------------------------
const TAG_SYSTEM = `Tu es creative strategist dans une agence de media buying française. Tu analyses des publicités (Meta, TikTok…) et des concepts créatifs pour les classer, sans rien inventer.

Pour chaque élément, renseigne :
- angle : l'angle marketing en 2 à 4 mots, en français, formulé de façon réutilisable d'une marque à l'autre (ex. « Preuve sociale », « Routine simplifiée », « Prix accessible », « Artisanat et fait main », « Transformation avant/après », « Expertise et transparence »).
- hook_type : question (interpelle par une question), chiffre (ouvre sur un nombre), douleur (nomme un problème vécu), temoignage (parole de client), contraste (avant/après, eux contre nous, idée reçue retournée), curiosite (secret, « pourquoi », POV), promesse (bénéfice direct), autorite (expert, médecin, designer), offre (remise, promo, gratuit), humour, autre.
- hook : la phrase d'accroche telle qu'elle apparaît (en général la première phrase).
- awareness, selon les 5 niveaux de conscience d'Eugene Schwartz : unaware (ne sait pas qu'il a un problème : histoire, émotion), problem (ressent le problème, ne connaît pas de solution), solution (connaît le type de solution, pas le produit), product (connaît le produit, hésite : preuves, avis, comparaison), most (prêt à acheter : offre, urgence).
- format : static, carousel, short_video, ugc (face caméra, créateur), motion, dpa (catalogue), other. Déduis-le des indices du texte (« je vous montre », « en 30 secondes » → vidéo ; plusieurs produits → carrousel) ; en l'absence d'indice, static.
- promise, proof, offer, cta, persona : courts, en français ; chaîne vide si absent.

Réponds uniquement pour les identifiants fournis.`;

async function tagBatch(items: { id: string; text: string; format?: string | null }[]): Promise<Map<string, IntelTags>> {
  if (mock()) return new Map(items.map((i) => [i.id, mockTags(i)]));
  const user = `Classe ces ${items.length} éléments :\n\n${items.map((i) => `<element id="${i.id}"${i.format ? ` format_connu="${i.format}"` : ""}>\n${i.text.slice(0, 1500)}\n</element>`).join("\n\n")}`;
  const r = await askJson({ tier: "fast", system: TAG_SYSTEM, user, schema: TagBatchSchema, schemaName: "tags", maxTokens: 6000 });
  return validateTagBatch(r.json, items.map((i) => i.id));
}

/** Tague une liste d'éléments par lots. Renvoie les tags obtenus et la première erreur éventuelle. */
export async function tagItems(items: { id: string; text: string; format?: string | null }[]) {
  const out = new Map<string, IntelTags>();
  let error: string | null = null;
  for (let i = 0; i < items.length; i += BATCH) {
    try {
      for (const [k, v] of await tagBatch(items.slice(i, i + BATCH))) out.set(k, v);
    } catch (e) {
      error = e instanceof AiError ? e.message : e instanceof Error ? e.message : String(e);
      break; // on garde ce qui est acquis, la suite repartira au prochain appel
    }
  }
  return { tags: out, error, model: mock() ? "simulation" : AI_MODEL_FAST() };
}

// ---------------------------------------------------------------------
// Recommandations (modèle avancé)
// ---------------------------------------------------------------------
const RECO_SYSTEM = `Tu es head of creative strategy dans une agence de media buying française. À partir des performances réelles des créas d'un client et de ce que ses concurrents font tourner dans la bibliothèque publicitaire Meta, tu proposes les prochains concepts à produire.

Règles :
- 3 à 5 opportunités, de la plus rentable à la moins rentable. Trois types : scale (décliner un angle, un hook ou un format qui gagne déjà chez le client), counter (répondre à ce que les concurrents scalent : pubs à fort score, en ligne depuis longtemps, déclinées en variantes), gap (angle, niveau de conscience ou type de hook jamais testé).
- Chaque argument cite des chiffres fournis (ROAS, CPA, hook rate, écart à la moyenne, longévité, nombre de variantes, portée) et, quand c'est pertinent, les pubs concurrentes par leur identifiant d'archive exact (champ competitor_ads). N'invente aucun chiffre ni identifiant.
- Les pubs concurrentes ne donnent ni dépense ni résultats : leur longévité et leurs variantes sont des indices, pas des preuves. Formule-le ainsi.
- Chaque brief est prêt à tourner : titre du concept, angle, exactement 3 hooks différents (types variés), script court minuté, plans, format, niveau de conscience, persona, appel à l'action.
- Français, tutoiement, ton direct et concret. Jamais de tiret long. Pas de promesse médicale ni de superlatif invérifiable.`;

export async function recommend(input: RecoInput): Promise<{ output: Recommendation; model: string; usage: Record<string, unknown> | null }> {
  const known = input.competitors.map((c) => c.archive_id);
  if (mock()) return { output: validateRecommendation(mockRecommendation(input), known), model: "simulation", usage: null };
  const user = `Client : ${input.company}\nDonnées (JSON) :\n${JSON.stringify(input)}\n\nPropose les opportunités.`;
  const r = await askJson({ tier: "smart", system: RECO_SYSTEM, user, schema: RecommendationSchema, schemaName: "recommandation", maxTokens: 16000 });
  return { output: validateRecommendation(r.json, known), model: r.model, usage: r.usage };
}
