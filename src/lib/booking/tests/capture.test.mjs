// Tests du déclenchement de la capture de lead à la saisie.
// Lancer : node --experimental-strip-types --test src/lib/booking/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldCapture } from "../capture.ts";

const vals = (o = {}) => ({ name: "", email: "", phone: "", ...o });
const run = (o) => shouldCapture({ mode: "email", values: vals(), lastSent: null, final: false, ...o });

test("contact invalide : pas d'envoi", () => {
  assert.equal(run({ values: vals({ email: "ada@" }) }).send, false);
  assert.equal(run({ mode: "phone", values: vals({ phone: "06 12" }) }).send, false);
  assert.equal(run({ values: vals() }).send, false);
});

test("contact valide à la sortie du champ : envoi, nom facultatif", () => {
  assert.equal(run({ values: vals({ email: "ada@example.com" }) }).send, true);
  assert.equal(run({ mode: "phone", values: vals({ phone: "0612345678" }) }).send, true);
});

test("mode les deux : un seul des deux contacts valides suffit pour un lead partiel", () => {
  assert.equal(run({ mode: "both", values: vals({ phone: "0612345678" }) }).send, true);
  assert.equal(run({ mode: "both", values: vals({ email: "ada@example.com" }) }).send, true);
  assert.equal(run({ mode: "both", values: vals({ email: "ada@", phone: "06" }) }).send, false);
});

test("mode email : un téléphone seul ne déclenche rien", () => {
  assert.equal(run({ values: vals({ phone: "0612345678" }) }).send, false);
});

test("même contenu déjà envoyé : pas de second envoi", () => {
  const first = run({ values: vals({ email: "ada@example.com" }) });
  assert.equal(run({ values: vals({ email: "ada@example.com" }), lastSent: first.fingerprint }).send, false);
});

test("espaces et casse sans effet sur l'empreinte", () => {
  const a = run({ values: vals({ email: "ada@example.com" }) });
  const b = run({ values: vals({ email: "  ADA@example.com " }), lastSent: a.fingerprint });
  assert.equal(b.send, false);
});

test("contenu modifié depuis le dernier envoi : nouvel envoi", () => {
  const first = run({ values: vals({ email: "ada@example.com" }) });
  assert.equal(run({ values: vals({ email: "ada@example.com", name: "Ada Lovelace" }), lastSent: first.fingerprint }).send, true);
});

test("clic sur Continuer : envoi final même sans changement", () => {
  const first = run({ values: vals({ email: "ada@example.com" }) });
  const r = run({ values: vals({ email: "ada@example.com" }), lastSent: first.fingerprint, final: true });
  assert.equal(r.send, true);
  assert.equal(r.origin, "submitted");
});

test("origine : saisie pour un envoi automatique, validé pour l'envoi final", () => {
  assert.equal(run({ values: vals({ email: "ada@example.com" }) }).origin, "typing");
});
