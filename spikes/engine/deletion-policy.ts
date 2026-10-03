// ADR-006 prototype: turn a history.onVisitRemoved event into engine actions.
// Evidence (docs/spikes/M0-RESULTS.md, spikes 4): Chromium's own 90-day expiry fires onVisitRemoved with
// { allHistory:false, urls:[...] }, indistinguishable from a user deleting those URLs.
// Heuristic: a removal of a URL whose last visit WE recorded is older than EXPIRY_GUARD_DAYS is treated as expiry and ignored.
export const EXPIRY_GUARD_DAYS = 85; // Chromium expires at 90 days; leave margin for its batch timer lag

export interface Removal {
  allHistory: boolean;
  urls: string[];
}
export type StoredLastVisit = (url: string) => number | undefined; // epoch ms, undefined = unknown URL

export interface Plan {
  deleteAllExceptSaved: boolean;
  deleteUrls: string[]; // delete History/Deep data (never Saved)
  ignoredAsExpiry: string[];
}

export function planRemoval(ev: Removal, last: StoredLastVisit, nowMs: number, opts: { mirrorDeletion: boolean; expiryGuard: boolean } = { mirrorDeletion: true, expiryGuard: true }): Plan {
  const empty: Plan = { deleteAllExceptSaved: false, deleteUrls: [], ignoredAsExpiry: [] };
  if (!opts.mirrorDeletion) return empty;
  if (ev.allHistory) return { ...empty, deleteAllExceptSaved: true }; // "Clear browsing data" / deleteAll: always user-initiated
  const cutoff = nowMs - EXPIRY_GUARD_DAYS * 86_400_000;
  const plan = { ...empty };
  for (const url of ev.urls) {
    const lv = last(url);
    if (lv === undefined) continue; // not in our index
    if (opts.expiryGuard && lv < cutoff) plan.ignoredAsExpiry.push(url);
    else plan.deleteUrls.push(url);
  }
  return plan;
}
