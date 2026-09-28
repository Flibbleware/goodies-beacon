import { type CountryCode, countryName } from '@goodies-beacon/core/schemas';
import { useId, useMemo, useState } from 'react';
import { matchCountries } from './countries.js';
import { CONTROL } from './form.js';

/**
 * A searchable list of countries, the chosen ones as chips (P1-35). A combobox in the ARIA
 * pattern's sense: the arrow keys move through the matches, Enter takes one, Escape closes the
 * list, and Backspace in an empty box removes the last chip.
 */
export function CountryPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: readonly CountryCode[];
  onChange: (codes: CountryCode[]) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const matches = useMemo(() => matchCountries(query, value), [query, value]);
  const open = focused && matches.length > 0;

  const pick = (code: CountryCode) => {
    onChange([...value, code]);
    setQuery('');
    setActive(0);
  };

  return (
    <div>
      {value.length > 0 ? (
        <ul aria-label="Excluded countries" className="mt-2 flex flex-wrap gap-1.5">
          {value.map((code) => (
            <li
              key={code}
              className="inline-flex items-center gap-1 rounded-full border border-edge py-0.5 pr-1 pl-2.5 text-xs dark:border-edge-dark"
            >
              {countryName(code)}
              <button
                type="button"
                aria-label={`Remove ${countryName(code)}`}
                onClick={() => onChange(value.filter((chosen) => chosen !== code))}
                className="rounded-full px-1 text-ink-dim hover:text-ink dark:text-ink-dim-dark dark:hover:text-ink-dark"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Type a country, e.g. Japan"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && open) {
              event.preventDefault();
              setActive((active + 1) % matches.length);
            } else if (event.key === 'ArrowUp' && open) {
              event.preventDefault();
              setActive((active - 1 + matches.length) % matches.length);
            } else if (event.key === 'Enter' && open) {
              // Taking a country, not submitting the dialog the picker sits in.
              event.preventDefault();
              const chosen = matches[active];
              if (chosen) pick(chosen.code);
            } else if (event.key === 'Escape' && query !== '') {
              // Clearing the search, not closing the dialog the picker sits in.
              event.preventDefault();
              event.stopPropagation();
              setQuery('');
            } else if (event.key === 'Backspace' && query === '' && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          className={CONTROL}
        />
        {open ? (
          <div
            id={listId}
            role="listbox"
            aria-label="Countries"
            // In the flow rather than floating: the picker sits in a dialog that scrolls, whose
            // footer would draw over a list hanging below the last field.
            className="mt-1 max-h-64 overflow-auto rounded-lg border border-edge bg-paper-raised py-1 text-sm dark:border-edge-dark dark:bg-paper-raised-dark"
          >
            {matches.map((country, index) => (
              <div
                key={country.code}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                // Chosen on mouse down, before the input's blur can take the list away.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(country.code);
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer justify-between px-3 py-1.5 ${
                  index === active ? 'bg-edge/60 dark:bg-edge-dark/60' : ''
                }`}
              >
                {country.name}
                <span className="font-mono text-xs text-ink-dim dark:text-ink-dim-dark">
                  {country.code}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
