/**
 * A segmented control (DESIGN.md, segmentado): a rounded tray with the options inside; the chosen one is filled
 * with ink. Each option is a toggle button, so it works with the keyboard like any other button.
 */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className = "",
  compact = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Smaller options, for the reader bar. */
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex gap-0.5 rounded-field p-1 ${compact ? "bg-raised" : "bg-canvas"} ${className}`}
    >
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={chosen}
            onClick={() => onChange(option.value)}
            className={`rounded-tab text-ui font-medium transition-colors duration-fast ease-atril ${
              compact ? "px-2.5 py-2" : "px-3.5 py-2.5"
            } ${chosen ? "bg-ink text-ink-inverse" : "text-ink-2 hover:text-ink"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
