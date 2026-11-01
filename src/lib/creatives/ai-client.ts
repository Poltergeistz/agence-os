// Client IA unique : un seul endroit décide du fournisseur (Anthropic ou API compatible OpenAI).
// Deux niveaux : « fast » (étiquetage en masse) et « smart » (recommandations, avec réflexion chez Anthropic).
// Sans import « server-only » pour pouvoir être testé avec node --experimental-strip-types --test ;
// il n'est utilisé que par ai.ts, côté serveur.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { AiError, chat } from "./ai-chat.ts";
import { modelsFor, resolveProvider, type Env, type Provider } from "./ai-provider.ts";

export type Tier = "fast" | "smart";
export interface AiAsk {
  tier: Tier;
  system: string;
  user: string;
  schema: z.ZodType;
  schemaName: string;
  maxTokens: number;
}
export interface AiAnswer {
  json: unknown;
  /** cost : coût réel en dollars quand le fournisseur le donne (OpenRouter) */
  usage: { input_tokens: number; output_tokens: number; cache_read: number; cost?: number };
  model: string;
}

const ANTHROPIC: Provider = { kind: "anthropic", id: "anthropic", label: "Anthropic", keyVar: "ANTHROPIC_API_KEY" };

/** Modèles qui seront utilisés (ceux d'Anthropic tant qu'aucune clé n'est configurée). */
export const modelsOf = (env: Env = process.env) => modelsFor(resolveProvider(env) ?? ANTHROPIC, env);

export function aiEnabled(env: Env = process.env) {
  if (env.AI_MOCK === "1") return true;
  const m = modelsOf(env);
  return !!resolveProvider(env) && !!m.fast && !!m.smart;
}

let cached: { key: string; client: Anthropic } | null = null;
function anthropic(key: string) {
  if (cached?.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }) };
  return cached.client;
}

/** Erreur de l'API → message en français, sans secret. */
function explain(e: unknown, label: string): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new AiError("Clé ANTHROPIC_API_KEY refusée : vérifie-la dans les variables d'environnement.");
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError("La clé Anthropic n'a pas accès à ce modèle : change AI_MODEL_FAST ou AI_MODEL_SMART.");
  if (e instanceof Anthropic.NotFoundError) return new AiError("Modèle introuvable : vérifie AI_MODEL_FAST et AI_MODEL_SMART.");
  if (e instanceof Anthropic.RateLimitError) return new AiError("Limite de l'API Anthropic atteinte : réessaie dans une minute.");
  if (e instanceof Anthropic.BadRequestError) return new AiError(`Requête refusée par l'API Anthropic : ${e.message.slice(0, 200)}`);
  if (e instanceof Anthropic.APIConnectionError) return new AiError("Impossible de joindre l'API Anthropic (réseau ou délai dépassé).");
  if (e instanceof Anthropic.APIError) return new AiError(`API Anthropic indisponible (${e.status ?? "erreur"}) : réessaie plus tard.`);
  if (e instanceof TypeError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")))
    return new AiError(`Impossible de joindre ${label} (réseau ou délai dépassé).`);
  return new AiError(e instanceof Error ? e.message : String(e));
}

/** Pose une question et renvoie la réponse JSON brute (à valider par l'appelant). */
export async function askJson(a: AiAsk, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<AiAnswer> {
  const p = resolveProvider(env);
  if (!p) throw new AiError("L'IA n'est pas configurée : ajoute ANTHROPIC_API_KEY, OPENROUTER_API_KEY ou AI_API_KEY dans les variables d'environnement.");
  const model = modelsFor(p, env)[a.tier];
  if (!model) throw new AiError(`${p.label} : renseigne AI_MODEL_FAST et AI_MODEL_SMART (identifiants des modèles à utiliser).`);
  try {
    if (p.kind === "openai") {
      const r = await chat(p, { model, system: a.system, user: a.user, schema: a.schema, schemaName: a.schemaName, maxTokens: a.maxTokens }, fetchImpl);
      return { json: r.json, usage: { ...r.usage, cache_read: 0 }, model };
    }
    const smart = a.tier === "smart";
    const res = await anthropic(env.ANTHROPIC_API_KEY?.trim() ?? "").messages.parse({
      model,
      max_tokens: a.maxTokens,
      ...(smart ? { thinking: { type: "adaptive" as const } } : {}),
      system: [{ type: "text", text: a.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: a.user }],
      output_config: { ...(smart ? { effort: "medium" as const } : {}), format: zodOutputFormat(a.schema) },
    });
    if (res.stop_reason === "max_tokens") throw new AiError("Réponse du modèle tronquée : réessaie ou réduis la taille du lot.");
    if (res.stop_reason === "refusal") throw new AiError("Le modèle a refusé de répondre.");
    return {
      json: res.parsed_output,
      usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, cache_read: res.usage.cache_read_input_tokens ?? 0 },
      model,
    };
  } catch (e) {
    throw explain(e, p.label);
  }
}
