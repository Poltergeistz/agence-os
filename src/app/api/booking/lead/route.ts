import { NextResponse, type NextRequest } from "next/server";

import { BookingError, captureLead } from "@/lib/booking/server";
import { LeadSchema } from "@/lib/booking/lead";
import { clientIp, rateLimited } from "@/lib/tracking/ingest";

/** POST /api/booking/lead : enregistre un contact saisi avant le calendrier. Réponse identique que la personne existe déjà ou non. */
export async function POST(req: NextRequest) {
  if (rateLimited(`bk-lead|${clientIp(req)}`, 30)) return NextResponse.json({ error: "Trop de tentatives, réessayez dans une minute." }, { status: 429 });
  const parsed = LeadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Formulaire incomplet ou invalide." }, { status: 400 });
  try {
    await captureLead(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[booking] lead", e);
    return NextResponse.json({ error: "L'enregistrement a échoué, merci de réessayer." }, { status: 500 });
  }
}
