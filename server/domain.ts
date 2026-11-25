// Domain model, defaults, schedule resolution and timesheet math. Pure functions only.
import type {
  Closure, DayEntry, Punch, PublicUser, ScheduleDay, Settings, Shift, TimeOff, TimesheetDay, Weekly,
} from '../shared/types';
import { isTime, toMinutes, weekdayOf } from '../shared/time';
import { ValidationError } from './errors';

export interface User extends PublicUser {
  passwordHash: string | null;
  tokenVersion: number;
  createdAt: string;
  updatedAt: string;
  passwordSetAt?: string;
}

export interface UsersDoc { users: User[] }
export type OverridesDoc = Record<string, Record<string, Shift[]>>; // date -> userId -> shifts

export const SEED_USERNAME = 'mindy.brandt@ggearlylearning.com';

export const COLORS = ['#2F7D5B', '#3B6FB6', '#9B4F96', '#C26A2E', '#1E8A8A', '#B23A48', '#6B7A2A', '#5B5BB8', '#8A5A3C', '#C04D86'];

export const DEFAULT_SETTINGS: Settings = {
  orgName: 'Guided Growth Early Learning',
  timezone: 'America/Los_Angeles',
  weekStartsOn: 1,
  showWeekends: false,
  swapsNeedApproval: false,
  changesNeedApproval: true,
  timeOffNeedsApproval: true,
  clockReminder: 'This app doesn’t sync with Gusto yet — clock in there too.',
};

export function seedUsers(nowIso: string): UsersDoc {
  return {
    users: [{
      id: crypto.randomUUID(),
      username: SEED_USERNAME,
      displayName: 'Mindy Brandt',
      title: 'Director',
      role: 'super',
      color: COLORS[0],
      active: true,
      weekly: {},
      email: SEED_USERNAME,
      passwordHash: null,
      tokenVersion: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    }],
  };
}

export const isManager = (u: Pick<User, 'role'>) => u.role === 'super' || u.role === 'manager';

export function toPublic(u: User, forManager: boolean): PublicUser {
  const p: PublicUser = {
    id: u.id, username: u.username, displayName: u.displayName, title: u.title, role: u.role,
    color: u.color, active: u.active, weekly: u.weekly ?? {},
  };
  if (forManager) {
    p.email = u.email;
    p.hasPassword = !!u.passwordHash;
    p.lastLoginAt = u.lastLoginAt;
    p.gustoEmployeeUuid = u.gustoEmployeeUuid;
  }
  return p;
}

export const normalizeUsername = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

export function validateUsername(u: string) {
  if (!/^[a-z0-9][a-z0-9._@+-]{1,63}$/.test(u)) {
    throw new ValidationError('Usernames are 2–64 characters: letters, numbers, dots, dashes, or an email address.');
  }
}

export function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8) throw new ValidationError('Use at least 8 characters for your password.');
  if (pw.length > 200) throw new ValidationError('That password is too long.');
  return pw;
}

export function str(v: unknown, max: number, field: string, required = false): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${field} is required.`);
    return undefined;
  }
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text.`);
  const t = v.trim();
  if (required && !t) throw new ValidationError(`${field} is required.`);
  if (t.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer.`);
  return t || undefined;
}

export function parseShifts(v: unknown): Shift[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 3) throw new ValidationError('A day can have up to 3 shifts.');
  const out = v.map((s: any) => {
    if (!s || !isTime(s.start) || !isTime(s.end)) throw new ValidationError('Each shift needs a start and end time.');
    if (toMinutes(s.start) >= toMinutes(s.end)) throw new ValidationError('A shift must end after it starts.');
    const shift: Shift = { start: s.start, end: s.end };
    if (s.lunchStart || s.lunchEnd) {
      if (!isTime(s.lunchStart) || !isTime(s.lunchEnd)) throw new ValidationError('Lunch needs a start and end time.');
      const ls = toMinutes(s.lunchStart), le = toMinutes(s.lunchEnd);
      if (ls >= le || ls < toMinutes(s.start) || le > toMinutes(s.end)) throw new ValidationError('Lunch must fall inside the shift.');
      shift.lunchStart = s.lunchStart;
      shift.lunchEnd = s.lunchEnd;
    }
    const note = str(s.note, 120, 'Shift note');
    if (note) shift.note = note;
    return shift;
  });
  return sortShifts(out);
}

export const sortShifts = (s: Shift[]) => [...s].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

export function parseWeekly(v: unknown): Weekly {
  if (!v || typeof v !== 'object') return {};
  const out: Weekly = {};
  for (const k of ['0', '1', '2', '3', '4', '5', '6'] as const) {
    const shifts = parseShifts((v as any)[k]);
    if (shifts.length) out[k] = shifts;
  }
  return out;
}

export const monthKey = (date: string) => date.slice(0, 7);

export function regularShifts(u: Pick<User, 'weekly'>, date: string): Shift[] {
  return (u.weekly?.[String(weekdayOf(date)) as keyof Weekly] ?? []) as Shift[];
}

export function effectiveShifts(u: User, date: string, overrides: OverridesDoc): { shifts: Shift[]; source: 'regular' | 'changed' } {
  const ov = overrides[date]?.[u.id];
  return ov ? { shifts: ov, source: 'changed' } : { shifts: regularShifts(u, date), source: 'regular' };
}

export const activeClosures = (c: (Closure & { deletedAt?: string })[]) => c.filter((x) => !x.deletedAt);

export function closureOn(date: string, closures: Closure[]) {
  return closures.find((c) => c.startDate <= date && date <= c.endDate);
}

export function resolveDays(
  dates: string[], users: User[], overrides: OverridesDoc, timeoff: TimeOff[], closures: Closure[],
  viewer: { id: string; manager: boolean },
): ScheduleDay[] {
  const active = users.filter((u) => u.active);
  return dates.map((date) => {
    const closure = closureOn(date, closures);
    const entries: DayEntry[] = active.map((u) => {
      const { shifts, source } = effectiveShifts(u, date, overrides);
      const to = timeoff.find((t) =>
        t.userId === u.id && t.startDate <= date && date <= t.endDate &&
        (t.status === 'approved' || (t.status === 'pending' && (viewer.manager || viewer.id === u.id))));
      const entry: DayEntry = { userId: u.id, shifts: closure ? [] : shifts, source };
      if (to) {
        entry.timeOff = { id: to.id, type: to.type, allDay: to.allDay, startTime: to.startTime, endTime: to.endTime, status: to.status, note: to.note };
        if (to.status === 'approved' && to.allDay) entry.shifts = [];
      }
      return entry;
    });
    return closure ? { date, closure: { id: closure.id, name: closure.name }, entries } : { date, entries };
  });
}

/** Turns one person's punches for one day into worked time. Lunch is unpaid; rest breaks are paid. */
export function timesheetDay(date: string, punches: Punch[], nowIso?: string): TimesheetDay {
  const ps = [...punches].sort((a, b) => a.at.localeCompare(b.at));
  const ms = (a: string, b: string) => Math.max(0, Date.parse(b) - Date.parse(a));
  let inAt: string | null = null, breakAt: string | null = null, lunchAt: string | null = null;
  let onClock = 0, lunch = 0, brk = 0;
  const flags = new Set<string>();
  let firstIn: string | undefined, lastOut: string | undefined;
  for (const p of ps) {
    switch (p.type) {
      case 'clock_in':
        if (inAt) flags.add('Clocked in twice');
        else { inAt = p.at; firstIn ??= p.at; }
        break;
      case 'break_start': breakAt = p.at; break;
      case 'break_end': if (breakAt) { brk += ms(breakAt, p.at); breakAt = null; } break;
      case 'lunch_start': lunchAt = p.at; break;
      case 'lunch_end': if (lunchAt) { lunch += ms(lunchAt, p.at); lunchAt = null; } break;
      case 'clock_out':
        if (breakAt) { brk += ms(breakAt, p.at); breakAt = null; }
        if (lunchAt) { lunch += ms(lunchAt, p.at); lunchAt = null; }
        if (inAt) { onClock += ms(inAt, p.at); inAt = null; lastOut = p.at; }
        else flags.add('Clock-out without clock-in');
        break;
    }
  }
  let open = false;
  if (inAt && nowIso) {
    // Today's shift still running: count up to now.
    open = true;
    onClock += ms(inAt, nowIso);
    if (lunchAt) lunch += ms(lunchAt, nowIso);
    if (breakAt) brk += ms(breakAt, nowIso);
  } else if (inAt) flags.add('Missing clock-out');
  const min = (x: number) => Math.round(x / 60000);
  return {
    date, firstIn, lastOut,
    onClockMinutes: min(onClock), lunchMinutes: min(lunch), breakMinutes: min(brk),
    workedMinutes: min(onClock - lunch), ...(open ? { open } : {}), flags: [...flags],
  };
}
