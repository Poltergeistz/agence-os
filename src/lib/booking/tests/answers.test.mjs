// Tests de la validation des réponses du formulaire de réservation.
// Lancer : node --experimental-strip-types --test src/lib/booking/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateAnswers } from "../answers.ts";

const q = (key, o = {}) => ({ key, label: key.toUpperCase(), type: "text", required: false, ...o });
const run = (questions, answers, locationKind = "google_meet") => validateAnswers({ questions, locationKind, answers });

test("question obligatoire vide : refus avec le libellé", () => {
  assert.deepEqual(run([q("company", { required: true })], {}), { ok: false, error: "Le champ « COMPANY » est obligatoire." });
  assert.deepEqual(run([q("company", { required: true })], { company: "   " }), { ok: false, error: "Le champ « COMPANY » est obligatoire." });
});

test("liste de choix : valeur hors options refusée, valeur valide conservée", () => {
  const budget = q("budget", { type: "select", options: ["A", "B"] });
  assert.deepEqual(run([budget], { budget: "C" }), { ok: false, error: "Valeur invalide pour « BUDGET »." });
  assert.deepEqual(run([budget], { budget: "B" }), { ok: true, answers: { budget: "B" } });
});

test("troncature : 300 caractères en texte court, 3000 en texte long", () => {
  const r = run([q("a"), q("b", { type: "textarea" })], { a: "x".repeat(400), b: "y".repeat(3500) });
  assert.equal(r.ok, true);
  assert.equal(r.answers.a.length, 300);
  assert.equal(r.answers.b.length, 3000);
});

test("espaces autour des valeurs retirés, valeurs vides absentes", () => {
  assert.deepEqual(run([q("a"), q("b")], { a: "  salut  ", b: "  " }), { ok: true, answers: { a: "salut" } });
});

test("clé inconnue ignorée", () => {
  assert.deepEqual(run([q("a")], { a: "1", intrus: "2" }), { ok: true, answers: { a: "1" } });
});

test("lieu téléphone sans question téléphone : numéro exigé, ajouté et tronqué à 40", () => {
  assert.deepEqual(run([], {}, "phone"), { ok: false, error: "Merci d'indiquer votre numéro de téléphone." });
  const r = run([], { phone: "0".repeat(60) }, "phone");
  assert.equal(r.ok, true);
  assert.equal(r.answers.phone.length, 40);
});

test("lieu téléphone avec question téléphone facultative : devient obligatoire", () => {
  const phone = q("phone", { type: "phone", label: "Téléphone" });
  assert.deepEqual(run([phone], {}, "phone"), { ok: false, error: "Le champ « Téléphone » est obligatoire." });
  assert.deepEqual(run([phone], { phone: "0612345678" }, "phone"), { ok: true, answers: { phone: "0612345678" } });
});

test("hors lieu téléphone, le téléphone reste facultatif", () => {
  assert.deepEqual(run([q("phone", { type: "phone" })], {}), { ok: true, answers: {} });
});

test("lead partiel : les questions obligatoires ne bloquent pas, les valeurs invalides oui", () => {
  const budget = q("budget", { type: "select", options: ["A", "B"], required: true });
  assert.deepEqual(validateAnswers({ questions: [budget, q("company", { required: true })], locationKind: "phone", answers: {}, partial: true }), { ok: true, answers: {} });
  assert.deepEqual(validateAnswers({ questions: [budget], locationKind: "google_meet", answers: { budget: "C" }, partial: true }), { ok: false, error: "Valeur invalide pour « BUDGET »." });
});
