import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase-Client fuer Client-Komponenten (Browser).
 * Nutzt ausschliesslich den oeffentlichen Anon-Key.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Fehlende Supabase-Env-Variablen: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return createBrowserClient(url, anonKey);
}
