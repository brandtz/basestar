// End-to-end API check against in-memory storage: `pnpm test:api`
import assert from 'node:assert/strict';
import { createApp } from '../server/app';
import { MemoryKV } from '../server/store';

let now = new Date('2026-12-01T16:00:00Z'); // Tue 8:00 AM Pacific
const app = createApp(new MemoryKV(), { jwtSecret: 'x'.repeat(40), now: () => now });

class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown) {
    const res = await app(new Request(`https://basestar.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie, origin: 'https://basestar.test' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const set = res.headers.getSetCookie().find((c) => c.startsWith('bs_session='));
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json();
    return { status: res.status, data };
  }
  ok = async (method: string, path: string, body?: unknown) => {
    const r = await this.call(method, path, body);
    assert.equal(r.status, 200, `${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  fails = async (status: number, method: string, path: string, body?: unknown) => {
    const r = await this.call(method, path, body);
    assert.equal(r.status, status, `${method} ${path} expected ${status}, got ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
}

const step = (s: string) => console.log('✓', s);
const mindy = new Client(), ana = new Client(), ben = new Client(), stranger = new Client();

// --- First login: seeded owner with no password goes straight to "create password"
await stranger.fails(401, 'GET', '/api/me');
assert.deepEqual(await stranger.ok('POST', '/api/auth/lookup', { username: 'nobody' }), { next: 'unknown' });
let r = await mindy.ok('POST', '/api/auth/lookup', { username: 'Mindy.Brandt@ggearlylearning.com' });
assert.equal(r.next, 'setup');
r = await mindy.ok('POST', '/api/auth/login', { username: 'mindy.brandt@ggearlylearning.com', password: 'anything' });
assert.equal(r.next, 'setup');
await mindy.fails(400, 'POST', '/api/auth/setup', { username: 'mindy.brandt@ggearlylearning.com', password: 'short' });
r = await mindy.ok('POST', '/api/auth/setup', { username: 'mindy.brandt@ggearlylearning.com', password: 'growing-strong-2026' });
assert.equal(r.user.role, 'super');
await stranger.fails(409, 'POST', '/api/auth/setup', { username: 'mindy.brandt@ggearlylearning.com', password: 'hijack-attempt-1' });
step('seeded owner claims account with create-password flow; cannot be re-claimed');

// --- Owner creates staff
const weekly = { '1': [{ start: '07:30', end: '16:00', lunchStart: '12:00', lunchEnd: '12:30' }], '2': [{ start: '07:30', end: '16:00' }], '3': [{ start: '07:30', end: '16:00' }] };
const anaU = (await mindy.ok('POST', '/api/users', { displayName: 'Ana Ruiz', username: 'Ana.Ruiz', title: 'Lead teacher', weekly })).user;
const benU = (await mindy.ok('POST', '/api/users', { displayName: 'Ben Cole', username: 'ben.cole', weekly: { '2': [{ start: '09:00', end: '17:30' }] } })).user;
await mindy.fails(409, 'POST', '/api/users', { displayName: 'Dup', username: 'ana.ruiz' });
assert.equal(anaU.hasPassword, false);
step('owner creates users; duplicate usernames rejected');

// --- Staff first login + normal login
assert.equal((await ana.ok('POST', '/api/auth/lookup', { username: 'ana.ruiz' })).next, 'setup');
await ana.ok('POST', '/api/auth/setup', { username: 'ana.ruiz', password: 'ana-password-1' });
await ben.ok('POST', '/api/auth/setup', { username: 'ben.cole', password: 'ben-password-1' });
assert.equal((await stranger.ok('POST', '/api/auth/lookup', { username: 'ana.ruiz' })).next, 'password');
await stranger.fails(401, 'POST', '/api/auth/login', { username: 'ana.ruiz', password: 'wrong-password' });
const ana2 = new Client();
await ana2.ok('POST', '/api/auth/login', { username: 'ana.ruiz', password: 'ana-password-1' });
await ana.fails(403, 'POST', '/api/users', { displayName: 'X', username: 'x.y' });
await ana.fails(403, 'PUT', '/api/settings', {});
step('staff set passwords, log in, cannot use manager endpoints');

// --- Clock in / break / lunch / board
await ana.ok('POST', '/api/status', { action: 'clock_in' });
await ana.fails(409, 'POST', '/api/status', { action: 'clock_in' });
await ben.fails(409, 'POST', '/api/status', { action: 'break_start' });
now = new Date('2026-12-01T18:00:00Z'); // 10:00
await ana.ok('POST', '/api/status', { action: 'break_start' });
let board = await ben.ok('GET', '/api/board');
assert.equal(board.today, '2026-12-01');
const anaOnBoard = board.people.find((p: any) => p.userId === anaU.id);
assert.equal(anaOnBoard.state, 'break');
assert.equal(anaOnBoard.shifts[0].start, '07:30');
step('clock in and break show on team board');

now = new Date('2026-12-01T18:10:00Z');
await ana.ok('POST', '/api/status', { action: 'lunch_start' }); // break -> lunch directly
now = new Date('2026-12-01T18:40:00Z');
await ana.ok('POST', '/api/status', { action: 'back' });
now = new Date('2026-12-02T00:00:00Z'); // 4:00 PM
await ana.ok('POST', '/api/status', { action: 'clock_out' });
const ts = await mindy.ok('GET', '/api/timesheets?from=2026-12-01&to=2026-12-01');
const anaDay = ts.rows.find((x: any) => x.userId === anaU.id).days[0];
assert.equal(anaDay.onClockMinutes, 480);
assert.equal(anaDay.breakMinutes, 10);
assert.equal(anaDay.lunchMinutes, 30);
assert.equal(anaDay.workedMinutes, 450);
step('timesheet: 8h on clock, 10m paid break, 30m unpaid lunch = 7.5h worked');

// --- Manager clocks someone in on their behalf; stale status next day
await mindy.ok('POST', '/api/status', { action: 'clock_in', userId: benU.id });
await ana.fails(403, 'POST', '/api/status', { action: 'clock_out', userId: benU.id });
now = new Date('2026-12-02T01:00:00Z'); // 5:00 PM, Ben still on
let benDay = (await mindy.ok('GET', '/api/timesheets?from=2026-12-01&to=2026-12-01')).rows.find((x: any) => x.userId === benU.id).days[0];
assert.equal(benDay.open, true);
assert.equal(benDay.onClockMinutes, 60);
assert.deepEqual(benDay.flags, []);
now = new Date('2026-12-02T16:00:00Z'); // next day
benDay = (await mindy.ok('GET', '/api/timesheets?from=2026-12-01&to=2026-12-01')).rows.find((x: any) => x.userId === benU.id).days[0];
assert.deepEqual(benDay.flags, ['Missing clock-out']);
board = await ana.ok('GET', '/api/board');
const benOnBoard = board.people.find((p: any) => p.userId === benU.id);
assert.equal(benOnBoard.state, 'out');
assert.equal(benOnBoard.stale, true);
await ben.ok('POST', '/api/status', { action: 'clock_in' }); // allowed: yesterday's session was stale
now = new Date('2026-12-02T18:30:00Z'); // 10:30 AM
await mindy.ok('POST', '/api/status', { action: 'break_start', userId: benU.id, at: '10:00' });
assert.equal((await ana.ok('GET', '/api/board')).people.find((p: any) => p.userId === benU.id).since, '2026-12-02T18:00:00.000Z');
await mindy.fails(409, 'POST', '/api/status', { action: 'back', userId: benU.id, at: '09:59' }); // before last change
await mindy.fails(400, 'POST', '/api/status', { action: 'back', userId: benU.id, at: '10:45' }); // in the future
await ben.fails(403, 'POST', '/api/status', { action: 'back', at: '10:10' }); // staff can't backdate
await mindy.ok('POST', '/api/status', { action: 'back', userId: benU.id, at: '10:15' });
await mindy.ok('POST', '/api/status', { action: 'lunch_start', userId: benU.id });
await mindy.ok('POST', '/api/status', { action: 'back', userId: benU.id });
benDay = (await mindy.ok('GET', '/api/timesheets?from=2026-12-02&to=2026-12-02')).rows.find((x: any) => x.userId === benU.id).days[0];
assert.equal(benDay.breakMinutes, 15);
assert.equal(benDay.adjusted, true);
step('manager starts/ends break and lunch for someone, now or earlier today; entries are marked');
step('manager acts on behalf; open shifts count live today; forgotten clock-outs flagged and read as out the next day');

// --- Time off
const to = (await ana.ok('POST', '/api/timeoff', { startDate: '2026-12-09', endDate: '2026-12-09', type: 'vacation' })).timeOff;
assert.equal(to.status, 'pending');
board = await ben.ok('GET', '/api/board');
assert.equal(board.pendingForMe, 0);
assert.equal((await mindy.ok('GET', '/api/board')).pendingForMe, 1);
let sched = await ben.ok('GET', '/api/schedule?start=2026-12-09&days=1');
assert.equal(sched.days[0].entries.find((e: any) => e.userId === anaU.id).timeOff, undefined, 'pending hidden from coworkers');
await mindy.ok('POST', `/api/timeoff/${to.id}/decision`, { approve: true });
sched = await ben.ok('GET', '/api/schedule?start=2026-12-09&days=1');
const anaEntry = sched.days[0].entries.find((e: any) => e.userId === anaU.id);
assert.equal(anaEntry.timeOff.type, 'vacation');
assert.equal(anaEntry.shifts.length, 0);
step('time off: pending visible to manager only, approved clears the shift for everyone');

// --- Closures
const cl = (await mindy.ok('POST', '/api/closures', { name: 'Winter break', startDate: '2026-12-24', endDate: '2026-12-25' })).closure;
sched = await ana.ok('GET', '/api/schedule?start=2026-12-23&days=3');
assert.equal(sched.days[0].closure, undefined);
assert.equal(sched.days[1].closure.name, 'Winter break');
assert.equal(sched.days[2].entries.every((e: any) => e.shifts.length === 0), true);
await mindy.ok('DELETE', `/api/closures/${cl.id}`);
assert.equal((await ana.ok('GET', '/api/closures')).closures.length, 0);
step('closures blank the schedule and can be removed');

// --- Swap (no approval needed by default): Ana (7:30) <-> Ben (9:00) on Tue Dec 8
let req = (await ana.ok('POST', '/api/requests', { type: 'swap', date: '2026-12-08', targetId: benU.id, note: 'Dentist' })).request;
assert.equal(req.status, 'awaiting_peer');
await mindy.fails(403, 'POST', `/api/requests/${req.id}/respond`, { accept: true });
assert.equal((await ben.ok('GET', '/api/board')).pendingForMe, 1);
req = (await ben.ok('POST', `/api/requests/${req.id}/respond`, { accept: true })).request;
assert.equal(req.status, 'approved');
sched = await ana.ok('GET', '/api/schedule?start=2026-12-08&days=1');
const get = (id: string) => sched.days[0].entries.find((e: any) => e.userId === id);
assert.equal(get(anaU.id).shifts[0].start, '09:00');
assert.equal(get(benU.id).shifts[0].start, '07:30');
assert.equal(get(anaU.id).source, 'changed');
step('swap: peer accepts, both schedules update');

// --- Cover, then self change needing approval
req = (await ana.ok('POST', '/api/requests', { type: 'cover', date: '2026-12-16', targetId: benU.id })).request;
await ben.ok('POST', `/api/requests/${req.id}/respond`, { accept: true });
sched = await ana.ok('GET', '/api/schedule?start=2026-12-16&days=1');
assert.equal(get(anaU.id).shifts.length, 0);
assert.equal(get(benU.id).shifts[0].start, '07:30');
req = (await ana.ok('POST', '/api/requests', { type: 'change', date: '2026-12-15', proposedShifts: [{ start: '08:00', end: '14:00' }] })).request;
assert.equal(req.status, 'awaiting_manager');
await mindy.ok('POST', `/api/requests/${req.id}/decision`, { approve: true });
sched = await ana.ok('GET', '/api/schedule?start=2026-12-15&days=1');
assert.equal(get(anaU.id).shifts[0].end, '14:00');
step('cover moves the shift; own-hours change waits for manager approval');

// --- Manager edits a day and resets it
await mindy.ok('PUT', '/api/schedule/day', { userId: benU.id, date: '2026-12-22', shifts: [{ start: '10:00', end: '15:00' }] });
sched = await ana.ok('GET', '/api/schedule?start=2026-12-22&days=1');
assert.equal(get(benU.id).shifts[0].start, '10:00');
await mindy.ok('PUT', '/api/schedule/day', { userId: benU.id, date: '2026-12-22', shifts: null });
sched = await ana.ok('GET', '/api/schedule?start=2026-12-22&days=1');
assert.equal(get(benU.id).shifts[0].start, '09:00');
step('manager edits a single day and resets it to regular');

// --- Password reset + deactivate kill sessions
await mindy.ok('POST', `/api/users/${anaU.id}/reset-password`);
await ana.fails(401, 'GET', '/api/me');
assert.equal((await ana.ok('POST', '/api/auth/lookup', { username: 'ana.ruiz' })).next, 'setup');
await mindy.ok('PATCH', `/api/users/${benU.id}`, { active: false });
await ben.fails(401, 'GET', '/api/board');
assert.equal((await ben.ok('POST', '/api/auth/lookup', { username: 'ben.cole' })).next, 'unknown');
await mindy.fails(400, 'PATCH', `/api/users/${(await mindy.ok('GET', '/api/me')).user.id}`, { active: false });
step('reset password forces re-setup; deactivation signs out and blocks login; owner cannot lock self out');

// --- Lockout after repeated failures
const brute = new Client();
await ana.ok('POST', '/api/auth/setup', { username: 'ana.ruiz', password: 'ana-password-2' });
for (let i = 0; i < 8; i++) await brute.fails(401, 'POST', '/api/auth/login', { username: 'ana.ruiz', password: 'nope' + i });
await brute.fails(429, 'POST', '/api/auth/login', { username: 'ana.ruiz', password: 'ana-password-2' });
step('8 bad passwords lock the account for 15 minutes');

// --- CSRF guard
const evil = await app(new Request('https://basestar.test/api/status', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: mindy.cookie },
  body: JSON.stringify({ action: 'clock_in' }),
}));
assert.equal(evil.status, 403);
step('cross-site POST blocked');

console.log('\nAll API checks passed.');
