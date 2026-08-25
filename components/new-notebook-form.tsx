"use client";

import { useActionState } from "react";

import {
  createNotebookAction,
  createNotebookInitialState,
} from "@/app/notebooks/actions";
import { NOTEBOOK_TITLE_MAX_LENGTH } from "@/lib/notebook-limits";

/**
 * Anlege-Formular fuer ein Notebook.
 *
 * Ruft nur die Server Action auf. Kein Supabase-Zugriff im Browser: die
 * Laengenbegrenzung kommt aus lib/notebook-limits.ts, damit der Server-Client
 * nicht in den Client-Bundle gerat.
 */
export function NewNotebookForm() {
  const [state, formAction, pending] = useActionState(
    createNotebookAction,
    createNotebookInitialState,
  );

  const hasError = state.error !== null;

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          name="title"
          maxLength={NOTEBOOK_TITLE_MAX_LENGTH}
          autoComplete="off"
          placeholder="Titel des neuen Notebooks"
          aria-label="Titel des neuen Notebooks"
          aria-invalid={hasError}
          aria-describedby={hasError ? "new-notebook-error" : undefined}
          className="flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 disabled:opacity-60 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-500"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {pending ? "Wird angelegt ..." : "Notebook anlegen"}
        </button>
      </div>

      {hasError ? (
        <p
          id="new-notebook-error"
          role="alert"
          className="text-sm text-red-600 dark:text-red-400"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
