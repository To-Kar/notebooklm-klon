"use client";

import { useActionState, useState } from "react";

import {
  addFileSourceAction,
  addUrlSourceAction,
  type AddSourceState,
} from "@/app/notebooks/source-actions";
import {
  SOURCE_FILE_ACCEPT,
  SOURCE_FILE_MAX_BYTES,
  SOURCE_FILE_MAX_LABEL,
  isAllowedSourceMimeType,
} from "@/lib/source-limits";

const INITIAL_STATE: AddSourceState = { error: null };

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 disabled:opacity-60 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-500";

const buttonClass =
  "w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300";

function ErrorText({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

/**
 * Zwei Wege, eine Quelle hinzuzufuegen: Datei-Upload und URL.
 *
 * Beide gehen durch Server Actions, der Browser spricht nie direkt mit
 * Supabase Storage.
 */
export function AddSourceForm({ notebookId }: { notebookId: string }) {
  const [fileState, fileAction, filePending] = useActionState(
    addFileSourceAction,
    INITIAL_STATE,
  );
  const [urlState, urlAction, urlPending] = useActionState(
    addUrlSourceAction,
    INITIAL_STATE,
  );

  /**
   * Datei vorab im Browser pruefen. Eine zu grosse Datei wuerde sonst am
   * bodySizeLimit der Server Action scheitern, bevor unser Code sie sieht -
   * das gaebe eine unverstaendliche Fehlermeldung statt einer klaren.
   */
  const [fileCheckError, setFileCheckError] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      setFileCheckError(null);
      return;
    }

    if (file.size > SOURCE_FILE_MAX_BYTES) {
      setFileCheckError(`Die Datei ist größer als ${SOURCE_FILE_MAX_LABEL}.`);
      return;
    }

    if (!isAllowedSourceMimeType(file.type)) {
      setFileCheckError("Nur PDF- und Textdateien werden unterstützt.");
      return;
    }

    setFileCheckError(null);
  }

  const fileError = fileCheckError ?? fileState.error;

  return (
    <div className="space-y-5">
      <form action={fileAction} className="space-y-2">
        <input type="hidden" name="notebookId" value={notebookId} />
        <label
          htmlFor="source-file"
          className="block text-xs font-medium text-neutral-500 dark:text-neutral-400"
        >
          Datei hochladen
        </label>
        <input
          id="source-file"
          type="file"
          name="file"
          accept={SOURCE_FILE_ACCEPT}
          onChange={handleFileChange}
          disabled={filePending}
          aria-invalid={fileError !== null}
          aria-describedby={fileError ? "source-file-error" : undefined}
          className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-900 hover:file:bg-neutral-300 disabled:opacity-60 dark:file:bg-neutral-800 dark:file:text-neutral-100 dark:hover:file:bg-neutral-700"
        />
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          PDF oder Text, bis {SOURCE_FILE_MAX_LABEL}.
        </p>
        <button
          type="submit"
          disabled={filePending || fileCheckError !== null}
          className={buttonClass}
        >
          {filePending ? "Wird hochgeladen ..." : "Datei hinzufügen"}
        </button>
        {fileError ? (
          <ErrorText id="source-file-error" message={fileError} />
        ) : null}
      </form>

      <form action={urlAction} className="space-y-2">
        <input type="hidden" name="notebookId" value={notebookId} />
        <label
          htmlFor="source-url"
          className="block text-xs font-medium text-neutral-500 dark:text-neutral-400"
        >
          URL hinzufügen
        </label>
        {/* Der key erzwingt ein Neumounten, damit die abgelehnte Adresse
            nach dem Formular-Reset wieder im Feld steht. */}
        <input
          key={urlState.url ?? "leer"}
          defaultValue={urlState.url ?? ""}
          id="source-url"
          type="url"
          name="url"
          autoComplete="off"
          placeholder="https://beispiel.de/artikel"
          disabled={urlPending}
          aria-invalid={urlState.error !== null}
          aria-describedby={urlState.error ? "source-url-error" : undefined}
          className={inputClass}
        />
        <button type="submit" disabled={urlPending} className={buttonClass}>
          {urlPending ? "Wird hinzugefügt ..." : "URL hinzufügen"}
        </button>
        {urlState.error ? (
          <ErrorText id="source-url-error" message={urlState.error} />
        ) : null}
      </form>
    </div>
  );
}
