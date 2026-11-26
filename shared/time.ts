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

/** Local wall-clock date + time in `tz` -> UTC ISO string. */
export function zonedToIso(date: string, time: string, tz: string): string {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const offsetAt = (ms: number) => {
    const z = zonedNow(tz, new Date(ms));
    return Date.parse(`${z.date}T${z.time}:00Z`) - Math.floor(ms / 60000) * 60000;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first)).toISOString(); // second pass handles DST edges
}

/** "13:05" -> "1:05 PM" */
export function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'));
export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
