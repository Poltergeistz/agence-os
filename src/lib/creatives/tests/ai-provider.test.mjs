// Choix du fournisseur IA et dialogue avec une API compatible OpenAI (OpenRouter, OpenAI, Gemini, Ollama…).
// Usage : node --experimental-strip-types --test src/lib/creatives/tests/ai-provider.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildChatRequest, explainStatus, isFormatUnsupported, modelsFor, parseChatResponse, resolveProvider } from "../ai-provider.ts";

const OR = { kind: "openai", id: "openrouter", label: "OpenRouter", keyVar: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" };
const GEN = { kind: "openai", id: "openai", label: "api.exemple.fr", keyVar: "AI_API_KEY", baseUrl: "https://api.exemple.fr/v1", apiKey: "k" };
const ASK = { model: "m", system: "Sys", user: "Usr", schema: { type: "object" }, schemaName: "tags", maxTokens: 100, mode: "json_schema" };

// ---------------------------------------------------------------- fournisseur
test("aucune clé : pas de fournisseur", () => {
  assert.equal(resolveProvider({}), null);
  assert.equal(resolveProvider({ ANTHROPIC_API_KEY: "  ", OPENROUTER_API_KEY: "" }), null);
});

test("Anthropic seul : comportement d'origine", () => {
  assert.deepEqual(resolveProvider({ ANTHROPIC_API_KEY: "sk-a" }), { kind: "anthropic", id: "anthropic", label: "Anthropic", keyVar: "ANTHROPIC_API_KEY" });
});

test("OpenRouter seul : adresse prédéfinie", () => {
  const p = resolveProvider({ OPENROUTER_API_KEY: " sk-or " });
  assert.equal(p.kind, "openai");
  assert.equal(p.id, "openrouter");
  assert.equal(p.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(p.apiKey, "sk-or");
});

test("fournisseur libre : adresse et clé, sans barre finale", () => {
  const p = resolveProvider({ AI_API_KEY: "k", AI_BASE_URL: "https://api.exemple.fr/v1/" });
  assert.equal(p.baseUrl, "https://api.exemple.fr/v1");
  assert.equal(p.label, "api.exemple.fr");
  assert.equal(p.keyVar, "AI_API_KEY");
});

test("fournisseur libre sans adresse ou adresse invalide : ignoré", () => {
  assert.equal(resolveProvider({ AI_API_KEY: "k" }), null);
  assert.equal(resolveProvider({ AI_API_KEY: "k", AI_BASE_URL: "pas une adresse" }), null);
  assert.equal(resolveProvider({ AI_API_KEY: "k", AI_BASE_URL: "ftp://x" }), null);
  assert.equal(resolveProvider({ AI_API_KEY: "k", AI_BASE_URL: "x", ANTHROPIC_API_KEY: "a" }).kind, "anthropic");
});

test("plusieurs clés : libre, puis OpenRouter, puis Anthropic", () => {
  const all = { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o", AI_API_KEY: "k", AI_BASE_URL: "https://x.fr/v1" };
  assert.equal(resolveProvider(all).id, "openai");
  assert.equal(resolveProvider({ ...all, AI_API_KEY: "" }).id, "openrouter");
  assert.equal(resolveProvider({ ...all, AI_API_KEY: "", OPENROUTER_API_KEY: "" }).id, "anthropic");
});

test("AI_PROVIDER force le choix, et rien si sa clé manque", () => {
  const all = { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o", AI_API_KEY: "k", AI_BASE_URL: "https://x.fr/v1" };
  assert.equal(resolveProvider({ ...all, AI_PROVIDER: "anthropic" }).kind, "anthropic");
  assert.equal(resolveProvider({ ...all, AI_PROVIDER: "openrouter" }).id, "openrouter");
  assert.equal(resolveProvider({ ...all, AI_PROVIDER: " OpenAI " }).id, "openai");
  assert.equal(resolveProvider({ ANTHROPIC_API_KEY: "a", AI_PROVIDER: "openrouter" }), null);
  assert.equal(resolveProvider({ ...all, AI_PROVIDER: "inconnu" }).id, "openai");
});

// ---------------------------------------------------------------- modèles
test("modèles : valeurs d'origine pour Anthropic, surchargeables", () => {
  const a = { kind: "anthropic", id: "anthropic", label: "Anthropic", keyVar: "ANTHROPIC_API_KEY" };
  assert.deepEqual(modelsFor(a, {}), { fast: "claude-haiku-4-5-20251001", smart: "claude-sonnet-5" });
  assert.deepEqual(modelsFor(a, { AI_MODEL_FAST: "x", AI_MODEL_SMART: "y" }), { fast: "x", smart: "y" });
});

test("modèles : OpenRouter a des valeurs par défaut Claude, surchargeables", () => {
  assert.deepEqual(modelsFor(OR, {}), { fast: "anthropic/claude-haiku-4.5", smart: "anthropic/claude-sonnet-4.5" });
  assert.deepEqual(modelsFor(OR, { AI_MODEL_FAST: "google/gemini-2.5-flash" }), { fast: "google/gemini-2.5-flash", smart: "anthropic/claude-sonnet-4.5" });
});

test("modèles : fournisseur libre sans valeur par défaut", () => {
  assert.deepEqual(modelsFor(GEN, {}), { fast: "", smart: "" });
  assert.deepEqual(modelsFor(GEN, { AI_MODEL_FAST: " gpt-4o-mini ", AI_MODEL_SMART: "gpt-4o" }), { fast: "gpt-4o-mini", smart: "gpt-4o" });
});

// ---------------------------------------------------------------- requête
test("requête : adresse, clé, messages et schéma strict", () => {
  const r = buildChatRequest(GEN, ASK);
  assert.equal(r.url, "https://api.exemple.fr/v1/chat/completions");
  assert.equal(r.headers.Authorization, "Bearer k");
  assert.equal(r.headers["Content-Type"], "application/json");
  assert.equal(r.body.model, "m");
  assert.equal(r.body.max_tokens, 100);
  assert.deepEqual(r.body.messages, [{ role: "system", content: "Sys" }, { role: "user", content: "Usr" }]);
  assert.deepEqual(r.body.response_format, { type: "json_schema", json_schema: { name: "tags", strict: true, schema: { type: "object" } } });
  assert.equal(r.body.provider, undefined);
});

test("requête OpenRouter : exige un fournisseur qui gère le format demandé", () => {
  const r = buildChatRequest(OR, ASK);
  assert.deepEqual(r.body.provider, { require_parameters: true });
  assert.equal(r.headers["X-Title"], "Agence OS");
});

test("requête en mode objet JSON : le schéma passe dans le message système", () => {
  const r = buildChatRequest(GEN, { ...ASK, mode: "json_object" });
  assert.deepEqual(r.body.response_format, { type: "json_object" });
  assert.ok(r.body.messages[0].content.startsWith("Sys"));
  assert.ok(r.body.messages[0].content.includes('"type":"object"'));
  assert.equal(buildChatRequest(OR, { ...ASK, mode: "json_object" }).body.provider, undefined);
});

// ---------------------------------------------------------------- réponse
const reply = (content, extra = {}) => ({ choices: [{ message: { content }, finish_reason: "stop", ...extra }], usage: { prompt_tokens: 12, completion_tokens: 34 } });

test("réponse : JSON lu avec la consommation", () => {
  const r = parseChatResponse(reply('{"a":1}'));
  assert.deepEqual(r, { ok: true, json: { a: 1 }, usage: { input_tokens: 12, output_tokens: 34 } });
});

test("réponse : blocs de code et texte autour tolérés", () => {
  assert.deepEqual(parseChatResponse(reply('```json\n{"a":1}\n```')).json, { a: 1 });
  assert.deepEqual(parseChatResponse(reply('Voici le résultat : {"a":{"b":2}} voilà.')).json, { a: { b: 2 } });
});

test("réponse : coût réel repris quand le fournisseur le donne (OpenRouter)", () => {
  const r = parseChatResponse({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 8, cost: 0.00005 } });
  assert.deepEqual(r.usage, { input_tokens: 10, output_tokens: 8, cost: 0.00005 });
  assert.equal("cost" in parseChatResponse(reply("{}")).usage, false);
  assert.equal("cost" in parseChatResponse({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { cost: "x" } }).usage, false);
});

test("réponse : consommation absente tolérée", () => {
  const r = parseChatResponse({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
  assert.deepEqual(r.usage, { input_tokens: 0, output_tokens: 0 });
});

test("réponse tronquée", () => {
  const r = parseChatResponse(reply('{"a":', { finish_reason: "length" }));
  assert.equal(r.ok, false);
  assert.equal(r.kind, "truncated");
});

test("réponse refusée par le modèle ou filtrée", () => {
  assert.equal(parseChatResponse(reply(null, { finish_reason: "content_filter" })).kind, "refusal");
  assert.equal(parseChatResponse({ choices: [{ message: { content: null, refusal: "Non." }, finish_reason: "stop" }] }).kind, "refusal");
});

test("réponse illisible ou vide", () => {
  assert.equal(parseChatResponse(reply("pas du json")).kind, "invalid");
  assert.equal(parseChatResponse(reply("")).kind, "invalid");
  assert.equal(parseChatResponse({ choices: [] }).kind, "invalid");
  assert.equal(parseChatResponse(null).kind, "invalid");
  assert.equal(parseChatResponse(reply("[1,2]")).kind, "invalid");
});

test("réponse 200 qui contient une erreur du fournisseur : le message est repris", () => {
  const r = parseChatResponse({ error: { message: "Provider returned error: quota" } });
  assert.equal(r.kind, "invalid");
  assert.match(r.message, /quota/);
});

// ---------------------------------------------------------------- erreurs
test("erreurs HTTP expliquées en français, avec la variable à vérifier", () => {
  assert.match(explainStatus(OR, 401, "x"), /OPENROUTER_API_KEY/);
  assert.match(explainStatus(GEN, 403, "x"), /AI_API_KEY/);
  assert.match(explainStatus(GEN, 404, "x"), /AI_MODEL_FAST/);
  assert.match(explainStatus(GEN, 402, "x"), /crédit/i);
  assert.match(explainStatus(GEN, 429, "x"), /limite/i);
  assert.match(explainStatus(GEN, 400, "mauvais champ"), /mauvais champ/);
  assert.match(explainStatus(GEN, 503, "x"), /503/);
});

test("le message de l'API est tronqué et ne contient pas la clé", () => {
  const long = "x".repeat(500);
  assert.ok(explainStatus(GEN, 400, long).length < 330);
  assert.ok(!explainStatus({ ...GEN, apiKey: "secret-123" }, 400, "bad secret-123 key").includes("secret-123"));
});

test("format de sortie non géré : on le reconnaît pour retenter en objet JSON", () => {
  assert.equal(isFormatUnsupported(400, "response_format json_schema is not supported by this model"), true);
  assert.equal(isFormatUnsupported(422, "Unsupported parameter: structured_outputs"), true);
  assert.equal(isFormatUnsupported(400, "invalid model"), false);
  assert.equal(isFormatUnsupported(401, "response_format"), false);
  assert.equal(isFormatUnsupported(500, "response_format"), false);
});
