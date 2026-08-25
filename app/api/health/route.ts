import { NextResponse } from "next/server";

/**
 * Health-Check. Meldet, ob die noetigen Env-Variablen gesetzt sind.
 * Gibt bewusst nur Booleans zurueck, niemals die Werte selbst.
 */
export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    LLM_API_KEY: Boolean(process.env.LLM_API_KEY),
  };

  const ready = Object.values(env).every(Boolean);

  return NextResponse.json(
    { status: ready ? "ok" : "missing-env", env },
    { status: ready ? 200 : 503 },
  );
}
