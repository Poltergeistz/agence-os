// Appel d'une API compatible OpenAI : sortie contrainte par le schéma, sinon repli en objet JSON.
// Sans dépendance serveur (seul zod est importé) : testé avec node --experimental-strip-types --test src/lib/creatives/tests/

import { z } from "zod";

import { buildChatRequest, explainStatus, isFormatUnsupported, parseChatResponse, type ChatAsk, type OpenAiProvider } from "./ai-provider.ts";

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

export async function chat(p: OpenAiProvider, a: Omit<ChatAsk, "mode" | "schema"> & { schema: z.ZodType }, fetchImpl: typeof fetch = fetch) {
  const schema = z.toJSONSchema(a.schema) as Record<string, unknown>;
  delete schema.$schema;
  for (const mode of ["json_schema", "json_object"] as const) {
    const req = buildChatRequest(p, { ...a, schema, mode });
    const res = await fetchImpl(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* corps non JSON */
    }
    if (!res.ok) {
      const message = (body as { error?: { message?: string } } | null)?.error?.message ?? text;
      if (mode === "json_schema" && isFormatUnsupported(res.status, message)) continue;
      throw new AiError(explainStatus(p, res.status, message));
    }
    const parsed = parseChatResponse(body);
    if (!parsed.ok) throw new AiError(parsed.message);
    return parsed;
  }
  throw new AiError(`${p.label} n'a pas accepté le format de réponse demandé.`);
}
