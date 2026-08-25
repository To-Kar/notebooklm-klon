import { createClient } from "@supabase/supabase-js";

/**
 * Server-Client mit Secret-Key (sb_secret_...).
 *
 * WICHTIG: Diese Datei darf NUR aus Server-Code importiert werden
 * (Route Handler, Server Actions, Server Components). Der Secret-Key
 * umgeht Row Level Security und darf niemals in den Browser gelangen.
 *
 * Bewusste Scope-Entscheidung: Fuer die Demo gibt es keine Auth. Serverseitige
 * Operationen (Ingestion, Retrieval) laufen ueber diesen privilegierten Client.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Fehlende Supabase-Env-Variablen: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY",
    );
  }

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
