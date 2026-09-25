import { useId } from 'react';
import type { SpecParse } from './parse.js';

/**
 * The raw JSON editor from §17's "a manually-written spec (JSON in the UI, no interviewer yet)".
 *
 * A textarea rather than a code editor on purpose: the typed form of toggles and tables is Phase
 * 3's direct-editing work, and a syntax-highlighting dependency here would be thrown away when it
 * lands. What matters now is that a mistake is named where it is, which the parse result gives.
 */
export function SpecEditor({
  value,
  onChange,
  parsed,
  rows = 28,
}: {
  value: string;
  onChange: (text: string) => void;
  parsed: SpecParse;
  rows?: number;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        Spec
      </label>
      <p className="mt-1.5 text-xs text-ink-dim dark:text-ink-dim-dark">
        The wanted spec as JSON: settings, criteria, search plans and reference images. Checked as
        you type against the same schema the server uses.
      </p>

      <textarea
        id={id}
        name="spec"
        spellCheck={false}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-edge bg-paper p-3 font-mono text-xs leading-relaxed outline-none focus:border-beacon dark:border-edge-dark dark:bg-paper-dark"
      />

      {parsed.ok ? null : (
        <div role="alert" className="mt-3 rounded-lg border border-red-300 p-3 dark:border-red-900">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            {parsed.issues.length === 1
              ? 'One problem stops this saving:'
              : `${parsed.issues.length} problems stop this saving:`}
          </p>
          <ul className="mt-2 space-y-1">
            {parsed.issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`} className="text-xs">
                <code className="font-mono font-medium">{issue.path}</code>{' '}
                <span className="text-ink-dim dark:text-ink-dim-dark">{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Always a box, so the textarea does not jump as the document goes valid and back. */}
      {parsed.ok && parsed.warnings.length === 0 ? (
        <div
          role="status"
          className="mt-3 rounded-lg border border-emerald-300 p-3 dark:border-emerald-900"
        >
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            No problems found
          </p>
          <p className="mt-2 text-xs text-ink-dim dark:text-ink-dim-dark">
            Valid JSON, and a spec the server will accept.
          </p>
        </div>
      ) : null}

      {parsed.ok && parsed.warnings.length > 0 ? (
        <div
          role="status"
          className="mt-3 rounded-lg border border-amber-300 p-3 dark:border-amber-900"
        >
          <p className="text-sm font-medium">
            {parsed.warnings.length === 1 ? 'One thing worth a look' : 'Worth a look'} — this still
            saves:
          </p>
          <ul className="mt-2 space-y-1">
            {parsed.warnings.map((warning) => (
              <li key={warning.criterionId} className="text-xs">
                <code className="font-mono font-medium">{warning.criterionId}</code>{' '}
                <span className="text-ink-dim dark:text-ink-dim-dark">{warning.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
