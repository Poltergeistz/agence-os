// Normalisation des numéros de téléphone en E.164 (France par défaut).
// Pur (aucun import) : testé avec node --experimental-strip-types --test src/lib/booking/tests/

export function normalizePhone(input: string): string | null {
  const raw = input.trim().replace(/\(0\)/g, "");
  if (!raw || !/^\+?[\d\s.\-()]+$/.test(raw)) return null;

  let digits = raw.replace(/\D/g, "");
  let international = raw.startsWith("+");
  if (!international && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  }

  if (!international) {
    if (digits.length === 10 && digits.startsWith("0")) return `+33${digits.slice(1)}`;
    if (digits.length === 9 && !digits.startsWith("0")) return `+33${digits}`;
    return null;
  }

  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  if (digits.startsWith("33")) {
    const national = digits.slice(2);
    return national.length === 9 && !national.startsWith("0") ? `+33${national}` : null;
  }
  return `+${digits}`;
}

export function phoneVariants(input: string): string[] {
  const e164 = normalizePhone(input);
  if (!e164) return [];
  if (!e164.startsWith("+33")) return [e164];
  const n = e164.slice(3);
  const pairs = n.match(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/)!.slice(1);
  const national = `0${pairs.join("")}`;
  const spaced = (sep: string) => `0${pairs[0]}${sep}${pairs.slice(1).join(sep)}`;
  return [...new Set([e164, `+33 ${pairs[0]} ${pairs.slice(1).join(" ")}`, national, spaced(" "), spaced("."), spaced("-")])];
}
