import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import {
  type CandidateDetailLike,
  candidateQuery,
  setRetain,
  type VerdictLike,
} from '../api/candidates.js';
import { ApiError } from '../api/client.js';
import { DecisionChip, Provenance, price, REJECTION_REASONS } from '../candidates/bits.js';
import { Alert, Button } from '../components/form.js';
import { appLayoutRoute } from './app-layout.js';

export const candidateRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/candidates/$candidateId',
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(candidateQuery(params.candidateId)),
  component: CandidatePage,
});

/**
 * One candidate, with the verdict's reasoning laid out (§8, "nothing is a black box").
 *
 * Built narrow-first because the digest emails link here and are read on a phone: one column,
 * no table, the gallery scrolls sideways, and nothing needs a wide viewport to be usable.
 */
function CandidatePage() {
  const { candidateId } = candidateRoute.useParams();
  const { data } = useQuery(candidateQuery(candidateId));

  if (!data) return null;
  const candidate = data.candidate;
  const [latest] = candidate.verdicts;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/candidates"
        search={{ item: candidate.wantedItemId }}
        className="text-sm text-ink-dim hover:underline dark:text-ink-dim-dark"
      >
        ← {candidate.itemTitle}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <DecisionChip decision={latest?.decision ?? null} />
        {candidate.relistOf ? (
          <span className="text-[0.625rem] uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark">
            Seen before
          </span>
        ) : null}
        <span className="text-xs text-ink-dim dark:text-ink-dim-dark">
          Found {new Date(candidate.createdAt).toLocaleString()} · {candidate.origin}
          {candidate.specVersion === null ? '' : ` · judged on version ${candidate.specVersion}`}
        </span>
      </div>

      <h1 className="mt-2 text-xl font-semibold tracking-tight">
        {candidate.listing.titleEn ?? candidate.listing.title}
      </h1>
      {candidate.listing.titleEn ? (
        <p className="mt-1 text-sm text-ink-dim dark:text-ink-dim-dark">
          {candidate.listing.title}
        </p>
      ) : null}

      <p className="mt-1 text-sm text-ink-dim dark:text-ink-dim-dark">
        {price(candidate.listing)} · <Provenance listing={candidate.listing} />
      </p>

      {candidate.stage === 'failed' ? (
        <Alert tone="error">
          This candidate's review failed and will be retried: {candidate.error}
        </Alert>
      ) : null}

      <Actions candidate={candidate} />
      <Gallery images={candidate.listing.images} alt={candidate.listing.title} />

      {latest ? <Verdict verdict={latest} /> : <NotYetJudged stage={candidate.stage} />}

      <Description listing={candidate.listing} />

      {candidate.verdicts.length > 1 ? (
        <section className="mt-8">
          <h2 className="font-medium">Earlier verdicts</h2>
          {candidate.verdicts.slice(1).map((verdict) => (
            <Verdict key={verdict.id} verdict={verdict} earlier />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Actions({ candidate }: { candidate: CandidateDetailLike }) {
  const queryClient = useQueryClient();

  const retain = useMutation({
    mutationFn: () => setRetain(candidate.id, !candidate.retain),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: candidateQuery(candidate.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  return (
    <>
      {retain.isError ? (
        <Alert tone="error">
          {retain.error instanceof ApiError ? retain.error.message : 'Could not change it.'}
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={candidate.listing.url}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-lg bg-beacon px-4 py-2 text-sm font-medium text-white"
        >
          Open the listing
        </a>

        {/* §13: a retained candidate survives the nightly sweep, whatever the retention period. */}
        <Button
          type="button"
          variant="quiet"
          onClick={() => retain.mutate()}
          disabled={retain.isPending}
        >
          {candidate.retain ? 'Stop retaining' : 'Retain'}
        </Button>

        {/* The challenge loop is Phase 5: a note re-reviews and can be folded into the spec (§1). */}
        <span title="Arrives in Phase 5" className="flex gap-3">
          <Button type="button" variant="quiet" disabled>
            Not a match
          </Button>
          <Button type="button" variant="quiet" disabled>
            Challenge
          </Button>
        </span>
      </div>
    </>
  );
}

/**
 * Horizontally scrolling on a phone and wrapping above it, so the photographs never force the
 * page wider than the screen.
 */
function Gallery({ images, alt }: { images: string[]; alt: string }) {
  if (images.length === 0) {
    return (
      <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">
        No photographs were stored for this listing.
      </p>
    );
  }

  return (
    <ul className="-mx-6 mt-6 flex snap-x gap-3 overflow-x-auto px-6 pb-2 md:mx-0 md:flex-wrap md:px-0">
      {images.map((mediaId, index) => (
        <li key={mediaId} className="snap-start">
          <a href={`/api/media/${mediaId}`} target="_blank" rel="noreferrer noopener">
            <img
              src={`/api/media/${mediaId}`}
              alt={`${alt} (${index + 1} of ${images.length})`}
              loading={index === 0 ? 'eager' : 'lazy'}
              className="h-48 w-auto max-w-none rounded-lg border border-edge object-cover dark:border-edge-dark"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

function NotYetJudged({ stage }: { stage: string }) {
  return (
    <p className="mt-8 rounded-xl border border-dashed border-edge p-6 text-sm text-ink-dim dark:border-edge-dark dark:text-ink-dim-dark">
      {stage === 'failed'
        ? 'No verdict yet: the review failed and is being retried.'
        : 'No verdict yet. This candidate is still in the queue.'}
    </p>
  );
}

const RESULTS: Record<string, { label: string; className: string }> = {
  pass: { label: 'pass', className: 'text-emerald-700 dark:text-emerald-500' },
  fail: { label: 'fail', className: 'text-red-600 dark:text-red-400' },
  unknown: { label: 'unknown', className: 'text-amber-700 dark:text-amber-500' },
};

function Verdict({ verdict, earlier }: { verdict: VerdictLike; earlier?: boolean }) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={earlier ? undefined : headingId}
      className={earlier ? 'mt-4 opacity-70' : 'mt-8'}
    >
      {earlier ? null : (
        <h2 id={headingId} className="font-medium">
          Verdict
        </h2>
      )}

      <div className="mt-3 rounded-xl border border-edge p-5 dark:border-edge-dark">
        {earlier ? (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-dim dark:text-ink-dim-dark">
            <DecisionChip decision={verdict.decision} />
            {new Date(verdict.createdAt).toLocaleString()}
          </p>
        ) : null}

        {verdict.reason ? (
          <p className="text-sm">
            Rejected before the reviewer was called:{' '}
            {REJECTION_REASONS[verdict.reason] ?? verdict.reason}.
            {verdict.englishSummary ? ` ${verdict.englishSummary}` : ''}
          </p>
        ) : (
          <>
            {verdict.englishSummary ? <p className="text-sm">{verdict.englishSummary}</p> : null}

            {verdict.reasons.length > 0 ? (
              <ul className="mt-3 list-inside list-disc text-sm text-ink-dim dark:text-ink-dim-dark">
                {verdict.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}

            {verdict.criteriaResults.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {verdict.criteriaResults.map((entry) => {
                  const result = RESULTS[entry.result] ?? RESULTS.unknown;
                  return (
                    <li key={entry.criterionId}>
                      <p className="text-sm">
                        <span className={`font-medium ${result?.className}`}>{result?.label}</span>
                        {' — '}
                        {entry.criterion?.text ?? entry.criterionId}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-dim dark:text-ink-dim-dark">
                        {entry.evidence || 'No evidence was given.'}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {verdict.grade ? <p className="mt-4 text-sm">Grade: {verdict.grade}</p> : null}
          </>
        )}

        <p className="mt-4 text-xs text-ink-dim dark:text-ink-dim-dark">
          {verdict.model ? `Judged by ${verdict.model}` : 'No model was called'}
          {verdict.inputTokens === null
            ? ''
            : ` · ${verdict.inputTokens} in, ${verdict.outputTokens} out`}
          {verdict.costUsd === null ? '' : ` · $${Number(verdict.costUsd).toFixed(4)}`}
        </p>

        <Prompt verdict={verdict} />
      </div>
    </section>
  );
}

/**
 * "Show prompt" (§8): the exact text that was sent and the exact images, read back from the
 * verdict rather than rebuilt — a rebuild would show what we would send *now*, which is a
 * different answer whenever the template has changed since.
 */
function Prompt({ verdict }: { verdict: VerdictLike }) {
  const [open, setOpen] = useState(false);

  if (!verdict.promptText) return null;

  return (
    <div className="mt-4 border-t border-edge pt-4 dark:border-edge-dark">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-xs font-medium text-ink-dim underline dark:text-ink-dim-dark"
      >
        {open ? 'Hide prompt' : 'Show prompt'}
      </button>

      {open ? (
        <div className="mt-3">
          <pre className="max-h-96 overflow-auto rounded-lg border border-edge bg-paper p-3 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap dark:border-edge-dark dark:bg-paper-dark">
            {verdict.promptText}
          </pre>

          {verdict.promptImages.length > 0 ? (
            <>
              <p className="mt-3 text-xs text-ink-dim dark:text-ink-dim-dark">
                {verdict.promptImages.length} image
                {verdict.promptImages.length === 1 ? '' : 's'} were sent with it, in this order:
              </p>
              <ul className="mt-2 flex flex-wrap gap-3">
                {distinct(verdict.promptImages).map((image) => (
                  <li key={image.key} className="w-24">
                    <img
                      src={`/api/media/${image.mediaId}/thumb`}
                      alt={image.label || image.kind}
                      loading="lazy"
                      className="h-24 w-24 rounded-lg border border-edge object-cover dark:border-edge-dark"
                    />
                    <p className="mt-1 text-[0.625rem] text-ink-dim dark:text-ink-dim-dark">
                      {image.kind}
                      {image.label ? `: ${image.label}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-xs text-ink-dim dark:text-ink-dim-dark">
              No images were sent with it.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A key per image that survives the same photograph appearing twice.
 *
 * Media is deduplicated on the hash of its bytes, so a listing photo identical to the item's
 * reference photo is one row and one id — and both entries are in the prompt, in the order they
 * were sent, which is the thing worth showing.
 */
function distinct<T extends { mediaId: string }>(images: T[]): (T & { key: string })[] {
  const seen = new Map<string, number>();

  return images.map((image) => {
    const count = seen.get(image.mediaId) ?? 0;
    seen.set(image.mediaId, count + 1);
    return { ...image, key: count === 0 ? image.mediaId : `${image.mediaId}#${count}` };
  });
}

/**
 * The seller's own words, as text.
 *
 * It arrives here already stripped of markup at ingest (§12, `toPlainText`), and React renders it
 * as a string — so there is no `dangerouslySetInnerHTML` anywhere on this page and a description
 * stored before the cleaning existed still cannot do anything but be read.
 */
function Description({ listing }: { listing: CandidateDetailLike['listing'] }) {
  const text = listing.descriptionEn ?? listing.description;
  if (!text) return null;

  return (
    <section className="mt-8">
      <h2 className="font-medium">
        {listing.descriptionEn ? 'Description, in English' : 'Description'}
      </h2>
      <p className="mt-3 text-sm whitespace-pre-wrap text-ink-dim dark:text-ink-dim-dark">{text}</p>
    </section>
  );
}
