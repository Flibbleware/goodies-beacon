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

/** Up out of a circle: moving something up a level, here from wished-for to wanted. */
export function PromoteIcon({ className }: { className?: string | undefined }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16.5v-9M8.5 11L12 7.5l3.5 3.5" />
    </Icon>
  );
}
