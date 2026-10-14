import { useState } from "react";
import { useT } from "../i18n";
import { PlusIcon } from "../ui/icons";
import { useCollectionMutations } from "./collectionActions";

/**
 * "Nueva Sala": a button that turns into a name field. Enter creates the Sala, Escape or leaving the empty field
 * puts the button back. `children` is how the idle button looks (the sidebar row or the dashed card).
 */
export function NewRoom({
  className,
  inputClassName,
  children,
}: {
  className: string;
  inputClassName: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  const { create } = useCollectionMutations();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  const close = () => {
    setEditing(false);
    setName("");
  };

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className={className}>
        {children ?? (
          <>
            <PlusIcon />
            {t("collections.create")}
          </>
        )}
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        create.mutate(trimmed, { onSuccess: close });
      }}
    >
      <input
        autoFocus
        value={name}
        maxLength={100}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
        onBlur={() => {
          if (!name.trim()) close();
        }}
        placeholder={t("collections.placeholder")}
        aria-label={t("collections.placeholder")}
        className={inputClassName}
      />
    </form>
  );
}
