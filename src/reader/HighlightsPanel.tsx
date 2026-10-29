import { useId, useState } from "react";
import { useT } from "../i18n";
import type { Highlight, HighlightGroup } from "../api/types";
import { chipButton } from "../ui/buttons";
import { displayHighlightText, PIGMENT_COLOR, PIGMENT_KEY } from "./highlightPresentation";
import { groupHighlights, sortHighlights, type HighlightOrder, type HighlightSection } from "./highlightList";
import { StateCard } from "../ui/StateCard";
import { ChevronDownIcon, MoreIcon, PlusIcon } from "../ui/icons";
import { SidePanel } from "./SidePanel";
import { GroupNameForm } from "./GroupNameForm";

/** The key of the "Sin grupo" section in the set of collapsed sections (group ids are uuids, never this). */
const UNGROUPED = "ungrouped";

/**
 * The reader's side panel with every highlight of the book, as cards. The newest come first; "Por página" gives the
 * reading order. A book with groups shows them as folding sections, "Sin grupo" last; a book without groups is a plain
 * list. A click on a card goes to the highlight; "Con nota" keeps the ones with a note; the export chip writes the
 * book as Markdown.
 */
export function HighlightsPanel({
  highlights,
  groups,
  exporting,
  onJump,
  onExport,
  onClose,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
}: {
  highlights: Highlight[];
  groups: HighlightGroup[];
  exporting: boolean;
  onJump: (highlight: Highlight) => void;
  onExport: () => void;
  onClose: () => void;
  /** Resolves to the new group, or null when the backend refused it (the field then stays open). */
  onCreateGroup: (name: string) => Promise<HighlightGroup | null>;
  onRenameGroup: (groupId: string, name: string) => void;
  onDeleteGroup: (groupId: string) => void;
}) {
  const t = useT();
  const [onlyNotes, setOnlyNotes] = useState(false);
  const [order, setOrder] = useState<HighlightOrder>("recent");
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const shown = sortHighlights(highlights, order).filter((highlight) => !onlyNotes || highlight.note);
  const sections = groups.length > 0 ? groupHighlights(shown, groups, !onlyNotes) : null;

  const toggleSection = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <SidePanel
      label={t("highlightPanel.label")}
      title={t("highlightPanel.title")}
      count={highlights.length}
      onClose={onClose}
    >
      <div role="group" aria-label={t("highlightPanel.filter")} className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={!onlyNotes}
          onClick={() => setOnlyNotes(false)}
          className={chipButton(!onlyNotes, true)}
        >
          {t("highlightPanel.all")}
        </button>
        <button
          type="button"
          aria-pressed={onlyNotes}
          onClick={() => setOnlyNotes(true)}
          className={chipButton(onlyNotes, true)}
        >
          {t("highlightPanel.withNote")}
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className={`${chipButton(false, true)} ml-auto disabled:opacity-60`}
        >
          {exporting ? t("highlightPanel.exporting") : t("highlightPanel.export")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("highlightPanel.order")} className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={order === "recent"}
            onClick={() => setOrder("recent")}
            className={chipButton(order === "recent", true)}
          >
            {t("highlightPanel.recent")}
          </button>
          <button
            type="button"
            aria-pressed={order === "page"}
            onClick={() => setOrder("page")}
            className={chipButton(order === "page", true)}
          >
            {t("highlightPanel.byPage")}
          </button>
        </div>
        <button
          type="button"
          aria-expanded={creating}
          onClick={() => setCreating((open) => !open)}
          className={`${chipButton(false, true)} ml-auto`}
        >
          <PlusIcon size={14} />
          {t("highlightGroup.new")}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto">
        {creating ? (
          <GroupNameForm
            label={t("highlightGroup.name")}
            submitLabel={t("highlightGroup.create")}
            onCancel={() => setCreating(false)}
            onSubmit={async (name) => {
              const group = await onCreateGroup(name);
              if (group) setCreating(false);
            }}
          />
        ) : null}

        {highlights.length === 0 ? (
          <StateCard
            size="sm"
            tone="raised"
            title={t("highlightPanel.empty")}
            body={t("highlightPanel.empty.body")}
          />
        ) : shown.length === 0 ? (
          <StateCard
            size="sm"
            tone="raised"
            title={t("highlightPanel.noNotes")}
            body={t("highlightPanel.noNotes.body")}
          />
        ) : null}

        {sections
          ? sections.map((section) => {
              const key = section.group?.id ?? UNGROUPED;
              return (
                <GroupSection
                  key={key}
                  section={section}
                  expanded={!collapsed.has(key)}
                  onToggle={() => toggleSection(key)}
                  onJump={onJump}
                  onRename={(name) => {
                    if (section.group) onRenameGroup(section.group.id, name);
                  }}
                  onDelete={() => {
                    if (section.group) onDeleteGroup(section.group.id);
                  }}
                />
              );
            })
          : shown.map((highlight) => (
              <HighlightCard key={highlight.id} highlight={highlight} onJump={onJump} />
            ))}
      </div>
    </SidePanel>
  );
}

/**
 * One group of the panel: a folding section with its name and count. A group has a menu to rename it or delete it;
 * deleting asks first, and its highlights go to "Sin grupo". "Sin grupo" has no menu.
 */
function GroupSection({
  section,
  expanded,
  onToggle,
  onJump,
  onRename,
  onDelete,
}: {
  section: HighlightSection;
  expanded: boolean;
  onToggle: () => void;
  onJump: (highlight: Highlight) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const bodyId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { group, items } = section;
  const name = group ? group.name : t("highlightGroup.ungrouped");

  return (
    <section aria-label={name} className="flex flex-col gap-2.5">
      {renaming && group ? (
        <GroupNameForm
          label={t("highlightGroup.name")}
          initial={group.name}
          submitLabel={t("highlightGroup.save")}
          onCancel={() => setRenaming(false)}
          onSubmit={(newName) => {
            setRenaming(false);
            onRename(newName);
          }}
        />
      ) : (
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={onToggle}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-tab py-1.5 text-left transition-colors duration-fast ease-atril hover:text-ink"
            >
              <ChevronDownIcon
                size={16}
                className={`text-ink-3 transition-transform duration-fast ease-atril ${expanded ? "" : "-rotate-90"}`}
              />
              <span className="min-w-0 truncate font-serif text-title-sm leading-tight font-semibold text-ink">
                {name}
              </span>
              <span className="text-ui text-ink-3">{items.length}</span>
            </button>
            {group ? (
              <button
                type="button"
                aria-label={t("highlightGroup.options")}
                title={t("highlightGroup.options")}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                className="flex size-11 items-center justify-center rounded-field text-ink-2 transition-colors duration-fast ease-atril hover:bg-surface-3 hover:text-ink"
              >
                <MoreIcon />
              </button>
            ) : null}
          </div>

          {menuOpen && group ? (
            <div className="flex flex-wrap gap-2 rounded-tile bg-surface-2 p-2.5 shadow-float">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setRenaming(true);
                }}
                className={smallActionClass}
              >
                {t("highlightGroup.rename")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmingDelete(true);
                }}
                className={smallActionClass}
              >
                {t("highlightGroup.delete")}
              </button>
            </div>
          ) : null}

          {confirmingDelete && group ? (
            <div className="flex flex-col gap-2.5 rounded-tile bg-surface-2 p-3.5 shadow-float">
              <p className="text-ui text-ink-2">{t("highlightGroup.deleteConfirm")}</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmingDelete(false)} className={smallActionClass}>
                  {t("highlightGroup.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    onDelete();
                  }}
                  className="rounded-control bg-accent px-3.5 py-2 text-base leading-none font-semibold text-accent-ink"
                >
                  {t("highlightGroup.confirm")}
                </button>
              </div>
            </div>
          ) : null}
        </header>
      )}

      <div id={bodyId} className={expanded ? "flex flex-col gap-2.5" : "hidden"}>
        {items.length === 0 ? (
          <p className="px-1 text-ui text-ink-3">{t("highlightGroup.empty")}</p>
        ) : (
          items.map((highlight) => <HighlightCard key={highlight.id} highlight={highlight} onJump={onJump} />)
        )}
      </div>
    </section>
  );
}

const smallActionClass =
  "rounded-control bg-wash px-3 py-2 text-ui font-medium text-ink transition-colors duration-fast ease-atril hover:bg-surface-3";

/** A highlight in the panel: its pigment and page, its text in italics, and its note. A click goes to it. */
function HighlightCard({
  highlight,
  onJump,
}: {
  highlight: Highlight;
  onJump: (highlight: Highlight) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => onJump(highlight)}
      className="flex gap-3.5 rounded-tile bg-raised p-4 text-left transition-colors duration-fast ease-atril hover:bg-surface-2"
    >
      <span
        aria-hidden="true"
        className="w-1 flex-none rounded-xs"
        style={{ background: PIGMENT_COLOR[highlight.color] }}
      />
      <span className="flex min-w-0 flex-col gap-2">
        <span className="text-label font-semibold tracking-label text-ink-3 uppercase">
          {t("highlightPanel.cardLabel", {
            color: t(PIGMENT_KEY[highlight.color]),
            page: String(highlight.page),
          })}
        </span>
        <span className="font-serif text-title-sm leading-[1.35] font-medium text-ink italic">
          {displayHighlightText(highlight.text)}
        </span>
        {highlight.note ? (
          <span className="rounded-tab bg-surface-2 px-2.5 py-2 text-ui text-ink-2">{highlight.note}</span>
        ) : null}
      </span>
    </button>
  );
}
