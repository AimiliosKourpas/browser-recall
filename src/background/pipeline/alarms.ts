// chrome.alarms scheduling. Alarms are named, so re-creating one replaces it (no duplicates); they do not reliably survive a
// browser restart, so ensureAlarms() runs on install, on startup, after consent and after every alarm. The import watchdog
// exists only while an import is running: it wakes a suspended service worker so the import resumes from its checkpoint.
export const ALARM_RECONCILE = 'br-reconcile';
export const ALARM_MAINTENANCE = 'br-maintenance';
export const ALARM_IMPORT_WATCHDOG = 'br-import-watchdog';

export interface AlarmLike {
  name: string;
  periodInMinutes?: number | undefined;
}

export interface AlarmsApi {
  get(name: string): Promise<AlarmLike | undefined>;
  create(name: string, info: { delayInMinutes?: number; periodInMinutes: number }): Promise<void>;
  clear(name: string): Promise<boolean>;
}

const DAILY = 24 * 60;

export interface AlarmPlan {
  wanted: boolean;
  importRunning: boolean;
}

/** Idempotent: creates what is missing or has the wrong period, clears what is not wanted. */
export async function ensureAlarms(api: AlarmsApi, plan: AlarmPlan): Promise<void> {
  const want: { name: string; delay: number; period: number; on: boolean }[] = [
    { name: ALARM_RECONCILE, delay: 60, period: DAILY, on: plan.wanted },
    { name: ALARM_MAINTENANCE, delay: 120, period: DAILY, on: plan.wanted },
    { name: ALARM_IMPORT_WATCHDOG, delay: 1, period: 1, on: plan.wanted && plan.importRunning },
  ];
  for (const a of want) {
    const existing = await api.get(a.name);
    if (!a.on) {
      if (existing) await api.clear(a.name);
    } else if (!existing || existing.periodInMinutes !== a.period) {
      await api.create(a.name, { delayInMinutes: a.delay, periodInMinutes: a.period });
    }
  }
}

export function createChromeAlarmsApi(alarms: typeof chrome.alarms = chrome.alarms): AlarmsApi {
  return {
    get: async (name) => (await alarms.get(name)) ?? undefined,
    create: (name, info) => alarms.create(name, info),
    clear: (name) => alarms.clear(name),
  };
}
