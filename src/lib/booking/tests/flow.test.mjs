// Tests de la machine d'états de la page publique de réservation.
// Lancer : node --experimental-strip-types --test src/lib/booking/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { calendarLocked, initialStep, nextStep, stepIndex } from "../flow.ts";

const LEGACY = { contactFirst: false, reschedule: false };
const FIRST = { contactFirst: true, reschedule: false };
const MOVE = { contactFirst: true, reschedule: true };

test("étape initiale selon la configuration", () => {
  assert.equal(initialStep(LEGACY), "pick");
  assert.equal(initialStep(FIRST), "info");
  assert.equal(initialStep(MOVE), "pick");
});

test("coordonnées validées : le calendrier s'ouvre", () => {
  assert.equal(nextStep("info", "INFO_SUBMITTED", FIRST), "pick");
});

test("coordonnées d'abord : choisir un créneau réserve directement", () => {
  assert.equal(nextStep("pick", "SLOT_CHOSEN", FIRST), "submitting");
});

test("sans coordonnées d'abord ou en report : choisir un créneau mène au formulaire", () => {
  assert.equal(nextStep("pick", "SLOT_CHOSEN", LEGACY), "form");
  assert.equal(nextStep("pick", "SLOT_CHOSEN", MOVE), "form");
});

test("formulaire classique : envoi et retour au calendrier", () => {
  assert.equal(nextStep("form", "SUBMIT", LEGACY), "submitting");
  assert.equal(nextStep("form", "BACK_TO_PICK", LEGACY), "pick");
});

test("résultat de la réservation", () => {
  assert.equal(nextStep("submitting", "BOOKED", FIRST), "done");
  assert.equal(nextStep("submitting", "SLOT_TAKEN", FIRST), "pick");
  assert.equal(nextStep("submitting", "SLOT_TAKEN", LEGACY), "pick");
});

test("échec : retour à l'étape d'où l'on vient, sans perdre la saisie", () => {
  assert.equal(nextStep("submitting", "FAILED", FIRST), "pick");
  assert.equal(nextStep("submitting", "FAILED", LEGACY), "form");
  assert.equal(nextStep("submitting", "FAILED", MOVE), "form");
});

test("modifier ses coordonnées depuis le calendrier", () => {
  assert.equal(nextStep("pick", "EDIT_INFO", FIRST), "info");
  assert.equal(nextStep("pick", "EDIT_INFO", LEGACY), "pick");
});

test("événement impossible depuis une étape : étape inchangée", () => {
  assert.equal(nextStep("info", "BOOKED", FIRST), "info");
  assert.equal(nextStep("info", "SLOT_CHOSEN", FIRST), "info");
  assert.equal(nextStep("done", "SLOT_CHOSEN", FIRST), "done");
  assert.equal(nextStep("pick", "SUBMIT", FIRST), "pick");
});

test("calendrier verrouillé seulement pendant la saisie des coordonnées", () => {
  assert.equal(calendarLocked("info", FIRST), true);
  assert.equal(calendarLocked("pick", FIRST), false);
  assert.equal(calendarLocked("pick", LEGACY), false);
  assert.equal(calendarLocked("pick", MOVE), false);
});

test("indicateur d'étape sur deux, absent hors coordonnées d'abord", () => {
  assert.equal(stepIndex("info", FIRST), 1);
  assert.equal(stepIndex("pick", FIRST), 2);
  assert.equal(stepIndex("submitting", FIRST), 2);
  assert.equal(stepIndex("done", FIRST), null);
  assert.equal(stepIndex("pick", LEGACY), null);
  assert.equal(stepIndex("pick", MOVE), null);
});
