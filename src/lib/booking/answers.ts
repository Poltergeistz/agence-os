// Validation des réponses du formulaire de réservation, partagée par la réservation et la capture de lead.
// Pur (aucun import à l'exécution) : testé avec node --experimental-strip-types --test src/lib/booking/tests/

import type { Question } from "./shared";

export type AnswersResult = { ok: true; answers: Record<string, string> } | { ok: false; error: string };

export function validateAnswers(input: { questions: Question[]; locationKind: string; answers: Record<string, string>; partial?: boolean }): AnswersResult {
  const { questions, locationKind, answers: given, partial } = input;
  const phoneRequired = !partial && locationKind === "phone";
  const answers: Record<string, string> = {};

  for (const q of questions) {
    const v = (given[q.key] ?? "").trim();
    const required = !partial && (q.required || (q.key === "phone" && phoneRequired));
    if (required && !v) return { ok: false, error: `Le champ « ${q.label} » est obligatoire.` };
    if (v && q.type === "select" && q.options?.length && !q.options.includes(v)) return { ok: false, error: `Valeur invalide pour « ${q.label} ».` };
    if (v) answers[q.key] = v.slice(0, q.type === "textarea" ? 3000 : 300);
  }

  if (phoneRequired && !questions.some((q) => q.key === "phone")) {
    const v = (given.phone ?? "").trim();
    if (!v) return { ok: false, error: "Merci d'indiquer votre numéro de téléphone." };
    answers.phone = v.slice(0, 40);
  }

  return { ok: true, answers };
}
