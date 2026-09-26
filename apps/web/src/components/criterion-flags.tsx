import type { CriterionKind, OnUnknown } from '@goodies-beacon/core/schemas';

/** What a fail or an unknown leads to: red wherever it rejects, amber wherever it is uncertain. */
const OUTCOME_TEXT = {
  reject: 'text-red-600 dark:text-red-400',
  uncertain: 'text-amber-600 dark:text-amber-400',
} as const;

const PLAIN_TEXT = 'text-ink dark:text-ink-dark';

/**
 * A criterion's three flags as label and value — on an item, and on a shared criterion, where a
 * null is a flag it leaves to each item (P1-27).
 */
export function CriterionFlags({
  kind,
  onUnknown,
  quantifiable,
}: {
  kind: CriterionKind | null;
  onUnknown: OnUnknown | null;
  quantifiable: boolean | null;
}) {
  return (
    <>
      {kind === null ? (
        <Flag label="Failure" hint="Each item that uses it chooses">
          {null}
        </Flag>
      ) : (
        <Flag
          label="Failure"
          hint={
            kind === 'hard'
              ? 'A listing that fails this is rejected'
              : 'A listing that fails this is uncertain, so you still see it'
          }
          className={OUTCOME_TEXT[kind === 'hard' ? 'reject' : 'uncertain']}
        >
          {kind === 'hard' ? 'Reject' : 'Uncertain'}
        </Flag>
      )}
      {onUnknown === null ? (
        <Flag label="Unknown" hint="Each item that uses it chooses">
          {null}
        </Flag>
      ) : (
        <Flag
          label="Unknown"
          hint="What happens when the listing neither shows nor says"
          className={OUTCOME_TEXT[onUnknown === 'reject' ? 'reject' : 'uncertain']}
        >
          {onUnknown === 'reject' ? 'Reject' : 'Uncertain'}
        </Flag>
      )}
      {quantifiable === null ? (
        <Flag label="Photos" hint="Each item that uses it chooses">
          {null}
        </Flag>
      ) : (
        <Flag
          label="Photos"
          hint={
            quantifiable
              ? 'The photos or the description can settle it definitively'
              : 'The photos may not be able to settle it'
          }
          className={PLAIN_TEXT}
        >
          {quantifiable ? 'Can settle' : "Can't settle"}
        </Flag>
      )}
    </>
  );
}

/** One flag: a dim label, then its value — or, with none, that each item chooses. */
function Flag({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint: string;
  className?: string;
  children: string | null;
}) {
  return (
    <span title={hint} className="text-xs text-ink-dim dark:text-ink-dim-dark">
      {label}:{' '}
      {children === null ? (
        <span className="italic">Item chooses</span>
      ) : (
        <span className={`font-medium ${className}`}>{children}</span>
      )}
    </span>
  );
}
