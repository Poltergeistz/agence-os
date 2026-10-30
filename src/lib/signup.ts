import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";

export async function signupClosed() {
  const { count, error } = await supabaseAdmin().from("profiles").select("id", { count: "exact", head: true });
  return !error && (count ?? 0) > 0;
}
