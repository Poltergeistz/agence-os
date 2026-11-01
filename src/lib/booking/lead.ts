// Capture d'un lead : formulaire rempli avant le calendrier, sans rendez-vous encore.
// Pur (zod seulement) : testé avec node --experimental-strip-types --test src/lib/booking/tests/

import { z } from "zod";

import type { Question } from "./shared";

export const LeadSchema = z.object({
  profile: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
  type: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
  name: z.string().trim().min(2, "Merci d'indiquer votre nom").max(120).optional(),
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email("Adresse email invalide").max(254)).optional(),
  phone: z.string().trim().max(40).optional(),
  origin: z.enum(["typing", "submitted"]).default("submitted"),
  answers: z.record(z.string().max(40), z.string().max(3000)).default({}),
  utm: z.record(z.string().max(40), z.string().max(300)).default({}),
  website_url: z.string().max(0).optional(),
}).refine((v) => !!v.email || !!v.phone, { message: "Merci d'indiquer un moyen de contact", path: ["email"] });
export type LeadInput = z.infer<typeof LeadSchema>;

export interface Stage {
  id: string;
  name: string;
  kind: string;
  position: number;
}

export interface LeadPlan {
  deal: { stageId: string | null; title: string; source: string } | null;
  note: string | null;
  notify: boolean;
}

const firstOpen = (stages: Stage[]) => stages.filter((s) => s.kind === "open").sort((a, b) => a.position - b.position)[0] ?? null;
const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const leadStage = (stages: Stage[]) => stages.find((s) => s.kind === "open" && /non\s*book/.test(plain(s.name))) ?? firstOpen(stages);

export function planLead(i: {
  typeName: string;
  name: string;
  email: string;
  phone: string;
  origin: "typing" | "submitted";
  company: string;
  utm: Record<string, string>;
  answers: Record<string, string>;
  questions: Question[];
  stages: Stage[];
  openDeal: { id: string } | null;
  lastNote: string | null;
}): LeadPlan {
  const lines = i.questions.filter((q) => i.answers[q.key] && q.key !== "phone" && q.key !== "company").map((q) => `${q.label} : ${i.answers[q.key]}`);
  const headline = i.origin === "typing" ? "Coordonnées saisies, formulaire non validé." : "Formulaire rempli, pas encore de rendez-vous.";
  const note = [headline, ...lines].join("\n");
  const noteToAdd = i.openDeal && note === i.lastNote ? null : note;

  if (i.openDeal) return { deal: null, note: noteToAdd, notify: false };

  const source = i.utm.utm_source ? [i.utm.utm_source, i.utm.utm_campaign].filter(Boolean).join(" / ").slice(0, 120) : "Formulaire de réservation";
  const title = `${i.typeName} · ${i.company || i.name || i.email || i.phone}`.slice(0, 200);
  return { deal: { stageId: leadStage(i.stages)?.id ?? null, title, source }, note: noteToAdd, notify: true };
}

export function advanceStage(i: { current: string | null; entry: string | null; stages: Stage[] }): string | null {
  const at = (id: string | null) => i.stages.find((s) => s.id === id);
  const current = at(i.current);
  const entry = at(i.entry);
  return current && entry && current.kind === "open" && current.position < entry.position ? entry.id : null;
}
