// Quand envoyer un lead partiel pendant la saisie du formulaire.
// Pur : testé avec node --experimental-strip-types --test src/lib/booking/tests/

import { isEmail, type ContactMode } from "./contact.ts";
import { normalizePhone } from "./phone.ts";

export type CaptureOrigin = "typing" | "submitted";

export function shouldCapture(i: {
  mode: ContactMode;
  values: { name: string; email: string; phone: string };
  lastSent: string | null;
  final: boolean;
}): { send: boolean; fingerprint: string; origin: CaptureOrigin } {
  const email = i.values.email.trim().toLowerCase();
  const emailOk = isEmail(email);
  const phone = normalizePhone(i.values.phone);
  const valid = i.mode === "email" ? emailOk : i.mode === "phone" ? !!phone : emailOk || !!phone;

  const fingerprint = JSON.stringify([i.values.name.trim(), emailOk ? email : "", phone ?? ""]);
  return { send: valid && (i.final || fingerprint !== i.lastSent), fingerprint, origin: i.final ? "submitted" : "typing" };
}
