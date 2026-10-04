// The history pipeline: consent gate + initial import + live sync + deletion mirroring + schedules. Pure (all Chrome and engine
// access injected), so every behaviour is unit-tested; background/index.ts wires the real APIs and registers the listeners at
// the top level. Nothing here runs before consent, and nothing depends on the onboarding page staying open.
import type { EngineCall, EngineResults } from '../../engine/contract';
import type { HistoryRow } from '../../engine/model';
import { type AlarmsApi, ALARM_IMPORT_WATCHDOG, ALARM_MAINTENANCE, ALARM_RECONCILE, ALARM_TITLE_REFRESH, ensureAlarms } from './alarms';
import { planRemoval, type Removal } from './deletion';
import { type HistoryItemLike, type HistorySearch, type ImportDeps, importRange, isHttpUrl, runInitialImport, runReconcile, toRow } from './history-import';
import { runMaintenance } from './maintenance';
import { CONSENT_VERSION, type PipelineState, type Settings, type SettingsPatch, type StateStore, hasValidConsent } from './state';

const TITLE_REFRESH_WINDOW_MS = 20 * 60_000;

export interface PipelineDeps {
  history: HistorySearch;
  engine: { call<C extends EngineCall>(call: C): Promise<EngineResults[C['method']]> };
  state: StateStore;
  alarms: AlarmsApi;
  now: () => number;
}

export interface PipelineStatus {
  consent: 'none' | 'granted' | 'outdated';
  importStatus: PipelineState['import']['status'];
  processed: number;
  skipped: number;
  windows: number;
  /** 0..1 over the time range being imported (newest → oldest), 1 when complete */
  progress: number;
  lastReconcileAt: number | null;
  lastMaintenanceAt: number | null;
  lastIntegrity: { at: number; ok: boolean } | null;
  paused: boolean;
}

export function toStatus(s: PipelineState, now: number): PipelineStatus {
  const { rangeStart, nextEnd, startedAt } = s.import;
  const span = rangeStart !== null && startedAt !== null ? Math.max(1, startedAt + 1 - rangeStart) : 1;
  const progress = s.import.status === 'complete' ? 1 : rangeStart === null || nextEnd === null ? 0 : Math.min(1, Math.max(0, (startedAt === null ? now : startedAt + 1) - nextEnd) / span);
  return {
    consent: s.consent === null ? 'none' : hasValidConsent(s) ? 'granted' : 'outdated',
    importStatus: s.import.status,
    processed: s.import.processed,
    skipped: s.import.skipped,
    windows: s.import.windows,
    progress,
    lastReconcileAt: s.lastReconcileAt,
    lastMaintenanceAt: s.lastMaintenanceAt,
    lastIntegrity: s.lastIntegrity,
    paused: s.settings.paused,
  };
}

export function createPipeline(deps: PipelineDeps) {
  let importRun: Promise<unknown> | undefined; // single flight inside this service-worker instance
  let stopRequested = false;
  const importDeps = (): ImportDeps => ({ history: deps.history, upsert: (rows: HistoryRow[]) => deps.engine.call({ method: 'upsertHistory', params: { rows } }), state: deps.state, now: deps.now, shouldStop: () => stopRequested });

  const syncAlarms = async () => {
    const s = await deps.state.read();
    await ensureAlarms(deps.alarms, { wanted: hasValidConsent(s), importRunning: hasValidConsent(s) && s.import.status === 'running' });
  };

  /** Starts (or continues) the initial import in the background; safe to call any number of times and on every wake. */
  const resumeImport = (): Promise<unknown> => {
    importRun ??= (async () => {
      try {
        stopRequested = false;
        await syncAlarms();
        const outcome = await runInitialImport(importDeps());
        return outcome;
      } finally {
        importRun = undefined;
        await syncAlarms();
      }
    })().catch(() => undefined); // transient engine failure: state is checkpointed; the watchdog alarm retries
    return importRun;
  };

  return {
    /** Every service-worker wake / install / startup: restore schedules and continue anything unfinished (all no-ops without consent). */
    async onWake(): Promise<void> {
      const s = await deps.state.read();
      if (!hasValidConsent(s)) return;
      await syncAlarms();
      if (s.settings.paused) return; // paused: nothing runs until the user resumes
      if (s.import.status !== 'complete') void resumeImport();
      else if (s.reconcileDue) void runReconcile(importDeps()).catch(() => undefined);
    },

    needsConsent: async (): Promise<boolean> => !hasValidConsent(await deps.state.read()),

    async grantConsent(version: number): Promise<void> {
      if (version !== CONSENT_VERSION) throw new Error(`unsupported consent version ${version}`);
      const now = deps.now();
      await deps.state.update((s) => ({ ...s, consent: { version: CONSENT_VERSION, at: now } }));
      await syncAlarms();
      void resumeImport();
    },

    /** Stops all processing and forgets the checkpoint. Indexed data is NOT touched here (deleting it is an explicit M8 control). */
    async revokeConsent(): Promise<void> {
      stopRequested = true;
      await deps.state.update((s) => ({ ...s, consent: null, reconcileDue: false, import: { ...s.import, status: 'idle', rangeStart: null, nextEnd: null, startedAt: null, completedAt: null, processed: 0, skipped: 0, windows: 0 } }));
      await syncAlarms();
    },

    async status(): Promise<PipelineStatus> {
      return toStatus(await deps.state.read(), deps.now());
    },

    /** history.onVisited: idempotent upsert; a failure marks reconcile due instead of losing the visit. */
    async onVisited(item: HistoryItemLike): Promise<void> {
      if (!isHttpUrl(item.url)) return;
      const st = await deps.state.read();
      if (!hasValidConsent(st) || st.settings.paused) return; // paused visits are picked up by the reconcile that runs on resume
      const row = toRow(item);
      if (!row) return;
      try {
        await deps.engine.call({ method: 'upsertHistory', params: { rows: [row] } });
        // Chrome reports a visit before the page has a title: ask history again shortly after (one alarm, not reset by further visits)
        if (!item.title && !(await deps.alarms.get(ALARM_TITLE_REFRESH))) await deps.alarms.create(ALARM_TITLE_REFRESH, { delayInMinutes: 0.5 });
      } catch {
        await deps.state.update((s) => ({ ...s, reconcileDue: true }));
      }
    },

    /** history.onVisitRemoved with the ADR-006 expiry guard. */
    async onVisitRemoved(removal: Removal): Promise<void> {
      const st = await deps.state.read();
      if (!hasValidConsent(st) || !st.settings.mirrorDeletion) return; // mirrored deletion switched off: Chrome's deletions leave the archive alone
      if (!removal.allHistory && removal.urls.length === 0) return; // partial-visit deletion: the URL still exists
      const stored = removal.allHistory ? new Map<string, number>() : new Map((await deps.engine.call({ method: 'lastVisits', params: { urls: removal.urls } })).map((r) => [r.url, r.lastVisit]));
      const plan = planRemoval(removal, stored, deps.now());
      if (plan.deleteAllExceptSaved) await deps.engine.call({ method: 'deleteAllExceptSaved' });
      else if (plan.deleteUrls.length) await deps.engine.call({ method: 'deleteUrls', params: { urls: plan.deleteUrls } });
    },

    async onAlarm(name: string): Promise<void> {
      const s = await deps.state.read();
      if (!hasValidConsent(s)) {
        await syncAlarms();
        return;
      }
      try {
        if (name === ALARM_IMPORT_WATCHDOG) {
          if (!s.settings.paused) await resumeImport();
        } else if (name === ALARM_TITLE_REFRESH) {
          if (!s.settings.paused) await importRange(importDeps(), deps.now() - TITLE_REFRESH_WINDOW_MS, deps.now() + 1);
        } else if (name === ALARM_RECONCILE) {
          if (!s.settings.paused) await runReconcile(importDeps());
        }
        else if (name === ALARM_MAINTENANCE) await runMaintenance({ engine: deps.engine, state: deps.state, now: deps.now });
      } finally {
        await syncAlarms();
      }
    },

    async settings(): Promise<Settings> {
      return (await deps.state.read()).settings;
    },

    /** Applies a validated patch. Pausing stops the import cleanly; resuming continues it or reconciles the paused gap. */
    async updateSettings(patch: SettingsPatch): Promise<Settings> {
      const before = (await deps.state.read()).settings;
      const next = await deps.state.update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      if (patch.paused === true && !before.paused) stopRequested = true;
      if (patch.paused === false && before.paused && hasValidConsent(next)) {
        if (next.import.status !== 'complete') void resumeImport();
        else void runReconcile(importDeps()).catch(() => undefined);
      }
      return next.settings;
    },

    /** for tests */
    resumeImport,
  };
}

export type Pipeline = ReturnType<typeof createPipeline>;
