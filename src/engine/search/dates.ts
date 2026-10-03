// Date expressions for after:/before:/when: (PRODUCT_SPEC §5.2). Pure; `now` and the timezone offset are injected.

export interface DateContext {
  /** epoch ms */
  now: number;
  /** minutes EAST of UTC (e.g. Athens summer = 180). Used for calendar-day boundaries. Default 0. */
  tzOffsetMinutes?: number;
}

const DAY = 86_400_000;
const UNIT_MS: Record<string, number> = { d: DAY, w: 7 * DAY, m: 30 * DAY, y: 365 * DAY };

/** Start (epoch ms) of the calendar day containing `ms`, in the context's timezone. */
export function startOfDay(ms: number, tzOffsetMinutes = 0): number {
  const offset = tzOffsetMinutes * 60_000;
  return Math.floor((ms + offset) / DAY) * DAY - offset;
}

/**
 * `2026-09-01` (start of that day, local) or relative `7d` / `2w` / `3m` / `1y` (now minus N units; m = 30 days, y = 365 days).
 * Returns undefined for anything else, including impossible dates (2026-02-30).
 */
export function parseDateValue(value: string, ctx: DateContext): number | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const utc = Date.UTC(y, m - 1, d);
    const check = new Date(utc);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return undefined;
    return utc - (ctx.tzOffsetMinutes ?? 0) * 60_000;
  }
  const rel = /^(\d{1,4})([dwmy])$/i.exec(value);
  if (rel) return ctx.now - Number(rel[1]) * (UNIT_MS[(rel[2] as string).toLowerCase()] as number);
  return undefined;
}

export interface DateRange {
  after?: number; // inclusive
  before?: number; // exclusive
}

/** when:today | yesterday | week | month | year. Returns undefined for unknown presets. */
export function parseWhen(value: string, ctx: DateContext): DateRange | undefined {
  const today = startOfDay(ctx.now, ctx.tzOffsetMinutes);
  switch (value.toLowerCase()) {
    case 'today':
      return { after: today };
    case 'yesterday':
      return { after: today - DAY, before: today };
    case 'week':
      return { after: ctx.now - 7 * DAY };
    case 'month':
      return { after: ctx.now - 30 * DAY };
    case 'year':
      return { after: ctx.now - 365 * DAY };
    default:
      return undefined;
  }
}
