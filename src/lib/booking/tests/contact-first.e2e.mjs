// Test de bout en bout du formulaire « coordonnées d'abord » : navigateur réel, serveur de dev, base de dev.
// Prérequis : `npm run dev` (E2E_URL, http://localhost:3000 par défaut), .env.local rempli (base de DEV, jamais la production).
// Usage : node src/lib/booking/tests/contact-first.e2e.mjs   (E2E_CHANNEL=chrome pour utiliser Chrome installé)
// Le script crée son propre espace, son compte et ses types de rendez-vous, puis les supprime.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync(new URL("../../../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const BASE = process.env.E2E_URL || "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const check = (cond, label, extra) => {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  ÉCHEC ${label}${extra !== undefined ? `\n       ${String(typeof extra === "object" ? JSON.stringify(extra) : extra).slice(0, 400)}` : ""}`);
  }
};
const section = (t) => console.log(`\n${t}`);

const RUN = Date.now().toString(36);
const mail = (n) => `e2e+${RUN}-${n}@example.com`;
let ws;
let userId;
let slug;
let stages;

async function seed() {
  const email = `e2e-owner-${RUN}@example.com`;
  const password = `Pw-${RUN}-e2e!`;
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Ada E2E" } });
  if (error) throw error;
  userId = u.user.id;
  const sb = anon();
  const { error: se } = await sb.auth.signInWithPassword({ email, password });
  if (se) throw se;
  const { data: id, error: we } = await sb.rpc("create_workspace", { p_name: `E2E ${RUN}`, p_slug: `e2e-${RUN}` });
  if (we) throw we;
  ws = id;
  const { data: pid, error: pe } = await admin.rpc("booking_ensure_profile", { ws, uid: userId });
  if (pe) throw pe;
  const { data: prof } = await admin.from("booking_profiles").select("slug").eq("id", pid).single();
  slug = prof.slug;
  const types = [
    { slug: "classique", name: "Classique", contact_first: false, contact_mode: "email", position: 1 },
    { slug: "avant", name: "Avant", contact_first: true, contact_mode: "email", position: 2 },
    { slug: "tel", name: "Tel", contact_first: true, contact_mode: "phone", position: 3 },
    { slug: "deux", name: "Deux", contact_first: true, contact_mode: "both", position: 4 },
  ];
  const { error: te } = await admin.from("booking_types").insert(types.map((t) => ({ ...t, workspace_id: ws, profile_id: pid })));
  if (te) throw te;
  // Étape dédiée aux leads non bookés, en première colonne
  const { data: st } = await admin.from("pipeline_stages").select("id, name, kind, position").eq("workspace_id", ws).order("position");
  const first = st[0].position;
  const { error: ge } = await admin.from("pipeline_stages").insert({ workspace_id: ws, name: "Lead non booké", kind: "open", position: first - 1, probability: 5 });
  if (ge) throw ge;
  stages = (await admin.from("pipeline_stages").select("id, name, kind, position").eq("workspace_id", ws).order("position")).data;
}

async function cleanup() {
  if (ws) await admin.from("workspaces").delete().eq("id", ws);
  if (userId) await admin.auth.admin.deleteUser(userId);
}

const stageName = (id) => stages.find((s) => s.id === id)?.name;
const contactsOf = async (q) => (await admin.from("contacts").select("*").eq("workspace_id", ws).or(q)).data ?? [];
const dealsOf = async (contactId) => (await admin.from("deals").select("*").eq("workspace_id", ws).eq("contact_id", contactId)).data ?? [];
const notesOf = async (dealId) => ((await admin.from("crm_activities").select("body, kind").eq("deal_id", dealId).eq("kind", "note").order("created_at")).data ?? []).map((n) => n.body);

const url = (t) => `${BASE}/b/${slug}/${t}`;
async function pickFirstSlot(page) {
  await page.waitForSelector(".bk-day.av", { timeout: 15000 });
  await page.locator(".bk-day.av").first().click();
  await page.locator(".bk-slot").first().click();
}

async function run() {
  const browser = await chromium.launch(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---------------------------------------------------------------
  section("1. Type classique : comportement inchangé");
  await page.goto(url("classique"));
  await page.waitForSelector(".bk-day.av", { timeout: 20000 });
  check((await page.locator("#bk-name").count()) === 0, "calendrier d'abord, pas de formulaire sur la page");
  check((await page.locator(".bk-step").count()) === 0, "aucun indicateur d'étape");
  await pickFirstSlot(page);
  await page.waitForSelector("#bk-name");
  await page.fill("#bk-name", "Alice Classique");
  await page.fill("#bk-email", mail("classique"));
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Rendez-vous confirmé", { timeout: 20000 });
  const cl = await contactsOf(`email.eq.${mail("classique")}`);
  check(cl.length === 1, "un contact créé", cl.length);
  const cd = cl[0] ? await dealsOf(cl[0].id) : [];
  check(cd.length === 1 && stageName(cd[0].stage_id) !== "Lead non booké", "deal créé hors de l'étape des leads non bookés", cd.map((d) => stageName(d.stage_id)));
  const bk = (await admin.from("bookings").select("email, status").eq("workspace_id", ws).eq("email", mail("classique"))).data ?? [];
  check(bk.length === 1 && bk[0].status === "confirmed", "rendez-vous confirmé en base");

  // ---------------------------------------------------------------
  section("2. Coordonnées d'abord (email) : verrouillage, capture, réservation");
  await page.goto(url("avant"));
  await page.waitForSelector("#bk-name");
  check((await page.locator(".bk-card.locked").count()) === 1, "calendrier verrouillé au départ");
  check((await page.locator(".bk-step").innerText()).includes("Étape 1/2"), "indicateur « Étape 1/2 »");
  check((await page.locator(".bk-cal").getAttribute("inert")) !== null, "calendrier inerte (clavier et lecteurs d'écran)");
  check(await page.locator(".bk-lock").isVisible(), "message « remplir le formulaire avant » visible");

  await page.click("button:has-text('Continuer')");
  check((await page.locator(".bk-ferr").count()) >= 1, "Continuer à vide : erreur affichée sous un champ");
  check((await page.locator(".bk-card.locked").count()) === 1, "calendrier toujours verrouillé");
  check((await admin.from("contacts").select("id").eq("workspace_id", ws).ilike("email", `%${RUN}-avant%`)).data?.length === 0, "aucun lead enregistré à vide");

  await page.fill("#bk-email", mail("avant"));
  const leadReq = page.waitForResponse((r) => r.url().includes("/api/booking/lead") && r.request().method() === "POST", { timeout: 15000 });
  await page.locator("#bk-name").focus();
  const leadRes = await leadReq;
  check(leadRes.status() === 200, "sortie du champ email : lead envoyé (200)", leadRes.status());
  const c2 = await contactsOf(`email.eq.${mail("avant")}`);
  check(c2.length === 1, "contact enregistré sans cliquer sur Continuer", c2.length);
  const d2 = c2[0] ? await dealsOf(c2[0].id) : [];
  check(d2.length === 1 && stageName(d2[0].stage_id) === "Lead non booké", "deal à l'étape « Lead non booké »", d2.map((d) => stageName(d.stage_id)));
  const n2 = d2[0] ? await notesOf(d2[0].id) : [];
  check(n2.length === 1 && n2[0].startsWith("Coordonnées saisies"), "note « Coordonnées saisies »", n2);

  await page.fill("#bk-name", "Bob Avant");
  await page.click("button:has-text('Continuer')");
  await page.waitForSelector(".bk-card:not(.locked) .bk-day.av", { timeout: 15000 });
  check((await page.locator(".bk-card.locked").count()) === 0, "calendrier déverrouillé après Continuer");
  check((await page.locator(".bk-step").innerText()).includes("Étape 2/2"), "indicateur « Étape 2/2 »");
  check((await page.locator(".bk-cal").getAttribute("inert")) === null, "calendrier actif");
  const d2b = c2[0] ? await dealsOf(c2[0].id) : [];
  check(d2b.length === 1, "toujours un seul deal (idempotent)", d2b.length);
  const n2b = d2b[0] ? await notesOf(d2b[0].id) : [];
  check(n2b.length === 2 && n2b[1].startsWith("Formulaire rempli"), "note « Formulaire rempli » ajoutée", n2b);

  await page.locator(".bk-day.av").first().click();
  await page.locator(".bk-slot").first().click();
  check((await page.locator(".bk-confirm button").innerText()).startsWith("Confirmer"), "un tap sur un horaire propose « Confirmer »");
  check((await admin.from("bookings").select("id").eq("workspace_id", ws).eq("email", mail("avant"))).data?.length === 0, "pas encore de réservation avant confirmation");
  await page.locator(".bk-confirm button").click();
  await page.waitForSelector("text=Rendez-vous confirmé", { timeout: 20000 });
  const c2c = await contactsOf(`email.eq.${mail("avant")}`);
  check(c2c.length === 1, "toujours un seul contact après réservation", c2c.length);
  const d2c = c2c[0] ? await dealsOf(c2c[0].id) : [];
  check(d2c.length === 1 && stageName(d2c[0].stage_id) !== "Lead non booké", "deal avancé hors de « Lead non booké »", d2c.map((d) => stageName(d.stage_id)));
  check((await admin.from("bookings").select("id").eq("workspace_id", ws).eq("email", mail("avant"))).data?.length === 1, "réservation enregistrée");

  // ---------------------------------------------------------------
  section("3. Abandon : contact saisi, aucune réservation");
  const p3 = await ctx.newPage();
  await p3.goto(url("avant"));
  await p3.waitForSelector("#bk-email");
  await p3.fill("#bk-email", mail("abandon"));
  await p3.locator("#bk-name").focus();
  await p3.waitForTimeout(1500);
  await p3.close();
  const c3 = await contactsOf(`email.eq.${mail("abandon")}`);
  check(c3.length === 1, "lead enregistré malgré l'abandon", c3.length);
  const d3 = c3[0] ? await dealsOf(c3[0].id) : [];
  check(d3.length === 1 && stageName(d3[0].stage_id) === "Lead non booké", "lead non booké au CRM", d3.map((d) => stageName(d.stage_id)));
  check((await admin.from("bookings").select("id").eq("workspace_id", ws).eq("email", mail("abandon"))).data?.length === 0, "aucun rendez-vous pour ce lead");

  // ---------------------------------------------------------------
  section("4. Mode téléphone, sans email");
  const p4 = await ctx.newPage();
  await p4.goto(url("tel"));
  await p4.waitForSelector("#bk-phone");
  const ids = await p4.locator("form.bk-cf [id^=bk-]").evaluateAll((els) => els.map((e) => e.id).filter((i) => ["bk-phone", "bk-name", "bk-email"].includes(i)));
  check(ids[0] === "bk-phone", "téléphone en premier", ids);
  await p4.fill("#bk-phone", "06 12 34 56 78");
  await p4.fill("#bk-name", "Chloé Tel");
  await p4.click("button:has-text('Continuer')");
  await p4.waitForSelector(".bk-card:not(.locked) .bk-day.av", { timeout: 15000 });
  check((await p4.locator(".bk-card.locked").count()) === 0, "sans email : passage à l'étape 2 accepté");
  await p4.locator(".bk-day.av").first().click();
  await p4.locator(".bk-slot").first().click();
  await p4.locator(".bk-confirm button").click();
  await p4.waitForSelector("text=Rendez-vous confirmé", { timeout: 20000 });
  const b4 = (await admin.from("bookings").select("email, phone, status").eq("workspace_id", ws).eq("phone", "+33612345678")).data ?? [];
  check(b4.length === 1 && b4[0].email === "" && b4[0].status === "confirmed", "réservation sans email, numéro normalisé +33612345678", b4);
  const c4 = await contactsOf("phone.eq.+33612345678");
  check(c4.length === 1, "un contact retrouvé par téléphone", c4.length);
  await p4.close();

  const p4b = await ctx.newPage();
  await p4b.goto(url("tel"));
  await p4b.waitForSelector("#bk-phone");
  await p4b.fill("#bk-phone", "0612345678");
  await p4b.fill("#bk-name", "Chloé Tel");
  await p4b.click("button:has-text('Continuer')");
  await p4b.waitForSelector(".bk-card:not(.locked) .bk-day.av", { timeout: 15000 });
  const c4b = await contactsOf("phone.eq.+33612345678");
  check(c4b.length === 1, "même numéro écrit autrement : pas de doublon", c4b.length);
  await p4b.close();

  // ---------------------------------------------------------------
  section("5. Mode les deux");
  const p5 = await ctx.newPage();
  await p5.goto(url("deux"));
  await p5.waitForSelector("#bk-phone");
  await p5.fill("#bk-phone", "07 11 22 33 44");
  await p5.fill("#bk-name", "Dan Deux");
  await p5.click("button:has-text('Continuer')");
  check((await p5.locator("#bk-email-e").count()) === 1, "email exigé en mode « les deux »");
  check((await p5.locator(".bk-card.locked").count()) === 1, "calendrier reste verrouillé");
  await p5.close();

  // ---------------------------------------------------------------
  section("6. API du lead");
  const post = (body) => fetch(`${BASE}/api/booking/lead`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const base = { profile: slug, type: "avant", name: "Eve Api", email: mail("api"), origin: "typing" };
  check((await post({ ...base, type: "classique" })).status === 404, "type sans coordonnées d'abord : 404");
  check((await post({ ...base, website_url: "http://spam" })).status === 400, "pot de miel rempli : 400");
  check((await post({ profile: slug, type: "avant", name: "Eve Api" })).status === 400, "aucun contact : 400");
  const r1 = await post(base);
  const r2 = await post(base);
  check(r1.status === 200 && r2.status === 200 && JSON.stringify(await r1.json()) === JSON.stringify(await r2.json()), "même réponse pour un contact nouveau ou déjà connu");
  const c6 = await contactsOf(`email.eq.${mail("api")}`);
  const d6 = c6[0] ? await dealsOf(c6[0].id) : [];
  check(c6.length === 1 && d6.length === 1, "rejouer le même lead ne crée ni second contact ni second deal", { contacts: c6.length, deals: d6.length });
  let limited = 0;
  for (let i = 0; i < 35; i++) if ((await post({ ...base, email: mail(`rl${i}`) })).status === 429) limited++;
  check(limited > 0, "limite de débit : 429 au-delà de 30 requêtes par minute", limited);

  // ---------------------------------------------------------------
  section("7. Téléphone");
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pm = await m.newPage();
  await pm.goto(url("avant"));
  await pm.waitForSelector("#bk-name");
  check(!(await pm.locator(".bk-cal").isVisible()), "étape 1 : calendrier masqué");
  check(await pm.locator(".bk-next").isVisible(), "étape 1 : ligne « Étape 2 » visible");
  const overflow = await pm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, "aucun défilement horizontal", overflow);
  const fs = await pm.locator("#bk-email").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  check(fs >= 16, "champs en 16 px minimum (pas de zoom iOS)", fs);
  const h = await pm.locator("button:has-text('Continuer')").evaluate((e) => e.getBoundingClientRect().height);
  check(h >= 44, "bouton d'au moins 44 px", h);
  await pm.fill("#bk-email", mail("mobile"));
  await pm.fill("#bk-name", "Mia Mobile");
  await pm.click("button:has-text('Continuer')");
  await pm.waitForSelector(".bk-card:not(.locked) .bk-day.av", { timeout: 15000 });
  check(await pm.locator(".bk-cal").isVisible(), "étape 2 : calendrier visible");
  await m.close();

  // ---------------------------------------------------------------
  section("8. Rechargement à l'étape 2 : la saisie est conservée");
  const p8 = await ctx.newPage();
  await p8.goto(url("avant"));
  await p8.waitForSelector("#bk-email");
  await p8.fill("#bk-email", mail("reload"));
  await p8.fill("#bk-name", "Rita Reload");
  await p8.waitForFunction((e) => Object.keys(sessionStorage).some((k) => k.startsWith("aos-bk:") && sessionStorage.getItem(k).includes(e)), mail("reload"));
  await p8.reload();
  await p8.waitForFunction((e) => document.querySelector("#bk-email")?.value === e, mail("reload"), { timeout: 5000 }).catch(() => {});
  check((await p8.inputValue("#bk-email")) === mail("reload") && (await p8.inputValue("#bk-name")) === "Rita Reload", "email et nom restaurés après rechargement");
  await p8.close();

  check(errors.length === 0, "aucune erreur JavaScript dans le navigateur", errors);
  await browser.close();
}

try {
  await seed();
  await run();
} catch (e) {
  failed++;
  console.log(`  ÉCHEC erreur inattendue\n       ${e instanceof Error ? e.stack : e}`);
} finally {
  await cleanup().catch((e) => console.log("nettoyage :", e.message));
}
console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
