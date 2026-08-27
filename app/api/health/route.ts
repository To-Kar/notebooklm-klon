import { NextResponse } from "next/server";

/**
 * Health-Check. Meldet, ob die noetigen Env-Variablen gesetzt sind.
 *
 * Gibt bewusst nur Booleans zurueck, niemals die Werte selbst - der Endpunkt
 * ist oeffentlich erreichbar.
 *
 * Die Liste muss vollstaendig bleiben: eine fehlende Variable, die hier nicht
 * auftaucht, laesst den Check "ok" melden, waehrend die Anwendung nicht
 * funktioniert. Genau das ist beim ersten Deployment passiert - LLM_MODEL und
 * EMBEDDING_MODEL fehlten in der Pruefung, und der Chat waere trotz gruener
 * Meldung tot gewesen.
 */
const BENOETIGTE_VARIABLEN = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "LLM_API_KEY",
  "LLM_MODEL",
  "EMBEDDING_MODEL",
] as const;

export async function GET() {
  const env = Object.fromEntries(
    BENOETIGTE_VARIABLEN.map((name) => [name, Boolean(process.env[name])]),
  );

  const fehlend = BENOETIGTE_VARIABLEN.filter((name) => !process.env[name]);
  const ready = fehlend.length === 0;

  return NextResponse.json(
    {
      status: ready ? "ok" : "missing-env",
      ...(ready ? {} : { missing: fehlend }),
      env,
    },
    { status: ready ? 200 : 503 },
  );
}
