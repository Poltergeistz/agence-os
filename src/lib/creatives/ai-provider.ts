// Choix du fournisseur IA et dialogue avec une API compatible OpenAI (OpenRouter, OpenAI, Gemini, Ollama…).
// Pur (aucun import) : testé avec node --experimental-strip-types --test src/lib/creatives/tests/

export type Provider =
  | { kind: "anthropic"; id: "anthropic"; label: string; keyVar: string }
  | { kind: "openai"; id: "openrouter" | "openai"; label: string; keyVar: string; baseUrl: string; apiKey: string };
export type OpenAiProvider = Extract<Provider, { kind: "openai" }>;
export type Env = Record<string, string | undefined>;

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

function httpUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Fournisseur choisi par les variables d'environnement. AI_PROVIDER (anthropic, openrouter, openai) force le choix ;
 * sinon, par ordre : API libre (AI_API_KEY + AI_BASE_URL), OpenRouter, Anthropic.
 */
export function resolveProvider(env: Env): Provider | null {
  const v = (k: string) => env[k]?.trim() ?? "";
  const anthropic = (): Provider | null => (v("ANTHROPIC_API_KEY") ? { kind: "anthropic", id: "anthropic", label: "Anthropic", keyVar: "ANTHROPIC_API_KEY" } : null);
  const openrouter = (): Provider | null =>
    v("OPENROUTER_API_KEY") ? { kind: "openai", id: "openrouter", label: "OpenRouter", keyVar: "OPENROUTER_API_KEY", baseUrl: OPENROUTER_URL, apiKey: v("OPENROUTER_API_KEY") } : null;
  const generic = (): Provider | null => {
    const url = httpUrl(v("AI_BASE_URL"));
    if (!v("AI_API_KEY") || !url) return null;
    return { kind: "openai", id: "openai", label: url.host, keyVar: "AI_API_KEY", baseUrl: v("AI_BASE_URL").replace(/\/+$/, ""), apiKey: v("AI_API_KEY") };
  };
  const byName: Record<string, () => Provider | null> = { anthropic, openrouter, openai: generic };
  const forced = byName[v("AI_PROVIDER").toLowerCase()];
  return forced ? forced() : (generic() ?? openrouter() ?? anthropic());
}

const DEFAULT_MODELS = {
  anthropic: { fast: "claude-haiku-4-5-20251001", smart: "claude-sonnet-5" },
  openrouter: { fast: "anthropic/claude-haiku-4.5", smart: "anthropic/claude-sonnet-4.5" },
  openai: { fast: "", smart: "" },
};

/** Modèle rapide (étiquetage) et modèle avancé (recommandations). Vide = à renseigner. */
export function modelsFor(p: Provider, env: Env) {
  const d = DEFAULT_MODELS[p.id];
  return { fast: env.AI_MODEL_FAST?.trim() || d.fast, smart: env.AI_MODEL_SMART?.trim() || d.smart };
}

export interface ChatAsk {
  model: string;
  system: string;
  user: string;
  schema: object;
  schemaName: string;
  maxTokens: number;
  /** json_schema : sortie contrainte ; json_object : repli pour les modèles qui ne gèrent pas les schémas */
  mode: "json_schema" | "json_object";
}

export function buildChatRequest(p: OpenAiProvider, a: ChatAsk) {
  const headers: Record<string, string> = { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" };
  if (p.id === "openrouter") headers["X-Title"] = "Agence OS";
  const schemaMode = a.mode === "json_schema";
  const system = schemaMode ? a.system : `${a.system}\n\nRéponds uniquement par un objet JSON conforme à ce schéma JSON :\n${JSON.stringify(a.schema)}`;
  const body: Record<string, unknown> = {
    model: a.model,
    max_tokens: a.maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: a.user },
    ],
    response_format: schemaMode ? { type: "json_schema", json_schema: { name: a.schemaName, strict: true, schema: a.schema } } : { type: "json_object" },
  };
  if (p.id === "openrouter" && schemaMode) body.provider = { require_parameters: true };
  return { url: `${p.baseUrl}/chat/completions`, headers, body };
}

export type ChatResult =
  | { ok: true; json: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number; cost?: number } }
  | { ok: false; kind: "truncated" | "refusal" | "invalid"; message: string };

function extractJson(text: string): Record<string, unknown> | undefined {
  const ok = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined);
  try {
    return ok(JSON.parse(text.trim()));
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a < 0 || b <= a) return undefined;
    try {
      return ok(JSON.parse(text.slice(a, b + 1)));
    } catch {
      return undefined;
    }
  }
}

export function parseChatResponse(body: unknown): ChatResult {
  const root = (body && typeof body === "object" ? body : {}) as { error?: { message?: string }; choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: unknown } };
  const choice = root.choices?.[0];
  if (!choice) return { ok: false, kind: "invalid", message: root.error?.message ? `Le fournisseur IA a renvoyé une erreur : ${String(root.error.message).slice(0, 200)}` : "Réponse vide du fournisseur IA." };
  if (choice.finish_reason === "length") return { ok: false, kind: "truncated", message: "Réponse du modèle tronquée : réduis la taille du lot ou choisis un modèle qui accepte plus de texte." };
  if (choice.finish_reason === "content_filter" || choice.message?.refusal) return { ok: false, kind: "refusal", message: "Le modèle a refusé de répondre." };
  const raw = choice.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((x) => (x && typeof x === "object" && "text" in x ? String((x as { text: unknown }).text) : "")).join("") : "";
  const json = extractJson(text);
  if (!json) return { ok: false, kind: "invalid", message: "Le modèle n'a pas renvoyé de JSON lisible : choisis un modèle qui gère les sorties structurées (AI_MODEL_FAST, AI_MODEL_SMART)." };
  const cost = root.usage?.cost;
  return { ok: true, json, usage: { input_tokens: root.usage?.prompt_tokens ?? 0, output_tokens: root.usage?.completion_tokens ?? 0, ...(typeof cost === "number" ? { cost } : {}) } };
}

/** Erreur HTTP de l'API → message en français, sans la clé. */
export function explainStatus(p: { label: string; keyVar: string; apiKey?: string }, status: number, message: string) {
  const clean = (p.apiKey ? message.split(p.apiKey).join("***") : message).slice(0, 200);
  if (status === 401 || status === 403) return `Clé refusée par ${p.label} : vérifie ${p.keyVar} dans les variables d'environnement.`;
  if (status === 404) return `Modèle introuvable chez ${p.label} : vérifie AI_MODEL_FAST et AI_MODEL_SMART.`;
  if (status === 402) return `Crédit insuffisant chez ${p.label} : recharge ton compte.`;
  if (status === 429) return `Limite de ${p.label} atteinte : réessaie dans une minute.`;
  if (status === 400 || status === 422) return `Requête refusée par ${p.label} : ${clean}`;
  return `${p.label} indisponible (${status}) : réessaie plus tard.`;
}

/** Le modèle ou le fournisseur ne gère pas les schémas JSON : on retente en objet JSON simple. */
export const isFormatUnsupported = (status: number, message: string) =>
  (status === 400 || status === 422) && /response_format|json_schema|structured|json mode|json_object/i.test(message);
