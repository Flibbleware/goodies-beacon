/**
 * @goodies-beacon/ai — every model call in Goodies Beacon goes through here.
 *
 * P0-01 scaffold: role names only. Provider factory, prompts and the cost ledger arrive in P1-08.
 */
export const AI_ROLES = ['interviewer', 'prefilter', 'reviewer'] as const;
export type AiRole = (typeof AI_ROLES)[number];
