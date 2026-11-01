// Tests de la normalisation des numéros de téléphone (E.164).
// Lancer : node --experimental-strip-types --test src/lib/booking/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizePhone, phoneVariants } from "../phone.ts";

test("numéro français national : 0 initial retiré, indicatif ajouté", () => {
  assert.equal(normalizePhone("0612345678"), "+33612345678");
  assert.equal(normalizePhone("06 12 34 56 78"), "+33612345678");
});

test("même numéro écrit de plusieurs façons : même résultat", () => {
  const same = ["+33 6 12 34 56 78", "06.12.34.56.78", "6 12 34 56 78", "0033 6 12 34 56 78", "+33 (0)6 12 34 56 78", "06-12-34-56-78"];
  for (const v of same) assert.equal(normalizePhone(v), "+33612345678", v);
});

test("numéro étranger au format international : conservé", () => {
  assert.equal(normalizePhone("+41 79 123 45 67"), "+41791234567");
  assert.equal(normalizePhone("0041 79 123 45 67"), "+41791234567");
});

test("trop court, préfixe seul, vide : refus", () => {
  for (const v of ["+33", "", "   ", "06 12", "1234567"]) assert.equal(normalizePhone(v), null, v);
});

test("lettres et caractères parasites : refus", () => {
  for (const v of ["06 12 34 56 7a", "téléphone", "06;12;34;56;78", "+33 6 12 34 56 78 poste 4"]) assert.equal(normalizePhone(v), null, v);
});

test("numéro français trop long ou commençant par 0 après l'indicatif : refus", () => {
  assert.equal(normalizePhone("06 12 34 56 78 9"), null);
  assert.equal(normalizePhone("+33 0 12 34 56 78 9"), null);
});

test("variantes d'écriture d'un numéro français, pour retrouver un contact existant", () => {
  const v = phoneVariants("+33612345678");
  for (const w of ["+33612345678", "+33 6 12 34 56 78", "0612345678", "06 12 34 56 78", "06.12.34.56.78", "06-12-34-56-78"]) assert.ok(v.includes(w), w);
  assert.equal(new Set(v).size, v.length);
});

test("variantes : numéro étranger inchangé, entrée invalide vide", () => {
  assert.deepEqual(phoneVariants("+41791234567"), ["+41791234567"]);
  assert.deepEqual(phoneVariants("abc"), []);
});
