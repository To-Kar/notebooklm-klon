import { createClient } from "@supabase/supabase-js";

/**
 * Server-Client mit Service-Role-Key.
 *
 * WICHTIG: Diese Datei darf NUR aus Server-Code importiert werden
 * (Route Handler, Server Actions, Server Components). Der Service-Role-Key
 * umgeht Row Level Security und darf niemals in den Browser gelangen.
 *
 * Bewusste Scope-Entscheidung: Fuer die Demo gibt es keine Auth. Serverseitige
 * Operationen (Ingestion, Retrieval) laufen ueber diesen privilegierten Client.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Fehlende Supabase-Env-Variablen: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
