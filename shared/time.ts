// Timezone-aware date helpers. Dates are "YYYY-MM-DD" strings in the center's timezone.

export function zonedNow(tz: string, at: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const time = `${get('hour')}:${get('minute')}`;
  return { date, time, minutes: toMinutes(time) };
}

export const localDateOf = (iso: string, tz: string) => zonedNow(tz, new Date(iso)).date;
export const localTimeOf = (iso: string, tz: string) => zonedNow(tz, new Date(iso)).time;

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekdayOf = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();

export function startOfWeek(date: string, weekStartsOn: 0 | 1): string {
  const wd = weekdayOf(date);
  const diff = (wd - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'));
export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
