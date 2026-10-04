// Daily bounded maintenance (A7 + retention + storage cap + occasional integrity check) over the existing engine API.
// Never called per event: only from the daily alarm. Defaults are the PRODUCT_SPEC §5.6 defaults (settings UI is M8).
import type { EngineCall, EngineResults } from '../../engine/contract';
import { hasValidConsent, type StateStore } from './state';

export const RETENTION_MONTHS = 12;
export const STORAGE_CAP_BYTES = 1_000_000_000;
export const VACUUM_PAGES_PER_RUN = 500;
export const INTEGRITY_EVERY_MS = 7 * 86_400_000;

export interface EngineCaller {
  call<C extends EngineCall>(call: C): Promise<EngineResults[C['method']]>;
}

export async function runMaintenance(deps: { engine: EngineCaller; state: StateStore; now: () => number }): Promise<'done' | 'no-consent'> {
  const s = await deps.state.read();
  if (!hasValidConsent(s)) return 'no-consent';
  const now = deps.now();
  await deps.engine.call({ method: 'applyRetention', params: { months: RETENTION_MONTHS, now } });
  await deps.engine.call({ method: 'enforceCap', params: { maxBytes: STORAGE_CAP_BYTES } });
  await deps.engine.call({ method: 'maintenance', params: { vacuumPages: VACUUM_PAGES_PER_RUN, ftsMerge: true } });
  let integrity = s.lastIntegrity;
  if (integrity === null || now - integrity.at >= INTEGRITY_EVERY_MS) {
    const report = await deps.engine.call({ method: 'integrityCheck' });
    integrity = { at: now, ok: report.ok };
  }
  await deps.state.update((st) => ({ ...st, lastMaintenanceAt: now, lastIntegrity: integrity }));
  return 'done';
}
