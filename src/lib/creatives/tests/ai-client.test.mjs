// Client IA unique : choix du fournisseur, modèle par niveau (rapide ou avancé), erreurs en français.
// Usage : node --experimental-strip-types --test src/lib/creatives/tests/ai-client.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { AiError } from "../ai-chat.ts";
import { aiEnabled, askJson } from "../ai-client.ts";

const ASK = { tier: "fast", system: "Sys", user: "Usr", schema: z.object({ a: z.string() }), schemaName: "test", maxTokens: 50 };
const ok = (content = '{"a":"x"}') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200 });
const fake = (make) => {
  const calls = [];
  return { calls, f: async (url, init) => (calls.push({ url, body: JSON.parse(init.body) }), make()) };
};

test("activée seulement avec un fournisseur et ses deux modèles", () => {
  assert.equal(aiEnabled({}), false);
  assert.equal(aiEnabled({ ANTHROPIC_API_KEY: "a" }), true);
  assert.equal(aiEnabled({ OPENROUTER_API_KEY: "o" }), true);
  assert.equal(aiEnabled({ AI_API_KEY: "k", AI_BASE_URL: "https://x.fr/v1" }), false);
  assert.equal(aiEnabled({ AI_API_KEY: "k", AI_BASE_URL: "https://x.fr/v1", AI_MODEL_FAST: "a", AI_MODEL_SMART: "b" }), true);
  assert.equal(aiEnabled({ AI_MOCK: "1" }), true);
});

test("OpenRouter : modèle rapide ou avancé selon le niveau, consommation normalisée", async () => {
  const env = { OPENROUTER_API_KEY: "k" };
  const { f, calls } = fake(() => ok());
  const fast = await askJson({ ...ASK, tier: "fast" }, env, f);
  const smart = await askJson({ ...ASK, tier: "smart" }, env, f);
  assert.deepEqual(fast.json, { a: "x" });
  assert.deepEqual(fast.usage, { input_tokens: 3, output_tokens: 4, cache_read: 0 });
  assert.equal(calls[0].body.model, "anthropic/claude-haiku-4.5");
  assert.equal(calls[1].body.model, "anthropic/claude-sonnet-4.5");
  assert.equal(fast.model, "anthropic/claude-haiku-4.5");
  assert.equal(smart.model, "anthropic/claude-sonnet-4.5");
});

test("le coût réel du fournisseur est conservé dans la consommation", async () => {
  const withCost = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"a":"x"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 6, cost: 0.0123 } }), { status: 200 });
  const r = await askJson(ASK, { OPENROUTER_API_KEY: "k" }, fake(withCost).f);
  assert.deepEqual(r.usage, { input_tokens: 5, output_tokens: 6, cost: 0.0123, cache_read: 0 });
});

test("modèle surchargé par variable", async () => {
  const { f, calls } = fake(() => ok());
  await askJson(ASK, { OPENROUTER_API_KEY: "k", AI_MODEL_FAST: "google/gemini-2.5-flash" }, f);
  assert.equal(calls[0].body.model, "google/gemini-2.5-flash");
});

test("API libre sans modèles : message explicite, aucun appel réseau", async () => {
  const { f, calls } = fake(() => ok());
  await assert.rejects(askJson(ASK, { AI_API_KEY: "k", AI_BASE_URL: "https://x.fr/v1" }, f), (e) => e instanceof AiError && /AI_MODEL_FAST/.test(e.message));
  assert.equal(calls.length, 0);
});

test("aucun fournisseur : message explicite", async () => {
  await assert.rejects(askJson(ASK, {}, fake(() => ok()).f), (e) => e instanceof AiError && /pas configurée/.test(e.message));
});

test("erreurs du fournisseur et du réseau en français, sans la clé", async () => {
  const env = { OPENROUTER_API_KEY: "sk-secret" };
  const refused = fake(() => new Response(JSON.stringify({ error: { message: "bad sk-secret" } }), { status: 401 }));
  await assert.rejects(askJson(ASK, env, refused.f), (e) => e instanceof AiError && /OPENROUTER_API_KEY/.test(e.message) && !e.message.includes("sk-secret"));
  const down = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(askJson(ASK, env, down), (e) => e instanceof AiError && /Impossible de joindre OpenRouter/.test(e.message));
});
