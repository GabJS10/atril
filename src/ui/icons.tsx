import type { ReactNode, SVGProps } from "react";

/** Line icons of the gallery (DESIGN.md, iconos): 24 px grid, 1.6 stroke, always decorative (`aria-hidden`). */
function Icon({
  size = 18,
  strokeWidth = 1.6,
  className = "",
  children,
  ...rest
}: { size?: number; strokeWidth?: number; className?: string; children: ReactNode } & Omit<
  SVGProps<SVGSVGElement>,
  "children"
>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number; className?: string };

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </Icon>
);

export const ShelfIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4" width="4" height="16" />
    <rect x="10" y="4" width="4" height="16" />
    <path d="M16 5l3.5-.8 3 15.6-3.5.8z" />
  </Icon>
);

export const StarIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p} fill={filled ? "currentColor" : "none"}>
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.8}>
    <path d="M5 12h14" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);

export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);

export const BookOpenIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.8}>
    <path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" />
    <path d="M12 6v13.5" />
  </Icon>
);

export const BackIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.7}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const ListIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.7}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
);

export const PenIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.7}>
    <path d="M4 20h7" />
    <path d="M15.5 4.5l4 4L10 18H6v-4z" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.8}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const LogoMark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 19V6a2 2 0 0 1 2-2h12v15" />
    <path d="M4 19a2 2 0 0 0 2 2h12" />
    <path d="M9 8h5" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

export const MoreIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={2}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
