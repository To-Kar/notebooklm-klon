"use server";

import { revalidatePath } from "next/cache";

import { NOTEBOOK_TITLE_MAX_LENGTH } from "@/lib/notebook-limits";
import { createNotebook } from "@/lib/notebooks";

/**
 * Rueckgabe der Server Action fuer useActionState.
 * error === null bedeutet Erfolg.
 *
 * Nur Typen, keine Werte: eine "use server"-Datei darf ausschliesslich
 * async Funktionen exportieren. Typen verschwinden beim Kompilieren und
 * sind deshalb erlaubt.
 */
export type CreateNotebookState = {
  error: string | null;
};

/**
 * Legt ein Notebook an und aktualisiert danach die Startseite.
 *
 * Erwartete Fehler (leerer Titel, zu langer Titel) werden als Zustand
 * zurueckgegeben, damit das Formular sie anzeigen kann. Unerwartete Fehler
 * werden geloggt und als neutrale Meldung gezeigt, nicht verschluckt.
 */
export async function createNotebookAction(
  _prevState: CreateNotebookState,
  formData: FormData,
): Promise<CreateNotebookState> {
  const rawTitle = formData.get("title");
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";

  if (title.length === 0) {
    return { error: "Bitte gib einen Titel ein." };
  }

  if (title.length > NOTEBOOK_TITLE_MAX_LENGTH) {
    return {
      error: `Der Titel darf hoechstens ${NOTEBOOK_TITLE_MAX_LENGTH} Zeichen lang sein.`,
    };
  }

  try {
    await createNotebook(title);
  } catch (error) {
    console.error("Notebook anlegen fehlgeschlagen:", error);
    return {
      error: "Das Notebook konnte nicht angelegt werden. Bitte versuch es erneut.",
    };
  }

  revalidatePath("/");
  return { error: null };
}
