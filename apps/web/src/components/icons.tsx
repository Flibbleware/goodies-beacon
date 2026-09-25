import type { ReactNode } from 'react';

/**
 * Line icons for buttons, drawn inline in the same style as the wish categories. Decorative: a
 * button that shows only an icon carries its name in `aria-label`, so these are always hidden.
 */
function Icon({
  children,
  className = 'size-4',
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function SearchIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </Icon>
  );
}

export function EditIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </Icon>
  );
}

export function RemoveIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </Icon>
  );
}

/** Points down; turned a quarter to point right when what it opens is closed. */
export function ChevronIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

/** A clock with an arrow running back round it: what came before. */
export function HistoryIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3 3.5V8h4.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

/** Up out of a circle: moving something up a level, here from wished-for to wanted. */
export function PromoteIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16.5v-9M8.5 11L12 7.5l3.5 3.5" />
    </Icon>
  );
}

/** The navigation's icons (P1-23): one per main page, none for the settings pages beneath. */
export function DashboardIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5" rx="1.5" />
      <rect x="13.5" y="11" width="7.5" height="10" rx="1.5" />
      <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
    </Icon>
  );
}

/** A target: what is being hunted. */
export function WantedIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </Icon>
  );
}

export function WishIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <path d="M12 3.1L14.5 9.2L21 9.7L16 13.9L17.6 20.3L12 16.8L6.4 20.3L8 13.9L3 9.7L9.5 9.2z" />
    </Icon>
  );
}

/** An inbox tray: the listings that have arrived. */
export function CandidatesIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <path d="M3 13l2.6-7.6A2 2 0 0 1 7.5 4h9a2 2 0 0 1 1.9 1.4L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 13h5l1.5 2.5h5L16 13h5" />
    </Icon>
  );
}

/** A rosette: a grade awarded. */
export function GradingIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="9" r="6" />
      <path d="M8.5 14L7 21.5l5-2.5 5 2.5-1.5-7.5" />
    </Icon>
  );
}

export function CostsIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <path d="M5.5 3h13v18l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </Icon>
  );
}

export function SettingsIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <path d="M9.8 4.9L10.3 2.3L13.7 2.3L14.2 4.9L15.5 5.5L17.6 4L20 6.4L18.5 8.5L19.1 9.8L21.7 10.3L21.7 13.7L19.1 14.2L18.5 15.5L20 17.6L17.6 20L15.5 18.5L14.2 19.1L13.7 21.7L10.3 21.7L9.8 19.1L8.5 18.5L6.4 20L4 17.6L5.5 15.5L4.9 14.2L2.3 13.7L2.3 10.3L4.9 9.8L5.5 8.5L4 6.4L6.4 4L8.5 5.5z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}
