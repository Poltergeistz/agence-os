// Tests de la capture de lead (formulaire rempli avant le calendrier).
// Lancer : node --experimental-strip-types --test src/lib/booking/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { LeadSchema, advanceStage, leadStage, planLead } from "../lead.ts";

const STAGES = [
  { id: "s1", name: "Nouveau lead", kind: "open", position: 1 },
  { id: "s2", name: "Appel découverte", kind: "open", position: 2 },
  { id: "s3", name: "Proposition envoyée", kind: "open", position: 3 },
  { id: "s4", name: "Gagné", kind: "won", position: 4 },
];
const QUESTIONS = [
  { key: "phone", label: "Téléphone", type: "phone", required: false },
  { key: "company", label: "Entreprise", type: "text", required: false },
  { key: "budget", label: "Budget", type: "select", required: false, options: ["A", "B"] },
];
const base = (o = {}) => ({ typeName: "Appel découverte", name: "Ada Lovelace", email: "ada@example.com", phone: "", origin: "submitted", company: "", utm: {}, answers: { budget: "B" }, questions: QUESTIONS, stages: STAGES, openDeal: null, lastNote: null, ...o });

const valid = { profile: "david-journo", type: "appel-decouverte", name: "Ada Lovelace", email: "ada@example.com" };

test("schéma : nom trop court, email invalide, robot", () => {
  assert.equal(LeadSchema.safeParse({ ...valid, name: "A" }).success, false);
  assert.equal(LeadSchema.safeParse({ ...valid, email: "pas-un-email" }).success, false);
  assert.equal(LeadSchema.safeParse({ ...valid, website_url: "http://spam" }).success, false);
});

test("schéma : lead partiel sans nom accepté, nom d'un caractère refusé", () => {
  assert.equal(LeadSchema.safeParse({ profile: "david-journo", type: "appel-decouverte", email: "ada@example.com" }).success, true);
  assert.equal(LeadSchema.safeParse({ profile: "david-journo", type: "appel-decouverte", phone: "0612345678" }).success, true);
  assert.equal(LeadSchema.safeParse({ ...valid, name: "A" }).success, false);
});

test("schéma : aucun contact, refus ; origine par défaut « validé »", () => {
  assert.equal(LeadSchema.safeParse({ profile: "david-journo", type: "appel-decouverte", name: "Ada Lovelace" }).success, false);
  assert.equal(LeadSchema.safeParse(valid).data.origin, "submitted");
  assert.equal(LeadSchema.safeParse({ ...valid, origin: "typing" }).data.origin, "typing");
  assert.equal(LeadSchema.safeParse({ ...valid, origin: "autre" }).success, false);
});

test("schéma : email normalisé, aucun créneau requis, valeurs par défaut", () => {
  const r = LeadSchema.safeParse({ ...valid, email: "  Ada@Example.COM " });
  assert.equal(r.success, true);
  assert.equal(r.data.email, "ada@example.com");
  assert.deepEqual(r.data.answers, {});
  assert.deepEqual(r.data.utm, {});
});

test("sans deal ouvert : deal à la première étape ouverte, jamais « découverte »", () => {
  const p = planLead(base());
  assert.equal(p.deal.stageId, "s1");
  assert.equal(p.notify, true);
  assert.ok(p.note.startsWith("Formulaire rempli, pas encore de rendez-vous."));
  assert.ok(p.note.includes("Budget : B"));
});

test("deal ouvert existant : pas de nouveau deal ni de notification", () => {
  const p = planLead(base({ openDeal: { id: "d1" } }));
  assert.equal(p.deal, null);
  assert.equal(p.notify, false);
  assert.ok(p.note);
});

test("réponses identiques à la dernière note : rien n'est ajouté", () => {
  const first = planLead(base({ openDeal: { id: "d1" } }));
  const again = planLead(base({ openDeal: { id: "d1" }, lastNote: first.note }));
  assert.deepEqual(again, { deal: null, note: null, notify: false });
});

test("réponses différentes : nouvelle note sans nouveau deal", () => {
  const first = planLead(base({ openDeal: { id: "d1" } }));
  const p = planLead(base({ openDeal: { id: "d1" }, lastNote: first.note, answers: { budget: "A" } }));
  assert.equal(p.deal, null);
  assert.ok(p.note.includes("Budget : A"));
});

test("source du deal : UTM si présent, sinon formulaire", () => {
  assert.equal(planLead(base()).deal.source, "Formulaire de réservation");
  assert.equal(planLead(base({ utm: { utm_source: "meta", utm_campaign: "oct" } })).deal.source, "meta / oct");
});

test("titre du deal : type, entreprise ou nom, tronqué à 200", () => {
  assert.equal(planLead(base()).deal.title, "Appel découverte · Ada Lovelace");
  assert.equal(planLead(base({ company: "Analytical Engines" })).deal.title, "Appel découverte · Analytical Engines");
  assert.equal(planLead(base({ company: "x".repeat(300) })).deal.title.length, 200);
});

test("origine saisie : la note le dit, puis la validation ajoute une nouvelle note", () => {
  const typed = planLead(base({ origin: "typing", openDeal: { id: "d1" } }));
  assert.ok(typed.note.startsWith("Coordonnées saisies, formulaire non validé."));
  const sent = planLead(base({ origin: "submitted", openDeal: { id: "d1" }, lastNote: typed.note }));
  assert.ok(sent.note.startsWith("Formulaire rempli, pas encore de rendez-vous."));
});

test("lead sans nom : deal titré avec l'email, sinon le téléphone", () => {
  assert.equal(planLead(base({ name: "", email: "ada@example.com" })).deal.title, "Appel découverte · ada@example.com");
  assert.equal(planLead(base({ name: "", email: "", phone: "+33612345678" })).deal.title, "Appel découverte · +33612345678");
});

test("téléphone et entreprise absents du détail de la note", () => {
  const p = planLead(base({ answers: { phone: "0612345678", company: "Acme", budget: "B" } }));
  assert.ok(!p.note.includes("Téléphone"));
  assert.ok(!p.note.includes("Entreprise"));
});

test("aucune étape ouverte : deal sans étape, sans erreur", () => {
  const p = planLead(base({ stages: [STAGES[3]] }));
  assert.equal(p.deal.stageId, null);
});

test("avancement : un deal à « Nouveau lead » avance à l'étape d'entrée", () => {
  assert.equal(advanceStage({ current: "s1", entry: "s2", stages: STAGES }), "s2");
});

test("avancement : jamais de recul, ni sur place, ni depuis une étape fermée", () => {
  assert.equal(advanceStage({ current: "s3", entry: "s2", stages: STAGES }), null);
  assert.equal(advanceStage({ current: "s2", entry: "s2", stages: STAGES }), null);
  assert.equal(advanceStage({ current: "s4", entry: "s2", stages: STAGES }), null);
  assert.equal(advanceStage({ current: "s1", entry: null, stages: STAGES }), null);
});

test("étape « Lead non booké » préférée à la première étape ouverte, sans tenir compte des accents ni de la casse", () => {
  const stages = [STAGES[0], { id: "s0", name: "Lead NON booké", kind: "open", position: 0 }, STAGES[1]];
  assert.equal(leadStage(stages).id, "s0");
  assert.equal(leadStage([STAGES[1], { id: "x", name: "lead non booke", kind: "open", position: 5 }]).id, "x");
});

test("sans étape dédiée : première étape ouverte, sinon rien", () => {
  assert.equal(leadStage(STAGES).id, "s1");
  assert.equal(leadStage([STAGES[3]]), null);
});

test("l'étape dédiée est utilisée par le plan du lead", () => {
  const stages = [{ id: "s0", name: "Lead non booké", kind: "open", position: 9 }, ...STAGES];
  assert.equal(planLead(base({ stages })).deal.stageId, "s0");
});
