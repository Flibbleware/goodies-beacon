import type {
  CategoryColour,
  CategoryIcon as CategoryIconName,
} from '@goodies-beacon/core/schemas';
import type { ReactNode } from 'react';

/**
 * The shapes and hues a category is drawn with (P1-19, P1-22), inline rather than from an icon
 * package: seventeen shapes do not earn a dependency. Decorative — every use sits beside the
 * category's name.
 */
const PATHS: Record<CategoryIconName, ReactNode> = {
  // A gamepad: body, d-pad, two buttons.
  gamepad: (
    <>
      <rect x="2" y="7" width="20" height="11" rx="5.5" />
      <path d="M7 10.5v4M5 12.5h4" />
      <circle cx="15.5" cy="11.5" r="0.75" fill="currentColor" />
      <circle cx="17.5" cy="13.5" r="0.75" fill="currentColor" />
    </>
  ),
  // A disc with its hub and a highlight.
  disc: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 6a6 6 0 0 1 6 6" />
    </>
  ),
  // A cassette: shell, two reels, the tape window between them.
  cassette: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="12" r="2" />
      <path d="M10 12h4M7 18l1.5-2.5h7L17 18" />
    </>
  ),
  // A toy robot: head, antenna, eyes, mouth.
  robot: (
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
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  heart: (
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z" />
  ),
  // A parcel: the box and the fold of its lid.
  box: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  // Two quavers on a beam.
  music: (
    <>
      <path d="M9 17.5V5.5l10-2v12" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8.5 7 10 4h4l1.5 3" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  // A cut stone: crown, girdle and the facets down to the point.
  gem: (
    <>
      <path d="M6.5 4h11L21 9l-9 11L3 9z" />
      <path d="M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z" />
    </>
  ),
  tag: (
    <>
      <path d="M3 11.5V4h7.5L21 14.5 14.5 21z" />
      <circle cx="7.5" cy="8.5" r="1.25" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="6" />
      <path d="M12 9.5v5" />
    </>
  ),
  shirt: <path d="M8.5 3.5 3.5 6.5l2 4 2.5-1.2V20.5h8V9.3l2.5 1.2 2-4-5-3a3.5 3.5 0 0 1-7 0z" />,
};

/**
 * Each hue clear of the red that means an error elsewhere in the app. Only the icon is coloured,
 * never text, so a blue category is not read as a button. Copper is the theme's own (styles.css),
 * because Tailwind has nothing between orange and red. Written out whole so Tailwind finds every
 * class.
 */
const COLOURS: Record<CategoryColour, { ink: string; tile: string; swatch: string }> = {
  violet: {
    ink: 'text-violet-600 dark:text-violet-400',
    tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    swatch: 'bg-violet-500',
  },
  indigo: {
    ink: 'text-indigo-600 dark:text-indigo-400',
    tile: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    swatch: 'bg-indigo-500',
  },
  blue: {
    ink: 'text-blue-600 dark:text-blue-400',
    tile: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    swatch: 'bg-blue-500',
  },
  cyan: {
    ink: 'text-cyan-600 dark:text-cyan-400',
    tile: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
    swatch: 'bg-cyan-500',
  },
  teal: {
    ink: 'text-teal-600 dark:text-teal-400',
    tile: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
    swatch: 'bg-teal-500',
  },
  green: {
    ink: 'text-green-600 dark:text-green-400',
    tile: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
    swatch: 'bg-green-500',
  },
  amber: {
    ink: 'text-amber-600 dark:text-amber-400',
    tile: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    swatch: 'bg-amber-500',
  },
  orange: {
    ink: 'text-orange-600 dark:text-orange-400',
    tile: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
    swatch: 'bg-orange-500',
  },
  copper: {
    ink: 'text-copper-600 dark:text-copper-400',
    tile: 'bg-copper-100 text-copper-800 dark:bg-copper-500/20 dark:text-copper-300',
    swatch: 'bg-copper-500',
  },
  pink: {
    ink: 'text-pink-600 dark:text-pink-400',
    tile: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
    swatch: 'bg-pink-500',
  },
  fuchsia: {
    ink: 'text-fuchsia-600 dark:text-fuchsia-400',
    tile: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
    swatch: 'bg-fuchsia-500',
  },
  slate: {
    ink: 'text-slate-500 dark:text-slate-400',
    tile: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
    swatch: 'bg-slate-500',
  },
};

/** What a category looks like; null is uncategorised. */
export type CategoryLook = { icon: CategoryIconName; colour: CategoryColour } | null | undefined;

/** The bare icon in its category's colour, for somewhere small such as a filter chip. */
export function CategoryIcon({
  category,
  size = 'size-5',
}: {
  category: CategoryLook;
  size?: string;
}) {
  if (!category) return null;
  return <Glyph icon={category.icon} className={`${size} ${COLOURS[category.colour].ink}`} />;
}

/**
 * The icon large, on a tile tinted with its category's colour: how a wish or an item is shown in
 * its list. Uncategorised is an empty dashed tile, so the rows still line up.
 */
export function CategoryTile({
  category,
  size = 'size-12',
}: {
  category: CategoryLook;
  size?: string;
}) {
  if (!category) {
    return (
      <span
        className={`inline-flex ${size} shrink-0 rounded-xl border border-dashed border-edge dark:border-edge-dark`}
      />
    );
  }
  return (
    <span
      className={`inline-flex ${size} shrink-0 items-center justify-center rounded-xl ${COLOURS[category.colour].tile}`}
    >
      <Glyph icon={category.icon} className="size-7" />
    </span>
  );
}

/**
 * The tile grown to fill whatever holds it: a wanted item's card when it has no display image
 * (P1-25). Uncategorised is a plain grey panel, as the small tile is an empty one.
 */
export function CategoryCover({ category }: { category: CategoryLook }) {
  if (!category) {
    return <span className="block size-full bg-edge/60 dark:bg-edge-dark/60" />;
  }
  return (
    <span className={`flex size-full items-center justify-center ${COLOURS[category.colour].tile}`}>
      <Glyph icon={category.icon} className="size-16" />
    </span>
  );
}

/** A plain dot of the colour, for the colour picker. */
export function ColourSwatch({ colour }: { colour: CategoryColour }) {
  return <span className={`inline-block size-5 rounded-full ${COLOURS[colour].swatch}`} />;
}

export function Glyph({ icon, className }: { icon: CategoryIconName; className: string }) {
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
      {PATHS[icon]}
    </svg>
  );
}
