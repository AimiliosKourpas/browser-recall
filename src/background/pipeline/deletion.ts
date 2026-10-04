// ADR-006 deletion mirroring. Chrome's own expiry of history older than ~90 days fires onVisitRemoved exactly like a user
// deleting those URLs (M0 S4), so a removal of a URL whose STORED last visit is older than EXPIRY_GUARD_DAYS is treated as
// Chrome expiry and ignored: Browser Recall's archive must outlive Chrome's 90 days. Saved pages are never deleted here
// (the engine only clears their history flag).
import { normalizeUrl } from '../../engine/url';

export const EXPIRY_GUARD_DAYS = 85; // Chrome expires at 90 days; margin for its batch timer lag

export interface Removal {
  allHistory: boolean;
  urls: string[];
}

export interface DeletionPlan {
  deleteAllExceptSaved: boolean;
  deleteUrls: string[];
  ignoredAsExpiry: string[];
}

/** `stored` = last visit per NORMALISED url, as known to the engine; unknown URLs are skipped. */
export function planRemoval(removal: Removal, stored: ReadonlyMap<string, number>, nowMs: number, opts = { mirrorDeletion: true, expiryGuard: true }): DeletionPlan {
  const plan: DeletionPlan = { deleteAllExceptSaved: false, deleteUrls: [], ignoredAsExpiry: [] };
  if (!opts.mirrorDeletion) return plan;
  if (removal.allHistory) return { ...plan, deleteAllExceptSaved: true }; // "Clear browsing data" / deleteAll: always user-initiated
  const cutoff = nowMs - EXPIRY_GUARD_DAYS * 86_400_000;
  for (const raw of new Set(removal.urls.map((u) => normalizeUrl(u)?.url).filter((u): u is string => !!u))) {
    const last = stored.get(raw);
    if (last === undefined) continue;
    if (opts.expiryGuard && last < cutoff) plan.ignoredAsExpiry.push(raw);
    else plan.deleteUrls.push(raw);
  }
  return plan;
}
