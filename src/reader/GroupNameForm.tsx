import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useT } from "../i18n";
import { fieldInput } from "../ui/buttons";

/** The longest name a group can have (IPC.md: 1 to 200 characters, after trimming). */
export const GROUP_NAME_MAX = 200;

/**
 * An inline field to type a group's name: create one, or rename it. Enter submits when the name is not empty after
 * trimming; Escape cancels. The owner closes the field: it stays open after `onSubmit` until the owner unmounts it.
 * While `onSubmit` returns a promise, the field is busy and cannot be submitted again.
 */
export function GroupNameForm({
  label,
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => void | Promise<unknown>;
  onCancel: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const name = text.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name || busy) return;
    const pending = onSubmit(name);
    if (pending instanceof Promise) {
      setBusy(true);
      void pending.then(
        () => setBusy(false),
        () => setBusy(false),
      );
    }
  };

  // Escape is for this field only: it must not also close the panel or the editor around it.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onCancel();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input
        aria-label={label}
        placeholder={t("highlightGroup.name")}
        value={text}
        maxLength={GROUP_NAME_MAX}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className={fieldInput}
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-tab px-2.5 py-1.5 text-ui text-ink-2 hover:text-ink"
        >
          {t("highlightGroup.cancel")}
        </button>
        <button
          type="submit"
          disabled={!name || busy}
          className="rounded-control bg-accent px-3.5 py-2 text-ui font-semibold text-accent-ink disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
