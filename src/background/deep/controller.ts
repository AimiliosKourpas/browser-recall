// Deep Search settings and lifecycle (M6). The permission request itself happens in an extension page (it needs a user gesture);
// this controller verifies the permission is really held before it ever turns capture on, and turns capture off the moment the
// permission disappears. Turning Deep Search off never deletes anything (clearing text is a separate, explicit action).
import type { EngineCaller } from '../pipeline/maintenance';
import { hasValidConsent, type StateStore } from '../pipeline/state';
import { normalizeDomain } from './capture';

export const DEEP_ORIGINS = ['https://*/*', 'http://*/*'] as const;

export interface DeepStatus {
  enabled: boolean;
  /** the optional host permission is currently held */
  permission: boolean;
  consent: boolean;
  excluded: string[];
}

export interface DeepControllerDeps {
  state: StateStore;
  engine: EngineCaller;
  hasPermission: () => Promise<boolean>;
  now: () => number;
}

export function createDeepController(deps: DeepControllerDeps) {
  const status = async (): Promise<DeepStatus> => {
    const s = await deps.state.read();
    const permission = await deps.hasPermission();
    return { enabled: s.deep.enabled && permission, permission, consent: hasValidConsent(s), excluded: s.deep.excluded };
  };
  const setEnabled = (enabled: boolean) => deps.state.update((s) => ({ ...s, deep: { ...s.deep, enabled, enabledAt: enabled ? deps.now() : s.deep.enabledAt } }));

  return {
    status,
    /** Refuses unless consent is valid and the user really granted the optional host permission. */
    async enable(): Promise<DeepStatus> {
      if (!hasValidConsent(await deps.state.read())) throw new Error('consent-required');
      if (!(await deps.hasPermission())) throw new Error('permission-required');
      await setEnabled(true);
      return status();
    },
    async disable(): Promise<DeepStatus> {
      await setEnabled(false);
      return status();
    },
    /** permissions.onRemoved, and every wake: a state that claims "enabled" without the permission is corrected at once. */
    async reconcile(): Promise<void> {
      const s = await deps.state.read();
      if (s.deep.enabled && !(await deps.hasPermission())) await setEnabled(false);
    },
    async exclude(domain: string): Promise<DeepStatus> {
      const d = normalizeDomain(domain);
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new Error('bad-domain');
      await deps.state.update((s) => ({ ...s, deep: { ...s.deep, excluded: s.deep.excluded.includes(d) ? s.deep.excluded : [...s.deep.excluded, d].slice(-500) } }));
      await deps.engine.call({ method: 'clearDeepContent', params: { domain: d } });
      return status();
    },
    async include(domain: string): Promise<DeepStatus> {
      const d = normalizeDomain(domain);
      await deps.state.update((s) => ({ ...s, deep: { ...s.deep, excluded: s.deep.excluded.filter((x) => x !== d) } }));
      return status();
    },
    async clear(): Promise<{ deletedPages: number; demotedPages: number }> {
      return deps.engine.call({ method: 'clearDeepContent', params: {} });
    },
  };
}

export type DeepController = ReturnType<typeof createDeepController>;
