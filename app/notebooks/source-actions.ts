"use server";

import { revalidatePath } from "next/cache";

import { getNotebook } from "@/lib/notebooks";
import {
  SOURCE_FILE_MAX_BYTES,
  SOURCE_FILE_MAX_LABEL,
  isAllowedSourceMimeType,
} from "@/lib/source-limits";
import {
  createFileSource,
  createUrlSource,
  parseSourceUrl,
} from "@/lib/sources";

/**
 * Server Actions zum Hinzufuegen von Quellen.
 *
 * Nur Typen und async Funktionen exportieren - eine "use server"-Datei
 * erlaubt nichts anderes.
 */
export type AddSourceState = {
  error: string | null;
  /**
   * Die eingegebene URL, wenn sie abgelehnt wurde.
   *
   * React setzt das Formular nach jeder Action zurueck. Ohne diesen Rueckweg
   * muesste der Nutzer eine vertippte Adresse komplett neu eingeben.
   */
  url?: string;
};

/**
 * Die notebook_id kommt als Formularfeld und ist damit ungeprueft.
 * Sie wird gegen die DB aufgeloest, statt sie direkt weiterzureichen.
 */
async function resolveNotebookId(formData: FormData): Promise<string | null> {
  const rawId = formData.get("notebookId");

  if (typeof rawId !== "string") {
    return null;
  }

  const notebook = await getNotebook(rawId);
  return notebook?.id ?? null;
}

export async function addUrlSourceAction(
  _prevState: AddSourceState,
  formData: FormData,
): Promise<AddSourceState> {
  const notebookId = await resolveNotebookId(formData);

  if (!notebookId) {
    return { error: "Dieses Notebook gibt es nicht." };
  }

  const rawUrl = formData.get("url");
  const submittedUrl = typeof rawUrl === "string" ? rawUrl : "";
  const url = parseSourceUrl(submittedUrl);

  if (!url) {
    return {
      error: "Bitte gib eine gueltige http- oder https-Adresse ein.",
      url: submittedUrl,
    };
  }

  try {
    await createUrlSource(notebookId, url);
  } catch (error) {
    console.error("URL-Quelle anlegen fehlgeschlagen:", error);
    return {
      error: "Die Quelle konnte nicht angelegt werden. Bitte versuch es erneut.",
      url: submittedUrl,
    };
  }

  revalidatePath(`/notebooks/${notebookId}`);
  return { error: null };
}

export async function addFileSourceAction(
  _prevState: AddSourceState,
  formData: FormData,
): Promise<AddSourceState> {
  const notebookId = await resolveNotebookId(formData);

  if (!notebookId) {
    return { error: "Dieses Notebook gibt es nicht." };
  }

  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bitte waehl eine Datei aus." };
  }

  // Dieselben Pruefungen wie im Formular. Das Formular ist Komfort,
  // hier ist die Grenze, die zaehlt.
  if (file.size > SOURCE_FILE_MAX_BYTES) {
    return { error: `Die Datei ist groesser als ${SOURCE_FILE_MAX_LABEL}.` };
  }

  if (!isAllowedSourceMimeType(file.type)) {
    return { error: "Nur PDF- und Textdateien werden unterstuetzt." };
  }

  try {
    await createFileSource(notebookId, file);
  } catch (error) {
    console.error("Datei-Quelle anlegen fehlgeschlagen:", error);
    return {
      error: "Die Datei konnte nicht gespeichert werden. Bitte versuch es erneut.",
    };
  }

  revalidatePath(`/notebooks/${notebookId}`);
  return { error: null };
}
