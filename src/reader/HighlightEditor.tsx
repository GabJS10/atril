import { useId, useState } from "react";
import type { Highlight, HighlightColor, HighlightGroup } from "../api/types";
import { useT } from "../i18n";
import { GroupNameForm } from "./GroupNameForm";
import { floatingPosition, PIGMENT_COLOR, PIGMENT_KEY, PIGMENTS } from "./highlightPresentation";

const EDITOR_WIDTH = 300;
const EDITOR_HEIGHT = 340;

/** The option of the group selector that asks for a new group. Group ids are uuids, so it never clashes. */
const NEW_GROUP = "new";

/**
 * Editor of one highlight: its colour, its group, its note, and deleting it. Escape closes it. The group selector
 * moves the highlight to a group, to "Sin grupo", or to a new group named in place.
 */
export function HighlightEditor({
  highlight,
  anchor,
  focusNote,
  groups,
  onColor,
  onGroup,
  onNewGroup,
  onNote,
  onDelete,
  onClose,
}: {
  highlight: Highlight;
  anchor: DOMRect;
  focusNote: boolean;
  groups: HighlightGroup[];
  onColor: (color: HighlightColor) => void;
  onGroup: (groupId: string | null) => void;
  onNewGroup: (name: string) => void;
  onNote: (text: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const selectId = useId();
  const [text, setText] = useState(highlight.note ?? "");
  const [naming, setNaming] = useState(false);
  const { left, top } = floatingPosition(anchor, EDITOR_WIDTH, EDITOR_HEIGHT);

  return (
    <div
      role="dialog"
      aria-label={t("highlight.editor")}
      style={{ left, top, width: EDITOR_WIDTH }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed z-20 flex flex-col gap-4 rounded-tile bg-surface-2 p-4 text-ui text-ink shadow-float"
    >
      <div className="flex items-center justify-between">
        {PIGMENTS.map((color) => (
          <button
            key={color}
            type="button"
            aria-pressed={highlight.color === color}
            aria-label={t(PIGMENT_KEY[color])}
            onClick={() => onColor(color)}
            className="flex size-6 items-center justify-center rounded-dot"
          >
            <span
              aria-hidden="true"
              className={`block size-6 rounded-dot ${
                highlight.color === color ? "ring-2 ring-ink ring-offset-2 ring-offset-surface-2" : ""
              }`}
              style={{ background: PIGMENT_COLOR[color] }}
            />
          </button>
        ))}
        <button type="button" onClick={onClose} className="rounded-tab px-2 py-1 text-ink-2 hover:text-ink">
          {t("highlight.close")}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={selectId} className="text-ui text-ink-3">
          {t("highlight.group")}
        </label>
        <select
          id={selectId}
          value={highlight.groupId ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            if (value === NEW_GROUP) setNaming(true);
            else onGroup(value === "" ? null : value);
          }}
          className="rounded-control bg-field px-3 py-2.5 text-base text-ink"
        >
          <option value="">{t("highlightGroup.ungrouped")}</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
          <option value={NEW_GROUP}>{t("highlight.groupNew")}</option>
        </select>
        {naming ? (
          <GroupNameForm
            label={t("highlight.groupNewLabel")}
            submitLabel={t("highlightGroup.create")}
            onCancel={() => setNaming(false)}
            onSubmit={(name) => {
              setNaming(false);
              onNewGroup(name);
            }}
          />
        ) : null}
      </div>

      <label className="flex flex-col gap-2">
        <span className="sr-only">{t("highlight.noteLabel")}</span>
        <textarea
          autoFocus={focusNote}
          value={text}
          maxLength={10_000}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          className="resize-none rounded-control bg-field p-3 text-base text-ink"
        />
      </label>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNote(text)}
          className="rounded-control bg-accent px-3.5 py-2 font-semibold text-accent-ink"
        >
          {t("highlight.saveNote")}
        </button>
        <button type="button" onClick={onDelete} className="rounded-tab px-2 py-1 text-ink-2 hover:text-ink">
          {t("highlight.delete")}
        </button>
      </div>
    </div>
  );
}
