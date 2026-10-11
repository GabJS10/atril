/**
 * A segmented control (DESIGN.md, segmentado): a 1 px line around the options; the chosen one is filled with ink.
 * Each option is a toggle button, so it works with the keyboard like any other button.
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
    <div role="group" aria-label={label} className={`inline-flex border border-line ${className}`}>
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={chosen}
            onClick={() => onChange(option.value)}
            className={`${compact ? "px-2.5 py-1 text-label" : "px-4 py-2 text-base font-medium"} ${
              chosen ? "bg-ink text-ink-inverse" : "text-ink-2"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
