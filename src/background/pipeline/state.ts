// The pipeline's small local state (chrome.storage.local, ONE key, zod-validated). Everything the consent gate, the resumable
// import and the schedulers need to survive service-worker termination. Corrupt or missing state reads as "defaults" —
// which means "no consent", i.e. the safe, inert direction.
import { z } from 'zod';

/** Bump when data practices change: users with an older version are asked again (PRODUCT_SPEC §5.1). */
export const CONSENT_VERSION = 1;
export const STATE_KEY = 'br:state';

const ms = z.number().finite().nonnegative();

/** User settings (M8). Defaults are PRODUCT_SPEC §5.6: 12 months, 1 GB, mirrored deletion on, not paused. */
export const settingsSchema = z.object({
  /** pause: no live history sync, no import/reconcile, no Deep Search capture; resuming reconciles the gap */
  paused: z.boolean(),
  /** History + Deep Search retention in months; null = keep until deleted. Saved items never expire. */
  retentionMonths: z.number().int().min(1).max(1200).nullable(),
  /** storage cap in MB (decimal); oldest Deep Search text is trimmed first */
  capMb: z.number().int().min(50).max(100_000),
  /** mirrored deletion (ADR-006) */
  mirrorDeletion: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => ({ paused: false, retentionMonths: 12, capMb: 1000, mirrorDeletion: true });
export const settingsPatchSchema = settingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const stateSchema = z.object({
  consent: z.object({ version: z.number().int().positive(), at: ms }).nullable(),
  import: z.object({
    status: z.enum(['idle', 'running', 'complete']),
    /** earliest visit found when the import started */
    rangeStart: ms.nullable(),
    /** exclusive upper bound of the range still to import (moves backwards as windows complete) */
    nextEnd: ms.nullable(),
    startedAt: ms.nullable(),
    completedAt: ms.nullable(),
    processed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    windows: z.number().int().nonnegative(),
  }),
  lastReconcileAt: ms.nullable(),
  /** a live event could not reach the engine: reconcile soon */
  reconcileDue: z.boolean(),
  lastMaintenanceAt: ms.nullable(),
  lastIntegrity: z.object({ at: ms, ok: z.boolean() }).nullable(),
  /** Deep Search (M6): OFF by default; `enabled` is only ever set after the optional host permission was verified. */
  deep: z
    .object({ enabled: z.boolean(), enabledAt: ms.nullable(), excluded: z.array(z.string().max(255)).max(500) })
    .default({ enabled: false, enabledAt: null, excluded: [] }),
  settings: settingsSchema.default(defaultSettings()),
});
export type PipelineState = z.infer<typeof stateSchema>;

export const defaultState = (): PipelineState => ({
  consent: null,
  import: { status: 'idle', rangeStart: null, nextEnd: null, startedAt: null, completedAt: null, processed: 0, skipped: 0, windows: 0 },
  lastReconcileAt: null,
  reconcileDue: false,
  lastMaintenanceAt: null,
  lastIntegrity: null,
  deep: { enabled: false, enabledAt: null, excluded: [] },
  settings: defaultSettings(),
});

export interface StorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StateStore {
  read(): Promise<PipelineState>;
  /** Serialised read-modify-write: concurrent updates never lose each other's changes. */
  update(change: (state: PipelineState) => PipelineState): Promise<PipelineState>;
}

export function createStateStore(storage: StorageLike): StateStore {
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<PipelineState> => {
    const parsed = stateSchema.safeParse((await storage.get(STATE_KEY))[STATE_KEY]);
    return parsed.success ? parsed.data : defaultState();
  };
  return {
    read,
    update(change) {
      const next = queue.then(async () => {
        const updated = stateSchema.parse(change(await read()));
        await storage.set({ [STATE_KEY]: updated });
        return updated;
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

export const hasValidConsent = (s: PipelineState): boolean => s.consent !== null && s.consent.version >= CONSENT_VERSION;
