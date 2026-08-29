"use client";

import { useRouter } from "next/navigation";

import {
  deleteNotebookAction,
  deleteSourceAction,
} from "@/app/notebooks/delete-actions";
import { ConfirmButton } from "@/components/confirm-button";

/**
 * Die Loeschknoepfe fuer Quelle und Notebook.
 *
 * Duenne Huellen um ConfirmButton, damit die Serverseite gebunden ist und
 * die Server Actions nicht in mehreren Dateien auftauchen.
 */

export function DeleteSourceButton({ sourceId }: { sourceId: string }) {
  return (
    <ConfirmButton
      size="klein"
      label="Löschen"
      question="Quelle löschen?"
      action={() => deleteSourceAction(sourceId)}
    />
  );
}

export function DeleteNotebookButton({
  notebookId,
  sourceCount,
}: {
  notebookId: string;
  sourceCount: number;
}) {
  const router = useRouter();

  // Beim Namen nennen, was verschwindet. "Bist du sicher?" hilft niemandem.
  const question =
    sourceCount === 0
      ? "Notebook löschen?"
      : sourceCount === 1
        ? "Notebook mit 1 Quelle und allen Abschnitten löschen?"
        : `Notebook mit ${sourceCount} Quellen und allen Abschnitten löschen?`;

  return (
    <ConfirmButton
      label="Notebook löschen"
      question={question}
      action={() => deleteNotebookAction(notebookId)}
      onDone={() => router.push("/")}
    />
  );
}
