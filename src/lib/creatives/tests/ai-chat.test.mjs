// Appel d'une API compatible OpenAI avec un faux fetch : sortie contrainte, repli en objet JSON, erreurs.
// Usage : node --experimental-strip-types --test src/lib/creatives/tests/ai-chat.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { AiError, chat } from "../ai-chat.ts";

const P = { kind: "openai", id: "openai", label: "api.exemple.fr", keyVar: "AI_API_KEY", baseUrl: "https://api.exemple.fr/v1", apiKey: "sk-secret" };
const ASK = { model: "m", system: "Sys", user: "Usr", schema: z.object({ a: z.string() }), schemaName: "test", maxTokens: 50 };
const ok = (content, extra = {}) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop", ...extra }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200 });
const err = (status, message) => new Response(JSON.stringify({ error: { message } }), { status });

/** Faux fetch : rejoue les réponses dans l'ordre et garde les requêtes reçues. */
function fake(...responses) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return { f, calls };
}

test("succès : JSON et consommation, schéma strict sans $schema", async () => {
  const { f, calls } = fake(ok('{"a":"x"}'));
  const r = await chat(P, ASK, f);
  assert.deepEqual(r.json, { a: "x" });
  assert.deepEqual(r.usage, { input_tokens: 3, output_tokens: 4 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.exemple.fr/v1/chat/completions");
  assert.equal(calls[0].body.response_format.type, "json_schema");
  assert.equal(calls[0].body.response_format.json_schema.schema.$schema, undefined);
  assert.equal(calls[0].body.response_format.json_schema.schema.additionalProperties, false);
});

test("format de sortie refusé : une seule nouvelle tentative en objet JSON", async () => {
  const { f, calls } = fake(err(400, "response_format json_schema is not supported"), ok('{"a":"y"}'));
  const r = await chat(P, ASK, f);
  assert.deepEqual(r.json, { a: "y" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.response_format.type, "json_object");
  assert.ok(calls[1].body.messages[0].content.includes("schéma JSON"));
});

test("le repli ne boucle pas : le second refus est expliqué", async () => {
  const { f, calls } = fake(err(400, "response_format unsupported"), err(400, "response_format unsupported"));
  await assert.rejects(chat(P, ASK, f), (e) => e instanceof AiError && /Requête refusée par api\.exemple\.fr/.test(e.message));
  assert.equal(calls.length, 2);
});

test("clé refusée : message avec la variable, sans la clé", async () => {
  const { f, calls } = fake(err(401, "Invalid key sk-secret"));
  await assert.rejects(chat(P, ASK, f), (e) => e instanceof AiError && /AI_API_KEY/.test(e.message) && !e.message.includes("sk-secret"));
  assert.equal(calls.length, 1);
});

test("erreur 500 sans corps JSON", async () => {
  const { f } = fake(new Response("Bad gateway", { status: 502 }));
  await assert.rejects(chat(P, ASK, f), (e) => e instanceof AiError && /indisponible \(502\)/.test(e.message));
});

test("réponse tronquée, réponse illisible, erreur dans un 200", async () => {
  await assert.rejects(chat(P, ASK, fake(ok('{"a":', { finish_reason: "length" })).f), /tronquée/);
  await assert.rejects(chat(P, ASK, fake(ok("pas du json")).f), /JSON lisible/);
  await assert.rejects(chat(P, ASK, fake(new Response(JSON.stringify({ error: { message: "quota" } }), { status: 200 })).f), /quota/);
});

test("le réseau qui échoue remonte tel quel (traduit plus haut)", async () => {
  const { f } = fake(new TypeError("fetch failed"));
  await assert.rejects(chat(P, ASK, f), TypeError);
});
