import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef } from 'react';
import {
  BellIcon,
  CriteriaIcon,
  DetailsIcon,
  EditIcon,
  ImageIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from '../components/icons.js';

export const ITEM_TABS = {
  details: 'Details',
  'search-plans': 'Search Plans',
  criteria: 'Criteria',
  settings: 'Settings',
  notifications: 'Notifications',
  images: 'Images',
} as const;

export type ItemTabId = keyof typeof ITEM_TABS;

const TAB_ICONS: Record<ItemTabId, typeof DetailsIcon> = {
  details: DetailsIcon,
  'search-plans': SearchIcon,
  criteria: CriteriaIcon,
  settings: SettingsIcon,
  notifications: BellIcon,
  images: ImageIcon,
};

export function isItemTab(value: unknown): value is ItemTabId {
  return typeof value === 'string' && Object.hasOwn(ITEM_TABS, value);
}

export interface ItemTab {
  id: ItemTabId;
  /** What the section still needs before the item can poll (P1-26): a red mark on its tab. */
  flag?: string | undefined;
  /** The section's editor, or for one edited an entry at a time, what adds an entry. */
  action?: { kind: 'edit' | 'add'; label: string; onClick: () => void } | undefined;
  content: ReactNode;
}

/**
 * The item page's sections as tabs (P1-28), one panel showing at a time, following the ARIA tabs
 * pattern: one tab stop for the strip, the arrow keys, Home and End moving between tabs and
 * selecting as they go.
 *
 * The strip scrolls sideways within itself when it is wider than the page, as it is on a phone, and
 * keeps the selected tab in view.
 */
export function ItemTabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: readonly ItemTab[];
  selected: ItemTabId;
  /** `keyboard` is an arrow key stepping along the strip rather than a choice of tab. */
  onSelect: (id: ItemTabId, how: 'click' | 'keyboard') => void;
}) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];

  useLayoutEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>(`[data-tab="${selected}"]`);
    if (!list || !tab) return;
    // Not `scrollIntoView`, which would also scroll the page to bring the strip into view.
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [selected]);

  if (!current) return null;

  const onKeyDown = (event: KeyboardEvent) => {
    const index = tabs.indexOf(current);
    const target = {
      ArrowRight: tabs[(index + 1) % tabs.length],
      ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length],
      Home: tabs[0],
      End: tabs[tabs.length - 1],
    }[event.key];
    if (!target) return;
    event.preventDefault();
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus();
    onSelect(target.id, 'keyboard');
  };

  return (
    <div className="mt-8">
      {/* The baseline is drawn here rather than on the strip, which reaches a little past the page
          on either side so that a tab's focus ring is not clipped by its scrolling. */}
      <div className="shadow-[inset_0_-1px_0_var(--color-edge)] dark:shadow-[inset_0_-1px_0_var(--color-edge-dark)]">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Sections"
          onKeyDown={onKeyDown}
          className="relative -mx-1 flex gap-4 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const isSelected = tab.id === current.id;
            const TabIcon = TAB_ICONS[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${baseId}-${tab.id}`}
                data-tab={tab.id}
                aria-selected={isSelected}
                aria-controls={isSelected ? `${baseId}-panel` : undefined}
                aria-describedby={tab.flag ? `${baseId}-${tab.id}-flag` : undefined}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelect(tab.id, 'click')}
                className={`group shrink-0 rounded-sm px-1 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-beacon ${
                  isSelected
                    ? 'text-ink dark:text-ink-dark'
                    : // Softened body text rather than the dim grey, which reads as disabled here.
                      'text-ink/70 hover:text-ink dark:text-ink-dark/70 dark:hover:text-ink-dark'
                }`}
              >
                {/* The underline is the label's width, not the padded button's. */}
                <span
                  className={`flex items-center gap-1.5 border-b-2 py-2 ${
                    isSelected
                      ? 'border-beacon'
                      : 'border-transparent group-hover:border-edge dark:group-hover:border-edge-dark'
                  }`}
                >
                  <TabIcon className="size-4 shrink-0" />
                  {ITEM_TABS[tab.id]}
                  {tab.flag ? (
                    <span
                      aria-hidden="true"
                      title={tab.flag}
                      className="inline-flex size-4.5 items-center justify-center rounded-full bg-red-600 text-[0.6875rem] font-bold text-white dark:bg-red-500"
                    >
                      !
                    </span>
                  ) : null}
                </span>
                {tab.flag ? (
                  <span id={`${baseId}-${tab.id}-flag`} hidden>
                    Needed before polling. {tab.flag}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-${current.id}`}>
        {current.flag || current.action ? (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <p className="min-w-0 flex-1 basis-64 text-sm text-red-700 dark:text-red-400">
              {current.flag}
            </p>
            {current.action ? (
              <PanelAction
                kind={current.action.kind}
                label={current.action.label}
                onClick={current.action.onClick}
              />
            ) : null}
          </div>
        ) : null}
        {current.content}
      </div>
    </div>
  );
}

/** A section's editor, opened from the top of its panel or, in Settings, beside each group. */
export function PanelAction({
  kind,
  label,
  onClick,
}: {
  kind: 'edit' | 'add';
  label: string;
  onClick: () => void;
}) {
  const Icon = kind === 'add' ? PlusIcon : EditIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm font-medium hover:bg-paper-raised dark:border-edge-dark dark:hover:bg-paper-raised-dark"
    >
      <Icon />
      {label}
    </button>
  );
}
