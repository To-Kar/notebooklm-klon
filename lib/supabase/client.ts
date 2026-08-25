import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase-Client fuer Client-Komponenten (Browser).
 * Nutzt ausschliesslich den oeffentlichen Publishable-Key (sb_publishable_...).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Fehlende Supabase-Env-Variablen: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return createBrowserClient(url, publishableKey);
}
