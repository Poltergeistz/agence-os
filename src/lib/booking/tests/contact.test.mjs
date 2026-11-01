// Tests du moyen de contact demandé (email, téléphone ou les deux).
// Lancer : node --experimental-strip-types --test src/lib/booking/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { canEmail, contactKey, fieldsFor, validateContact } from "../contact.ts";

const ok = { name: "Ada Lovelace", email: "ada@example.com", phone: "06 12 34 56 78" };
const run = (mode, o = {}) => validateContact({ mode, ...ok, ...o });

test("mode email : email exigé, téléphone facultatif", () => {
  assert.equal(run("email", { phone: "" }).ok, true);
  assert.deepEqual(run("email", { email: "" }), { ok: false, field: "email", error: "Adresse email invalide" });
});

test("mode email : un téléphone fourni mais invalide est refusé", () => {
  assert.deepEqual(run("email", { phone: "abc" }), { ok: false, field: "phone", error: "Numéro de téléphone invalide" });
});

test("mode téléphone : téléphone exigé, email facultatif", () => {
  const r = run("phone", { email: "" });
  assert.equal(r.ok, true);
  assert.equal(r.value.phone, "+33612345678");
  assert.equal(r.value.email, "");
  assert.deepEqual(run("phone", { phone: "" }), { ok: false, field: "phone", error: "Numéro de téléphone invalide" });
});

test("mode téléphone : un email fourni mais invalide est refusé", () => {
  assert.deepEqual(run("phone", { email: "pas-un-email" }), { ok: false, field: "email", error: "Adresse email invalide" });
});

test("mode les deux : tout est exigé", () => {
  assert.equal(run("both").ok, true);
  assert.equal(run("both", { phone: "" }).ok, false);
  assert.equal(run("both", { email: "" }).ok, false);
});

test("nom trop court refusé dans tous les modes", () => {
  for (const m of ["email", "phone", "both"]) assert.deepEqual(run(m, { name: "A" }), { ok: false, field: "name", error: "Merci d'indiquer votre nom" });
});

test("aucun moyen de contact : refus dans tous les modes", () => {
  for (const m of ["email", "phone", "both"]) assert.equal(run(m, { email: "", phone: "" }).ok, false, m);
});

test("valeur normalisée : email en minuscules sans espaces, nom nettoyé", () => {
  const r = run("both", { email: "  Ada@Example.COM ", name: "  Ada Lovelace " });
  assert.equal(r.value.email, "ada@example.com");
  assert.equal(r.value.name, "Ada Lovelace");
});

test("clé d'identité : email d'abord, sinon téléphone normalisé, sinon rien", () => {
  assert.equal(contactKey({ email: " Ada@Example.com ", phone: "0612345678" }), "ada@example.com");
  assert.equal(contactKey({ email: "", phone: "06 12 34 56 78" }), "+33612345678");
  assert.equal(contactKey({ email: "", phone: "" }), null);
  assert.equal(contactKey({ email: "", phone: "abc" }), null);
});

test("envoi d'emails seulement si l'adresse existe", () => {
  assert.equal(canEmail({ email: "ada@example.com" }), true);
  assert.equal(canEmail({ email: "" }), false);
  assert.equal(canEmail({ email: "   " }), false);
});

test("champs rendus : ordre et caractère obligatoire par mode", () => {
  assert.deepEqual(fieldsFor("email"), [
    { key: "name", required: true },
    { key: "email", required: true },
    { key: "phone", required: false },
  ]);
  assert.deepEqual(fieldsFor("phone"), [
    { key: "phone", required: true },
    { key: "name", required: true },
    { key: "email", required: false },
  ]);
  assert.deepEqual(fieldsFor("both"), [
    { key: "phone", required: true },
    { key: "name", required: true },
    { key: "email", required: true },
  ]);
});
