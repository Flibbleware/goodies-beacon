import { useQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { type CategoryRow, categoriesQuery } from '../api/categories.js';
import { type ItemRow, itemsQuery } from '../api/items.js';
import { DECISION_INK } from '../candidates/bits.js';
import {
  CategoryFilter,
  choiceName,
  inChoice,
  knownChoice,
} from '../components/category-filter.js';
import { CategoryCover, CategoryIcon } from '../components/category-icon.js';
import { LastPoll } from '../components/last-poll.js';
import { Pill } from '../components/pill.js';
import { CreateItemModal } from '../items/create-item.js';
import { appLayoutRoute } from './app-layout.js';

export interface ItemsSearch {
  /** A category's id, or `none` for the uncategorised. */
  category?: string | undefined;
  /** The Create dialog is open (P1-26): in the URL, so the dashboard can link straight to it. */
  create?: true | undefined;
}

export const itemsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/items',
  validateSearch: (search: Record<string, unknown>): ItemsSearch => ({
    category: typeof search.category === 'string' ? search.category : undefined,
    create: search.create === true ? true : undefined,
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(itemsQuery),
      context.queryClient.ensureQueryData(categoriesQuery),
    ]),
  component: Items,
});

/**
 * §14's list: status, last poll and counts, newest change first — filterable by category with the
 * wish list's chips (P1-20, P1-22). Each item is a card headed by its display image, or its
 * category's tile grown to fill the space, so the page reads as a shelf rather than as the wish
 * list's rows (P1-25).
 */
function Items() {
  const search = itemsRoute.useSearch();
  const navigate = useNavigate({ from: '/items' });
  const { data, isPending, isError } = useQuery(itemsQuery);
  const categories = useQuery(categoriesQuery).data?.categories ?? [];
  const category = knownChoice(categories, search.category);
  const all = data?.items ?? [];
  const items = all.filter((item) => inChoice(item.categoryId, category));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Wanted Items</h1>
        {/* The heading says what is created; the name says it too, for a reader without it. */}
        <Link
          to="/items"
          search={(prev) => ({ ...prev, create: true })}
          aria-label="Create a wanted item"
          className="rounded-lg bg-beacon px-4 py-2 text-sm font-medium text-white"
        >
          Create
        </Link>
      </div>

      <CreateItemModal
        open={search.create === true}
        onClose={() =>
          void navigate({ search: (prev) => ({ ...prev, create: undefined }), replace: true })
        }
      />

      {all.length > 0 ? (
        <div className="mt-6">
          <CategoryFilter
            categories={categories}
            items={all}
            current={category}
            link={({ category: chosen, active, className, children }) => (
              <Link
                to="/items"
                search={{ category: chosen }}
                aria-current={active ? 'true' : undefined}
                className={className}
              >
                {children}
              </Link>
            )}
          />
        </div>
      ) : null}

      {isPending ? (
        <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          Could not load the wanted items.
        </p>
      ) : null}

      {data && all.length > 0 && items.length === 0 && category ? (
        <div className="mt-4 rounded-xl border border-dashed border-edge p-8 text-center dark:border-edge-dark">
          <p className="text-sm text-ink-dim dark:text-ink-dim-dark">
            No wanted items in {choiceName(categories, category)}.
          </p>
        </div>
      ) : null}

      {data && all.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-edge p-10 text-center dark:border-edge-dark">
          <p className="font-medium">No wanted items yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim dark:text-ink-dim-dark">
            Describe what you are hunting for as a spec and Goodies Beacon will start looking. The
            chat interview arrives in Phase 3; until then you fill the spec in yourself.
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul
          aria-label="Wanted items"
          className="mt-4 grid grid-cols-1 gap-4 min-[30rem]:grid-cols-2 sm:grid-cols-3"
        >
          {items.map((item) => (
            <li key={item.id}>
              <Card
                item={item}
                category={categories.find((category) => category.id === item.categoryId)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The title is the link and its `after` box stretches over the card, so the whole card is a target
 * while the link's accessible name stays the title rather than every word on the card.
 */
function Card({ item, category }: { item: ItemRow; category: CategoryRow | undefined }) {
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-xl border border-edge bg-paper-raised hover:border-ink-dim/40 dark:border-edge-dark dark:bg-paper-raised-dark dark:hover:border-ink-dim-dark/40">
      {/* Overflow hidden is what holds the ratio: an aspect-ratio box grows to fit its content. */}
      <div className="relative aspect-[4/3] overflow-hidden border-b border-edge dark:border-edge-dark">
        {item.displayImageId ? (
          <CardPicture src={`/api/media/${item.displayImageId}`} />
        ) : (
          <CategoryCover category={category} />
        )}
        {category ? (
          // Frosted and sized to its words, so it names the category without hiding the picture.
          <span className="absolute left-2 top-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-paper-raised/80 px-2 py-0.5 text-xs font-medium shadow-sm backdrop-blur-sm dark:bg-paper-raised-dark/80">
            <CategoryIcon category={category} size="size-3.5" />
            <span className="truncate">{category.name}</span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <Link
          to="/items/$itemId"
          params={{ itemId: item.id }}
          className="line-clamp-2 h-[2lh] text-sm font-medium after:absolute after:inset-0 hover:underline"
        >
          {item.title}
        </Link>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Pill>{item.status}</Pill>
          <Pill>{item.notificationMode === 'realtime' ? 'Real-time email' : 'Daily digest'}</Pill>
        </div>

        <p className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs">
          <Count value={item.counts.matched} label="matched" ink={DECISION_INK.match} />
          <Count value={item.counts.uncertain} label="uncertain" ink={DECISION_INK.uncertain} />
          {item.counts.pending > 0 ? (
            <Count value={item.counts.pending} label="waiting" ink={DECISION_INK.pending} />
          ) : null}
        </p>
        <p className="text-xs text-ink-dim dark:text-ink-dim-dark">
          <LastPoll poll={item} />
        </p>
      </div>
    </article>
  );
}

/**
 * The whole picture, never cropped, over a blurred and enlarged copy of itself that fills the
 * frame — so a portrait box and a landscape photo sit in cards of one height with nothing cut off
 * and no bare bars beside them. The browser fetches the file once for both.
 */
function CardPicture({ src }: { src: string }) {
  return (
    <>
      <img
        src={src}
        alt=""
        loading="lazy"
        aria-hidden="true"
        className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-xl"
      />
      <img
        src={src}
        alt=""
        loading="lazy"
        className="absolute inset-0 size-full object-contain drop-shadow-md"
      />
    </>
  );
}

/** Coloured only when there is something to see, so a column of zeros does not shout. */
function Count({ value, label, ink }: { value: number; label: string; ink: string }) {
  return (
    <span className={value > 0 ? `font-medium ${ink}` : 'text-ink-dim dark:text-ink-dim-dark'}>
      {value} {label}
    </span>
  );
}
