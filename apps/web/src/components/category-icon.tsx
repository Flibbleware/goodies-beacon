import type { ItemCategory } from '@goodies-beacon/core/schemas';
import type { ReactNode } from 'react';

/**
 * One line-drawn icon per wish category (P1-19), inline rather than from an icon package: seven
 * shapes do not earn a dependency. Decorative — every use sits beside the category's name.
 */
const PATHS: Record<ItemCategory, ReactNode> = {
  // A gamepad: body, d-pad, two buttons.
  game: (
    <>
      <rect x="2" y="7" width="20" height="11" rx="5.5" />
      <path d="M7 10.5v4M5 12.5h4" />
      <circle cx="15.5" cy="11.5" r="0.75" fill="currentColor" />
      <circle cx="17.5" cy="13.5" r="0.75" fill="currentColor" />
    </>
  ),
  // A disc with its hub and a highlight.
  dvd: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 6a6 6 0 0 1 6 6" />
    </>
  ),
  // A cassette: shell, two reels, the tape window between them.
  vhs: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="12" r="2" />
      <path d="M10 12h4M7 18l1.5-2.5h7L17 18" />
    </>
  ),
  // A toy robot: head, antenna, eyes, mouth.
  toy: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M12 8V5.5" />
      <circle cx="12" cy="4.5" r="1" />
      <circle cx="9.5" cy="12.5" r="1" fill="currentColor" />
      <circle cx="14.5" cy="12.5" r="1" fill="currentColor" />
      <path d="M10 16h4" />
    </>
  ),
  // A figure standing on a plinth.
  figurine: (
    <>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 6.5v6M8.5 9.5h7M12 12.5l-2.5 4.5M12 12.5l2.5 4.5" />
      <rect x="6" y="18" width="12" height="3" rx="1" />
    </>
  ),
  // An open book: two pages either side of the spine.
  book: (
    <>
      <path d="M12 7v13" />
      <path d="M12 7c-1.6-1.3-4.2-2-7-2v12.5c2.8 0 5.4.7 7 2.5" />
      <path d="M12 7c1.6-1.3 4.2-2 7-2v12.5c-2.8 0-5.4.7-7 2.5" />
    </>
  ),
  // A star, for a wish that is none of the above.
  other: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
};

/**
 * A hue per category, clear of the red that means an error elsewhere in the app. Only the icon is
 * coloured, never text, so VHS's blue is not read as a button. Figurine's copper is the theme's own
 * (styles.css), because Tailwind has nothing between Book's orange and red.
 * Written out whole so Tailwind finds every class.
 */
const COLOURS: Record<ItemCategory, { ink: string; tile: string }> = {
  game: {
    ink: 'text-violet-600 dark:text-violet-400',
    tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
  dvd: {
    ink: 'text-teal-600 dark:text-teal-400',
    tile: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  },
  vhs: {
    ink: 'text-blue-600 dark:text-blue-400',
    tile: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  },
  toy: {
    ink: 'text-pink-600 dark:text-pink-400',
    tile: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  },
  figurine: {
    ink: 'text-copper-600 dark:text-copper-400',
    tile: 'bg-copper-100 text-copper-800 dark:bg-copper-500/20 dark:text-copper-300',
  },
  book: {
    ink: 'text-orange-600 dark:text-orange-400',
    tile: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  },
  other: {
    ink: 'text-slate-500 dark:text-slate-400',
    tile: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
  },
};

/** The bare icon in its category's colour, for somewhere small such as a filter chip. */
export function CategoryIcon({
  category,
  size = 'size-5',
}: {
  category: ItemCategory;
  size?: string;
}) {
  return <Glyph category={category} className={`${size} ${COLOURS[category].ink}`} />;
}

/** The icon large, on a tile tinted with its category's colour: how a wish is shown in the list. */
export function CategoryTile({ category }: { category: ItemCategory }) {
  return (
    <span
      className={`inline-flex size-12 shrink-0 items-center justify-center rounded-xl ${COLOURS[category].tile}`}
    >
      <Glyph category={category} className="size-7" />
    </span>
  );
}

function Glyph({ category, className }: { category: ItemCategory; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[category]}
    </svg>
  );
}
