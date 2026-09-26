import type { ReactNode } from 'react';

const ICON_BUTTON_HOVER = {
  neutral: 'hover:text-ink dark:hover:text-ink-dark',
  accent: 'hover:text-beacon',
  danger: 'hover:text-red-600 dark:hover:text-red-400',
};

/**
 * A square button showing only an icon, for the actions on a row of a list page: the wish list's,
 * the shared criteria's and the categories'. `label` is its accessible name; `hint` is the tooltip,
 * when the icon needs more explaining than the name gives.
 */
export function IconButton({
  label,
  hint = label,
  tone = 'neutral',
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  tone?: keyof typeof ICON_BUTTON_HOVER;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint}
      onClick={onClick}
      className={`inline-flex size-8 items-center justify-center rounded-lg border border-edge text-ink-dim hover:bg-paper-raised dark:border-edge-dark dark:text-ink-dim-dark dark:hover:bg-paper-raised-dark ${ICON_BUTTON_HOVER[tone]}`}
    >
      {children}
    </button>
  );
}
