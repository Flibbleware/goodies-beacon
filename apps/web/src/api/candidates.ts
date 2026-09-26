import type {
  CandidateDetail,
  CandidateFilter,
  CandidateRow,
  ListingView,
  VerdictView,
} from '@goodies-beacon/core/schemas';
import { api } from './client.js';

/** The wire shapes: JSON carries timestamps as ISO strings, not Dates. */
export type ListingLike = Omit<ListingView, 'listedAt' | 'endsAt'> & {
  listedAt: string | null;
  endsAt: string | null;
};

export type CandidateRowLike = Omit<CandidateRow, 'createdAt' | 'listing'> & {
  createdAt: string;
  listing: ListingLike;
};

export type VerdictLike = Omit<VerdictView, 'createdAt'> & { createdAt: string };

export type CandidateDetailLike = Omit<CandidateDetail, 'createdAt' | 'listing' | 'verdicts'> & {
  createdAt: string;
  listing: ListingLike;
  verdicts: VerdictLike[];
};

export interface CandidateListResponse {
  candidates: CandidateRowLike[];
  total: number;
  filter: CandidateFilter;
}

/** What the page puts in the URL. Everything else takes the schema's default. */
export interface CandidateSearch {
  item?: string | undefined;
  decision?: CandidateFilter['decision'] | undefined;
  origin?: CandidateFilter['origin'] | undefined;
  /** Absent is today, the page's default, so the plain URL is today's list (P1-25). */
  from?: 'all' | undefined;
  offset?: number | undefined;
}

export const PAGE_SIZE = 50;

function queryString(search: CandidateSearch): string {
  const params = new URLSearchParams();
  if (search.item) params.set('wantedItemId', search.item);
  if (search.decision && search.decision !== 'all') params.set('decision', search.decision);
  if (search.origin && search.origin !== 'all') params.set('origin', search.origin);
  // The API's default is everything, for links written before the filter; the page's is today.
  params.set('from', search.from ?? 'today');
  if (search.offset) params.set('offset', String(search.offset));
  params.set('limit', String(PAGE_SIZE));
  return params.toString();
}

export const candidatesQuery = (search: CandidateSearch) =>
  ({
    queryKey: ['candidates', search] as const,
    queryFn: () => api<CandidateListResponse>(`/api/candidates?${queryString(search)}`),
  }) as const;

export const candidateQuery = (id: string) =>
  ({
    queryKey: ['candidate', id] as const,
    queryFn: () => api<{ candidate: CandidateDetailLike }>(`/api/candidates/${id}`),
  }) as const;

export function setRetain(id: string, retain: boolean): Promise<{ retain: boolean }> {
  return api(`/api/candidates/${id}`, { method: 'PATCH', body: { retain } });
}
