import type { ReactNode } from "react";

type Size = "sm" | "md" | "lg";
type Tone = "card" | "raised" | "room";

/** Shape of each size (DESIGN.md, aviso): a panel hint, a notice in a screen, a whole empty screen. */
const SIZES: Record<Size, { box: string; title: string; body: string; gap: string }> = {
  sm: {
    box: "rounded-tile p-5",
    title: "text-title-sm leading-[1.15]",
    body: "text-ui leading-relaxed",
    gap: "gap-2",
  },
  md: {
    box: "rounded-card px-8 py-7",
    title: "text-cartela leading-tight",
    body: "text-base leading-relaxed",
    gap: "gap-3",
  },
  lg: {
    box: "rounded-card px-8 py-16 items-center text-center",
    title: "text-page leading-none",
    body: "text-reading leading-[1.75]",
    gap: "gap-6",
  },
};

const TONES: Record<Tone, string> = {
  card: "bg-card",
  raised: "bg-raised",
  room: "bg-room-tint",
};

export type StateCardProps = {
  title: string;
  body?: string;
  /** The small accent label above the title. */
  kicker?: string;
  /** Buttons and links, in a row under the text. */
  actions?: ReactNode;
  /** Extra content under the actions (a drop hint, a counter). */
  children?: ReactNode;
  size?: Size;
  tone?: Tone;
  /** `alert` for something that went wrong, `status` for something in progress; none for a plain empty state. */
  role?: "alert" | "status";
  /** The heading level of the title (a whole screen uses 1). */
  heading?: 1 | 2 | 3;
  /** For `tone="room"`: the colour index of the Sala (see `roomColorOf`). */
  room?: number;
  className?: string;
};

/**
 * The card every empty, waiting and failed state uses (DESIGN.md, aviso): a tone of surface, no frame, a title in
 * serif, a line of explanation and, when there is one, the useful action.
 */
export function StateCard({
  title,
  body,
  kicker,
  actions,
  children,
  size = "md",
  tone = "card",
  role,
  heading = 2,
  room,
  className = "",
}: StateCardProps) {
  const shape = SIZES[size];
  const Heading = `h${heading}` as const;
  return (
    <section
      role={role}
      data-room={tone === "room" ? room : undefined}
      className={`flex flex-col ${shape.gap} ${shape.box} ${TONES[tone]} ${className}`}
    >
      {kicker ? (
        <div className="text-label font-semibold tracking-kicker text-accent-text uppercase">{kicker}</div>
      ) : null}
      <Heading className={`font-serif font-semibold ${shape.title}`}>{title}</Heading>
      {body ? <p className={`max-w-[560px] text-ink-2 ${shape.body}`}>{body}</p> : null}
      {actions ? (
        <div className={`flex flex-wrap gap-3 ${size === "lg" ? "mt-2 justify-center" : "mt-1"}`}>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
