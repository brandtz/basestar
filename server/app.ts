// HTTP API. Framework-free: takes a Fetch API Request, returns a Response.
// Layering: route handler -> domain helpers -> KV store.
import type {
  Board, Closure, Punch, PunchType, Settings, ShiftRequest, StatusEntry, TimeOff, TimeOffType, TimesheetRow, WorkState,
} from '../shared/types';
import { addDays, daysBetween, isDate, isTime, localDateOf, localTimeOf, to12h, toMinutes, zonedNow, zonedToIso } from '../shared/time';
import {
  AuthenticationError, AuthorizationError, ConflictError, HttpError, NotFoundError, RateLimitError, ValidationError,
} from './errors';
import { type KV, read, update } from './store';
import {
  getSigningKey, hashPassword, readCookie, SESSION_COOKIE, sessionCookie, signSession, verifyPassword, verifySession,
} from './auth';
import {
  activeClosures, COLORS, DEFAULT_SETTINGS, effectiveShifts, isManager, monthKey, normalizeUsername, type OverridesDoc,
  parseShifts, parseWeekly, resolveDays, seedUsers, sortShifts, str, timesheetDay, toPublic, type User, type UsersDoc,
  validatePassword, validateUsername,
} from './domain';
import { sendCompletedShift } from './gusto';

export interface AppOptions {
  jwtSecret?: string;
  now?: () => Date;
}

type StoredClosure = Closure & { deletedAt?: string };
interface Attempts { count: number; firstAt: number; lockedUntil?: number }

interface Ctx {
  req: Request;
  url: URL;
  params: string[];
  body: any;
  user: User;
  users: User[];
  settings: Settings;
  cookies: string[];
}
type PublicCtx = Omit<Ctx, 'user'>;
type Handler = (c: Ctx) => Promise<unknown>;
type PublicHandler = (c: PublicCtx) => Promise<unknown>;

const TIMEOFF_TYPES: TimeOffType[] = ['vacation', 'sick', 'personal', 'unpaid', 'other'];
const LOCK_AFTER = 8, LOCK_WINDOW_MS = 15 * 60_000;

export function createApp(kv: KV, opts: AppOptions = {}) {
  const clock = opts.now ?? (() => new Date());
  const nowIso = () => clock().toISOString();
  let keyP: Promise<Uint8Array> | null = null;
  const signingKey = () => (keyP ??= getSigningKey(kv, opts.jwtSecret));

  // ---------- data access ----------
  async function loadUsers(): Promise<User[]> {
    const doc = await kv.get<UsersDoc>('users');
    if (doc) return doc.data.users;
    await kv.set('users', seedUsers(nowIso()), { onlyIfNew: true });
    return (await kv.get<UsersDoc>('users'))!.data.users;
  }
  const loadSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await read<Partial<Settings>>(kv, 'settings', {})) });
  const updateUsers = (fn: (users: User[]) => void) => update<UsersDoc>(kv, 'users', () => seedUsers(nowIso()), (d) => { fn(d.users); });
  const today = (s: Settings) => zonedNow(s.timezone, clock()).date;

  async function loadOverrides(dates: string[]): Promise<OverridesDoc> {
    const months = [...new Set(dates.map(monthKey))];
    const docs = await Promise.all(months.map((m) => read<OverridesDoc>(kv, `overrides/${m}`, {})));
    return Object.assign({}, ...docs);
  }

  async function audit(actor: User, action: string, detail: Record<string, unknown> = {}) {
    try {
      await update<any[]>(kv, `audit/${nowIso().slice(0, 7)}`, () => [], (log) => {
        log.push({ at: nowIso(), actorId: actor.id, action, ...detail });
      });
    } catch (e) { console.error('audit write failed', e); }
  }

  const findUser = (users: User[], id: unknown) => {
    const u = users.find((x) => x.id === id);
    if (!u) throw new NotFoundError('That person was not found.');
    return u;
  };
  const requireManager = (u: User) => { if (!isManager(u)) throw new AuthorizationError('Only managers can do that.'); };

  /** What the signed-in person sees about themselves plus the data every screen needs. */
  const bootstrap = (c: { user: User; users: User[]; settings: Settings }) => ({
    user: toPublic(c.user, true),
    settings: c.settings,
    users: c.users.map((u) => toPublic(u, isManager(c.user))),
    today: today(c.settings),
  });

  async function issueSession(c: PublicCtx, u: User) {
    const token = await signSession(await signingKey(), u.id, u.tokenVersion);
    c.cookies.push(sessionCookie(c.req, token));
  }

  // ---------- auth (public) ----------
  const lookup: PublicHandler = async (c) => {
    const username = normalizeUsername(c.body.username);
    const u = c.users.find((x) => x.username === username && x.active);
    if (!u) return { next: 'unknown' };
    return { next: u.passwordHash ? 'password' : 'setup', firstName: u.displayName.split(' ')[0] };
  };

  const login: PublicHandler = async (c) => {
    const username = normalizeUsername(c.body.username);
    const password = typeof c.body.password === 'string' ? c.body.password : '';
    const attemptsKey = `attempts/${encodeURIComponent(username)}`;
    const att = await read<Attempts | null>(kv, attemptsKey, null);
    const nowMs = clock().getTime();
    if (att?.lockedUntil && att.lockedUntil > nowMs) {
      const mins = Math.ceil((att.lockedUntil - nowMs) / 60000);
      throw new RateLimitError(`Too many tries. Wait ${mins} minute${mins === 1 ? '' : 's'}, or ask a manager to reset your password.`);
    }
    const u = c.users.find((x) => x.username === username && x.active);
    if (u && !u.passwordHash) return { next: 'setup' };
    const ok = !!u && !!password && (await verifyPassword(password, u.passwordHash!));
    if (!ok) {
      await update<Attempts>(kv, attemptsKey, () => ({ count: 0, firstAt: nowMs }), (a) => {
        if (nowMs - a.firstAt > LOCK_WINDOW_MS) { a.count = 0; a.firstAt = nowMs; delete a.lockedUntil; }
        a.count += 1;
        if (a.count >= LOCK_AFTER) a.lockedUntil = nowMs + LOCK_WINDOW_MS;
      });
      throw new AuthenticationError('That username and password don’t match.');
    }
    if (att) await kv.delete(attemptsKey);
    await updateUsers((users) => { const x = users.find((y) => y.id === u!.id); if (x) x.lastLoginAt = nowIso(); });
    await issueSession(c, u!);
    return bootstrap({ user: u!, users: c.users, settings: c.settings });
  };

  const setup: PublicHandler = async (c) => {
    const username = normalizeUsername(c.body.username);
    const password = validatePassword(c.body.password);
    const hash = await hashPassword(password);
    let me: User | undefined;
    const doc = await updateUsers((users) => {
      const u = users.find((x) => x.username === username && x.active);
      if (!u) throw new AuthenticationError('That username isn’t set up. Ask your manager to add you.');
      if (u.passwordHash) throw new ConflictError('A password is already set for this account. Sign in instead.');
      u.passwordHash = hash;
      u.passwordSetAt = nowIso();
      u.lastLoginAt = nowIso();
      u.updatedAt = nowIso();
      me = u;
    });
    await issueSession(c, me!);
    return bootstrap({ user: me!, users: doc.users, settings: c.settings });
  };

  const logout: PublicHandler = async (c) => {
    c.cookies.push(sessionCookie(c.req, null));
    return { ok: true };
  };

  // ---------- me ----------
  const getMe: Handler = async (c) => bootstrap(c);

  const changePassword: Handler = async (c) => {
    const current = typeof c.body.current === 'string' ? c.body.current : '';
    const next = validatePassword(c.body.next);
    if (!c.user.passwordHash || !(await verifyPassword(current, c.user.passwordHash))) {
      throw new ValidationError('Your current password isn’t right.');
    }
    const hash = await hashPassword(next);
    let me: User | undefined;
    await updateUsers((users) => {
      const u = findUser(users, c.user.id);
      u.passwordHash = hash;
      u.passwordSetAt = nowIso();
      u.tokenVersion += 1; // signs out other devices
      u.updatedAt = nowIso();
      me = u;
    });
    await issueSession(c, me!);
    return { ok: true };
  };

  // ---------- status board ----------
  const getBoard: Handler = async (c) => {
    const d = today(c.settings);
    const [status, overrides, timeoff, closures, requests] = await Promise.all([
      read<Record<string, StatusEntry>>(kv, 'status', {}),
      loadOverrides([d]),
      read<TimeOff[]>(kv, 'timeoff', []),
      read<StoredClosure[]>(kv, 'closures', []).then(activeClosures),
      read<ShiftRequest[]>(kv, 'requests', []),
    ]);
    const mgr = isManager(c.user);
    const [day] = resolveDays([d], c.users, overrides, timeoff, closures, { id: c.user.id, manager: mgr });
    const people = day.entries.map((e) => {
      const st = status[e.userId];
      const stale = !!st && st.state !== 'out' && localDateOf(st.since, c.settings.timezone) < d;
      const sameDay = !!st && localDateOf(st.since, c.settings.timezone) === d;
      return {
        userId: e.userId,
        state: (stale || !st ? 'out' : st.state) as WorkState,
        since: st && (sameDay || stale) ? st.since : undefined,
        clockedInAt: st && !stale && st.state !== 'out' ? st.clockedInAt : undefined,
        stale: stale || undefined,
        shifts: e.shifts,
        timeOff: e.timeOff,
      };
    });
    const pendingForMe =
      requests.filter((r) => r.status === 'awaiting_peer' && r.targetId === c.user.id).length +
      (mgr ? requests.filter((r) => r.status === 'awaiting_manager').length + timeoff.filter((t) => t.status === 'pending').length : 0);
    const board: Board = { now: nowIso(), today: d, people, pendingForMe };
    if (day.closure) board.closure = day.closure;
    return board;
  };

  const setStatus: Handler = async (c) => {
    const action = c.body.action as string;
    if (!['clock_in', 'clock_out', 'break_start', 'lunch_start', 'back'].includes(action)) throw new ValidationError('Unknown action.');
    let target = c.user;
    if (c.body.userId && c.body.userId !== c.user.id) {
      requireManager(c.user);
      target = findUser(c.users, c.body.userId);
    }
    const tz = c.settings.timezone;
    const d = today(c.settings);
    const now = nowIso();
    let at = now;
    // Managers can record something that happened earlier today ("she went to lunch at 11:30").
    if (c.body.at !== undefined && c.body.at !== null && c.body.at !== '') {
      requireManager(c.user);
      if (!isTime(c.body.at)) throw new ValidationError('Pick a time.');
      at = zonedToIso(d, c.body.at, tz);
      if (Date.parse(at) > Date.parse(now) + 60_000) throw new ValidationError('That time hasn’t happened yet.');
    }
    const self = target.id === c.user.id;
    let punchTypes: PunchType[] = [];
    let completedFrom: string | undefined;

    const doc = await update<Record<string, StatusEntry>>(kv, 'status', () => ({}), (all) => {
      punchTypes = [];
      completedFrom = undefined;
      const cur = all[target.id];
      const stale = !!cur && cur.state !== 'out' && localDateOf(cur.since, tz) < d;
      const state: WorkState = !cur || stale ? 'out' : cur.state;
      const who = self ? 'You’re' : `${target.displayName.split(' ')[0]} is`;
      if (cur && !stale && Date.parse(at) < Math.floor(Date.parse(cur.since) / 60000) * 60000) {
        const last = to12h(localTimeOf(cur.since, tz));
        throw new ConflictError(`Pick ${last} or later. That’s when ${self ? 'your' : `${target.displayName.split(' ')[0]}’s`} status last changed.`);
      }
      let next: StatusEntry;
      switch (action) {
        case 'clock_in':
          if (state !== 'out') throw new ConflictError(`${who} already clocked in.`);
          punchTypes = ['clock_in'];
          next = { state: 'in', since: at, clockedInAt: at };
          break;
        case 'break_start':
        case 'lunch_start': {
          const want: WorkState = action === 'break_start' ? 'break' : 'lunch';
          if (state === 'out') throw new ConflictError(self ? 'Clock in first.' : `${who} not clocked in.`);
          if (state === want) throw new ConflictError(`${who} already on ${want}.`);
          if (state === 'break') punchTypes.push('break_end');
          if (state === 'lunch') punchTypes.push('lunch_end');
          punchTypes.push(action as PunchType);
          next = { state: want, since: at, clockedInAt: cur!.clockedInAt };
          break;
        }
        case 'back':
          if (state !== 'break' && state !== 'lunch') throw new ConflictError(`${who} not on a break.`);
          punchTypes = [state === 'break' ? 'break_end' : 'lunch_end'];
          next = { state: 'in', since: at, clockedInAt: cur!.clockedInAt };
          break;
        default: // clock_out
          if (state === 'out') throw new ConflictError(`${who} not clocked in.`);
          if (state === 'break') punchTypes.push('break_end');
          if (state === 'lunch') punchTypes.push('lunch_end');
          punchTypes.push('clock_out');
          completedFrom = cur!.clockedInAt;
          next = { state: 'out', since: at };
      }
      if (!self) next.updatedBy = c.user.id;
      all[target.id] = next;
    });

    const punches: Punch[] = punchTypes.map((type) => ({ id: crypto.randomUUID(), userId: target.id, type, at, by: c.user.id }));
    let dayPunches: Punch[] = [];
    try {
      dayPunches = await update<Punch[]>(kv, `punches/${d}`, () => [], (list) => { list.push(...punches); });
    } catch (e) { console.error('punch write failed', e); }

    if (completedFrom) {
      const sheet = timesheetDay(d, dayPunches.filter((p) => p.userId === target.id && p.at >= completedFrom!));
      sendCompletedShift({
        userId: target.id, gustoEmployeeUuid: target.gustoEmployeeUuid, clockedInAt: completedFrom, clockedOutAt: at,
        lunchMinutes: sheet.lunchMinutes, breakMinutes: sheet.breakMinutes, timezone: tz,
      }).catch((e) => console.error('gusto sync failed', e));
    }
    return { status: doc[target.id] };
  };

  // ---------- schedule ----------
  const getSchedule: Handler = async (c) => {
    const start = c.url.searchParams.get('start') ?? today(c.settings);
    const days = Math.min(42, Math.max(1, Number(c.url.searchParams.get('days') ?? 7) || 7));
    if (!isDate(start)) throw new ValidationError('Bad start date.');
    const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
    const [overrides, timeoff, closures] = await Promise.all([
      loadOverrides(dates), read<TimeOff[]>(kv, 'timeoff', []), read<StoredClosure[]>(kv, 'closures', []).then(activeClosures),
    ]);
    return { today: today(c.settings), days: resolveDays(dates, c.users, overrides, timeoff, closures, { id: c.user.id, manager: isManager(c.user) }) };
  };

  const setDay: Handler = async (c) => {
    requireManager(c.user);
    const target = findUser(c.users, c.body.userId);
    const date = c.body.date;
    if (!isDate(date)) throw new ValidationError('Pick a date.');
    const clear = c.body.shifts === null;
    const shifts = clear ? [] : parseShifts(c.body.shifts);
    await update<OverridesDoc>(kv, `overrides/${monthKey(date)}`, () => ({}), (doc) => {
      if (clear) {
        if (doc[date]) { delete doc[date][target.id]; if (!Object.keys(doc[date]).length) delete doc[date]; }
      } else {
        (doc[date] ??= {})[target.id] = shifts;
      }
    });
    return { ok: true };
  };

  // ---------- time off ----------
  const visibleTimeOff = (c: Ctx, list: TimeOff[]) =>
    list.filter((t) => t.status === 'approved' || isManager(c.user) || t.userId === c.user.id);

  const listTimeOff: Handler = async (c) => {
    const from = c.url.searchParams.get('from') ?? addDays(today(c.settings), -30);
    const to = c.url.searchParams.get('to') ?? addDays(today(c.settings), 365);
    const list = await read<TimeOff[]>(kv, 'timeoff', []);
    return { timeOff: visibleTimeOff(c, list).filter((t) => t.endDate >= from && t.startDate <= to) };
  };

  const createTimeOff: Handler = async (c) => {
    const b = c.body;
    let userId = c.user.id;
    if (b.userId && b.userId !== c.user.id) { requireManager(c.user); userId = findUser(c.users, b.userId).id; }
    if (!isDate(b.startDate) || !isDate(b.endDate)) throw new ValidationError('Pick the first and last day.');
    if (b.endDate < b.startDate) throw new ValidationError('The last day can’t be before the first day.');
    if (daysBetween(b.startDate, b.endDate) > 90) throw new ValidationError('Time off requests can cover up to 90 days.');
    const type: TimeOffType = TIMEOFF_TYPES.includes(b.type) ? b.type : 'other';
    const allDay = b.allDay !== false;
    if (!allDay) {
      if (b.startDate !== b.endDate) throw new ValidationError('Part-day time off must be a single day.');
      if (!isTime(b.startTime) || !isTime(b.endTime) || toMinutes(b.startTime) >= toMinutes(b.endTime)) {
        throw new ValidationError('Pick the hours you’ll be out.');
      }
    }
    const autoApprove = isManager(c.user) || !c.settings.timeOffNeedsApproval;
    const t: TimeOff = {
      id: crypto.randomUUID(), userId, startDate: b.startDate, endDate: b.endDate, allDay,
      ...(allDay ? {} : { startTime: b.startTime, endTime: b.endTime }),
      type, note: str(b.note, 500, 'Note'), status: autoApprove ? 'approved' : 'pending',
      createdAt: nowIso(), createdBy: c.user.id,
      ...(autoApprove ? { decidedAt: nowIso(), decidedBy: c.user.id } : {}),
    };
    await update<TimeOff[]>(kv, 'timeoff', () => [], (list) => { list.push(t); });
    return { timeOff: t };
  };

  const decideTimeOff: Handler = async (c) => {
    requireManager(c.user);
    const approve = c.body.approve === true;
    let out: TimeOff | undefined;
    await update<TimeOff[]>(kv, 'timeoff', () => [], (list) => {
      const t = list.find((x) => x.id === c.params[0]);
      if (!t) throw new NotFoundError('That request was not found.');
      if (t.status !== 'pending') throw new ConflictError('That request was already handled.');
      t.status = approve ? 'approved' : 'denied';
      t.decidedAt = nowIso();
      t.decidedBy = c.user.id;
      out = t;
    });
    await audit(c.user, approve ? 'timeoff.approve' : 'timeoff.deny', { targetId: out!.id });
    return { timeOff: out };
  };

  const cancelTimeOff: Handler = async (c) => {
    let out: TimeOff | undefined;
    const d = today(c.settings);
    await update<TimeOff[]>(kv, 'timeoff', () => [], (list) => {
      const t = list.find((x) => x.id === c.params[0]);
      if (!t) throw new NotFoundError('That request was not found.');
      const mine = t.userId === c.user.id;
      if (!mine && !isManager(c.user)) throw new AuthorizationError();
      if (t.status === 'cancelled' || t.status === 'denied') throw new ConflictError('That request is already closed.');
      if (!isManager(c.user) && t.endDate < d) throw new ConflictError('Past time off can only be changed by a manager.');
      t.status = 'cancelled';
      t.decidedAt = nowIso();
      t.decidedBy = c.user.id;
      out = t;
    });
    return { timeOff: out };
  };

  // ---------- closures ----------
  const listClosures: Handler = async () => ({ closures: activeClosures(await read<StoredClosure[]>(kv, 'closures', [])) });

  const createClosure: Handler = async (c) => {
    requireManager(c.user);
    const b = c.body;
    if (!isDate(b.startDate)) throw new ValidationError('Pick a date.');
    const endDate = isDate(b.endDate) ? b.endDate : b.startDate;
    if (endDate < b.startDate) throw new ValidationError('The last day can’t be before the first day.');
    const cl: StoredClosure = {
      id: crypto.randomUUID(), startDate: b.startDate, endDate, name: str(b.name, 80, 'Name', true)!,
      createdAt: nowIso(), createdBy: c.user.id,
    };
    await update<StoredClosure[]>(kv, 'closures', () => [], (list) => { list.push(cl); });
    await audit(c.user, 'closure.create', { targetId: cl.id });
    return { closure: cl };
  };

  const deleteClosure: Handler = async (c) => {
    requireManager(c.user);
    await update<StoredClosure[]>(kv, 'closures', () => [], (list) => {
      const cl = list.find((x) => x.id === c.params[0] && !x.deletedAt);
      if (!cl) throw new NotFoundError('That closure was not found.');
      cl.deletedAt = nowIso();
    });
    await audit(c.user, 'closure.delete', { targetId: c.params[0] });
    return { ok: true };
  };

  // ---------- shift swaps, covers, and changes ----------
  async function applyRequest(r: ShiftRequest, users: User[]) {
    const requester = findUser(users, r.requesterId);
    const target = r.targetId ? findUser(users, r.targetId) : undefined;
    await update<OverridesDoc>(kv, `overrides/${monthKey(r.date)}`, () => ({}), (doc) => {
      const cur = (u: User) => effectiveShifts(u, r.date, doc).shifts;
      const day = (doc[r.date] ??= {});
      if (r.type === 'change') {
        day[requester.id] = r.proposedShifts ?? [];
      } else if (r.type === 'swap') {
        const a = cur(requester), b = cur(target!);
        day[requester.id] = b;
        day[target!.id] = a;
      } else {
        const a = cur(requester), b = cur(target!);
        day[target!.id] = sortShifts([...b, ...a]);
        day[requester.id] = [];
      }
    });
  }

  const listRequests: Handler = async (c) => {
    const since = addDays(today(c.settings), -30);
    const list = await read<ShiftRequest[]>(kv, 'requests', []);
    const mgr = isManager(c.user);
    return {
      requests: list
        .filter((r) => r.date >= since && (mgr || r.requesterId === c.user.id || r.targetId === c.user.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  };

  const createRequest: Handler = async (c) => {
    const b = c.body;
    const type = b.type as ShiftRequest['type'];
    if (!['swap', 'cover', 'change'].includes(type)) throw new ValidationError('Pick swap, cover, or change.');
    if (!isDate(b.date)) throw new ValidationError('Pick a date.');
    if (b.date < today(c.settings)) throw new ValidationError('Pick today or a future date.');
    const overrides = await loadOverrides([b.date]);
    const mine = effectiveShifts(c.user, b.date, overrides).shifts;
    const r: ShiftRequest = {
      id: crypto.randomUUID(), type, date: b.date, requesterId: c.user.id, requesterShifts: mine,
      note: str(b.note, 300, 'Note'), status: 'awaiting_peer', createdAt: nowIso(),
    };
    if (type === 'change') {
      r.proposedShifts = parseShifts(b.proposedShifts);
      r.status = c.settings.changesNeedApproval && !isManager(c.user) ? 'awaiting_manager' : 'approved';
    } else {
      const target = findUser(c.users, b.targetId);
      if (!target.active || target.id === c.user.id) throw new ValidationError('Pick a coworker.');
      if (type === 'cover' && !mine.length) throw new ValidationError('You don’t have a shift that day to cover.');
      r.targetId = target.id;
      r.targetShifts = effectiveShifts(target, b.date, overrides).shifts;
      if (type === 'swap' && !mine.length && !r.targetShifts.length) throw new ValidationError('Neither of you is scheduled that day.');
    }
    if (r.status === 'approved') { r.decidedAt = nowIso(); r.decidedBy = c.user.id; await applyRequest(r, c.users); }
    await update<ShiftRequest[]>(kv, 'requests', () => [], (list) => { list.push(r); });
    return { request: r };
  };

  /** Mutates a request with a transition, then applies the schedule change if it ended approved. */
  async function transition(c: Ctx, fn: (r: ShiftRequest) => void) {
    let out: ShiftRequest | undefined;
    await update<ShiftRequest[]>(kv, 'requests', () => [], (list) => {
      const r = list.find((x) => x.id === c.params[0]);
      if (!r) throw new NotFoundError('That request was not found.');
      fn(r);
      out = r;
    });
    if (out!.status === 'approved') await applyRequest(out!, c.users);
    return { request: out };
  }

  const respondRequest: Handler = (c) => transition(c, (r) => {
    if (r.targetId !== c.user.id) throw new AuthorizationError('This request isn’t addressed to you.');
    if (r.status !== 'awaiting_peer') throw new ConflictError('That request was already handled.');
    r.peerRespondedAt = nowIso();
    if (c.body.accept !== true) { r.status = 'declined'; return; }
    if (c.settings.swapsNeedApproval) { r.status = 'awaiting_manager'; return; }
    r.status = 'approved';
    r.decidedAt = nowIso();
    r.decidedBy = c.user.id;
  });

  const decideRequest: Handler = async (c) => {
    requireManager(c.user);
    const res = await transition(c, (r) => {
      if (r.status !== 'awaiting_manager' && r.status !== 'awaiting_peer') throw new ConflictError('That request was already handled.');
      r.status = c.body.approve === true ? 'approved' : 'denied';
      r.decidedAt = nowIso();
      r.decidedBy = c.user.id;
    });
    await audit(c.user, `request.${res.request!.status}`, { targetId: res.request!.id });
    return res;
  };

  const cancelRequest: Handler = (c) => transition(c, (r) => {
    if (r.requesterId !== c.user.id && !isManager(c.user)) throw new AuthorizationError();
    if (r.status !== 'awaiting_peer' && r.status !== 'awaiting_manager') throw new ConflictError('Only open requests can be cancelled.');
    r.status = 'cancelled';
    r.decidedAt = nowIso();
    r.decidedBy = c.user.id;
  });

  // ---------- people (manager) ----------
  const canEdit = (actor: User, target: User) =>
    actor.role === 'super' || actor.id === target.id || (actor.role === 'manager' && target.role === 'staff');

  const listUsers: Handler = async (c) => ({ users: c.users.map((u) => toPublic(u, isManager(c.user))) });

  const createUser: Handler = async (c) => {
    requireManager(c.user);
    const b = c.body;
    const username = normalizeUsername(b.username);
    validateUsername(username);
    const role = b.role === 'manager' || b.role === 'super' ? b.role : 'staff';
    if (role !== 'staff' && c.user.role !== 'super') throw new AuthorizationError('Only the owner account can add managers.');
    let created: User | undefined;
    await updateUsers((users) => {
      if (users.some((u) => u.username === username)) throw new ConflictError(`The username “${username}” is taken.`);
      created = {
        id: crypto.randomUUID(), username, displayName: str(b.displayName, 60, 'Name', true)!,
        title: str(b.title, 60, 'Title'), email: str(b.email, 120, 'Email'), role,
        color: typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : COLORS[users.length % COLORS.length],
        active: true, weekly: parseWeekly(b.weekly), passwordHash: null, tokenVersion: 0,
        gustoEmployeeUuid: str(b.gustoEmployeeUuid, 64, 'Gusto employee ID'),
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      users.push(created);
    });
    await audit(c.user, 'user.create', { targetId: created!.id, role });
    return { user: toPublic(created!, true) };
  };

  const updateUser: Handler = async (c) => {
    requireManager(c.user);
    const b = c.body;
    let out: User | undefined;
    await updateUsers((users) => {
      const u = findUser(users, c.params[0]);
      if (!canEdit(c.user, u)) throw new AuthorizationError('Managers can only edit staff accounts.');
      if (b.displayName !== undefined) u.displayName = str(b.displayName, 60, 'Name', true)!;
      if (b.title !== undefined) u.title = str(b.title, 60, 'Title');
      if (b.email !== undefined) u.email = str(b.email, 120, 'Email');
      if (b.gustoEmployeeUuid !== undefined) u.gustoEmployeeUuid = str(b.gustoEmployeeUuid, 64, 'Gusto employee ID');
      if (b.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(b.color)) u.color = b.color;
      if (b.weekly !== undefined) u.weekly = parseWeekly(b.weekly);
      if (b.username !== undefined) {
        const name = normalizeUsername(b.username);
        validateUsername(name);
        if (users.some((x) => x.username === name && x.id !== u.id)) throw new ConflictError(`The username “${name}” is taken.`);
        u.username = name;
      }
      if (b.role !== undefined && b.role !== u.role) {
        if (c.user.role !== 'super') throw new AuthorizationError('Only the owner account can change roles.');
        if (!['super', 'manager', 'staff'].includes(b.role)) throw new ValidationError('Unknown role.');
        if (u.id === c.user.id) throw new ValidationError('You can’t change your own role.');
        u.role = b.role;
      }
      if (b.active !== undefined && b.active !== u.active) {
        if (u.id === c.user.id) throw new ValidationError('You can’t deactivate your own account.');
        u.active = b.active === true;
        u.tokenVersion += 1;
      }
      if (!users.some((x) => x.role === 'super' && x.active)) throw new ValidationError('At least one active owner account is required.');
      u.updatedAt = nowIso();
      out = u;
    });
    await audit(c.user, 'user.update', { targetId: out!.id, fields: Object.keys(b) });
    return { user: toPublic(out!, true) };
  };

  const resetPassword: Handler = async (c) => {
    requireManager(c.user);
    let out: User | undefined;
    await updateUsers((users) => {
      const u = findUser(users, c.params[0]);
      if (u.id === c.user.id) throw new ValidationError('Use “Change password” for your own account.');
      if (!canEdit(c.user, u)) throw new AuthorizationError('Managers can only reset staff passwords.');
      u.passwordHash = null;
      u.tokenVersion += 1;
      u.updatedAt = nowIso();
      out = u;
    });
    await kv.delete(`attempts/${encodeURIComponent(out!.username)}`);
    await audit(c.user, 'user.reset_password', { targetId: out!.id });
    return { user: toPublic(out!, true) };
  };

  // ---------- settings (owner) ----------
  const saveSettings: Handler = async (c) => {
    if (c.user.role !== 'super') throw new AuthorizationError('Only the owner account can change settings.');
    const b = c.body;
    const tz = typeof b.timezone === 'string' ? b.timezone : c.settings.timezone;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { throw new ValidationError('Unknown timezone.'); }
    const next: Settings = {
      orgName: str(b.orgName, 80, 'Name', true)!,
      timezone: tz,
      weekStartsOn: b.weekStartsOn === 0 ? 0 : 1,
      showWeekends: b.showWeekends === true,
      swapsNeedApproval: b.swapsNeedApproval === true,
      changesNeedApproval: b.changesNeedApproval === true,
      timeOffNeedsApproval: b.timeOffNeedsApproval === true,
      clockReminder: str(b.clockReminder, 200, 'Reminder') ?? '',
    };
    await kv.set('settings', next);
    await audit(c.user, 'settings.update');
    return { settings: next };
  };

  // ---------- timesheets (manager) ----------
  const getTimesheets: Handler = async (c) => {
    requireManager(c.user);
    const from = c.url.searchParams.get('from'), to = c.url.searchParams.get('to');
    if (!isDate(from) || !isDate(to) || to < from) throw new ValidationError('Pick a date range.');
    const n = daysBetween(from, to) + 1;
    if (n > 62) throw new ValidationError('Pick 62 days or fewer.');
    const dates = Array.from({ length: n }, (_, i) => addDays(from, i));
    const all = await Promise.all(dates.map((d) => read<Punch[]>(kv, `punches/${d}`, [])));
    const t = today(c.settings);
    const rows: TimesheetRow[] = c.users.map((u) => {
      const days = dates
        .map((d, i) => ({ d, ps: all[i].filter((p) => p.userId === u.id) }))
        .filter((x) => x.ps.length)
        .map((x) => timesheetDay(x.d, x.ps, x.d === t ? nowIso() : undefined));
      return { userId: u.id, days, totalWorkedMinutes: days.reduce((s, d) => s + d.workedMinutes, 0) };
    }).filter((r) => r.days.length || c.users.find((u) => u.id === r.userId)?.active);
    return { from, to, rows };
  };

  // ---------- routing ----------
  type Route = [method: string, pattern: RegExp, handler: Handler | PublicHandler, isPublic?: boolean];
  const ID = '([0-9a-f-]{36})';
  const routes: Route[] = [
    ['POST', /^\/api\/auth\/lookup$/, lookup, true],
    ['POST', /^\/api\/auth\/login$/, login, true],
    ['POST', /^\/api\/auth\/setup$/, setup, true],
    ['POST', /^\/api\/auth\/logout$/, logout, true],
    ['GET', /^\/api\/me$/, getMe],
    ['POST', /^\/api\/me\/password$/, changePassword],
    ['GET', /^\/api\/board$/, getBoard],
    ['POST', /^\/api\/status$/, setStatus],
    ['GET', /^\/api\/schedule$/, getSchedule],
    ['PUT', /^\/api\/schedule\/day$/, setDay],
    ['GET', /^\/api\/timeoff$/, listTimeOff],
    ['POST', /^\/api\/timeoff$/, createTimeOff],
    ['POST', new RegExp(`^/api/timeoff/${ID}/decision$`), decideTimeOff],
    ['POST', new RegExp(`^/api/timeoff/${ID}/cancel$`), cancelTimeOff],
    ['GET', /^\/api\/closures$/, listClosures],
    ['POST', /^\/api\/closures$/, createClosure],
    ['DELETE', new RegExp(`^/api/closures/${ID}$`), deleteClosure],
    ['GET', /^\/api\/requests$/, listRequests],
    ['POST', /^\/api\/requests$/, createRequest],
    ['POST', new RegExp(`^/api/requests/${ID}/respond$`), respondRequest],
    ['POST', new RegExp(`^/api/requests/${ID}/decision$`), decideRequest],
    ['POST', new RegExp(`^/api/requests/${ID}/cancel$`), cancelRequest],
    ['GET', /^\/api\/users$/, listUsers],
    ['POST', /^\/api\/users$/, createUser],
    ['PATCH', new RegExp(`^/api/users/${ID}$`), updateUser],
    ['POST', new RegExp(`^/api/users/${ID}/reset-password$`), resetPassword],
    ['PUT', /^\/api\/settings$/, saveSettings],
    ['GET', /^\/api\/timesheets$/, getTimesheets],
  ];

  const json = (status: number, data: unknown, cookies: string[] = []) => {
    const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    for (const ck of cookies) headers.append('set-cookie', ck);
    return new Response(JSON.stringify(data), { status, headers });
  };

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const cookies: string[] = [];
    try {
      let match: RegExpMatchArray | null = null;
      const route = routes.find(([m, p]) => m === req.method && (match = url.pathname.match(p)));
      if (!route) throw new NotFoundError('Unknown endpoint.');
      const [, , handler, isPublic] = route;

      let body: any = {};
      if (req.method !== 'GET') {
        // CSRF guard: same-origin only, JSON only.
        const origin = req.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) throw new AuthorizationError('Cross-site request blocked.');
        const text = await req.text();
        if (text.length > 64_000) throw new ValidationError('Request too large.');
        if (text) {
          if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new ValidationError('Send JSON.');
          try { body = JSON.parse(text); } catch { throw new ValidationError('Invalid JSON.'); }
          if (!body || typeof body !== 'object') body = {};
        }
      }

      const [users, settings] = await Promise.all([loadUsers(), loadSettings()]);
      const base: PublicCtx = { req, url, params: (match as RegExpMatchArray | null)?.slice(1) ?? [], body, users, settings, cookies };

      if (isPublic) return json(200, await (handler as PublicHandler)(base), cookies);

      const token = readCookie(req, SESSION_COOKIE);
      const session = token ? await verifySession(await signingKey(), token) : null;
      const user = session && users.find((u) => u.id === session.userId);
      if (!session || !user || !user.active || user.tokenVersion !== session.tv) {
        if (token) cookies.push(sessionCookie(req, null));
        throw new AuthenticationError();
      }
      // Sliding session: refresh the cookie once a week of use.
      if (clock().getTime() / 1000 - session.iat > 7 * 86400) {
        cookies.push(sessionCookie(req, await signSession(await signingKey(), user.id, user.tokenVersion)));
      }
      return json(200, await (handler as Handler)({ ...base, user }), cookies);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message, code: e.code }, cookies);
      console.error(JSON.stringify({ level: 'error', path: url.pathname, message: (e as Error)?.message, stack: (e as Error)?.stack }));
      return json(500, { error: 'Something went wrong on our side. Try again in a moment.', code: 'internal' }, cookies);
    }
  };
}
