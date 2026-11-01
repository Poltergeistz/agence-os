// Moyen de contact demandé par un type de rendez-vous : email, téléphone, ou les deux.
// Pur : testé avec node --experimental-strip-types --test src/lib/booking/tests/

import { normalizePhone } from "./phone.ts";

export type ContactMode = "email" | "phone" | "both";
export type ContactField = "name" | "email" | "phone";

export const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);

export function fieldsFor(mode: ContactMode): { key: ContactField; required: boolean }[] {
  const phoneRequired = mode !== "email";
  const emailRequired = mode !== "phone";
  const phone = { key: "phone" as const, required: phoneRequired };
  const name = { key: "name" as const, required: true };
  const email = { key: "email" as const, required: emailRequired };
  return phoneRequired ? [phone, name, email] : [name, email, phone];
}

export type ContactResult =
  | { ok: true; value: { name: string; email: string; phone: string } }
  | { ok: false; field: ContactField; error: string };

const fail = (field: ContactField, error: string): ContactResult => ({ ok: false, field, error });

export function validateContact(i: { mode: ContactMode; name: string; email: string; phone: string }): ContactResult {
  const name = i.name.trim();
  const email = i.email.trim().toLowerCase();
  const phone = i.phone.trim() ? normalizePhone(i.phone) : "";
  if (name.length < 2) return fail("name", "Merci d'indiquer votre nom");

  for (const f of fieldsFor(i.mode)) {
    if (f.key === "email" && (email ? !isEmail(email) : f.required)) return fail("email", "Adresse email invalide");
    if (f.key === "phone" && (phone === null || (!phone && f.required))) return fail("phone", "Numéro de téléphone invalide");
  }
  return { ok: true, value: { name, email, phone: phone ?? "" } };
}

export function contactKey(i: { email: string; phone: string }): string | null {
  const email = i.email.trim().toLowerCase();
  return email || normalizePhone(i.phone);
}

export const canEmail = (i: { email: string }) => i.email.trim() !== "";
