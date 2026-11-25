<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DayEntry, ScheduleDay, Shift, ShiftRequestType } from '../../shared/types';
import { addDays, startOfWeek, toMinutes, weekdayOf, zonedNow } from '../../shared/time';
import { api, get } from '../api';
import { activeUsers, attempt, isManager, state, tz, usersById } from '../state';
import { dayLong, dayMed, dayNum, monthDay, shiftsShort, shiftsText, time12, TIME_OFF_LABEL, weekdayShort } from '../format';
import Avatar from '../components/Avatar.vue';
import Icon from '../components/Icon.vue';
import Sheet from '../components/Sheet.vue';
import ShiftEditor from '../components/ShiftEditor.vue';
import ShiftRequestForm from '../components/ShiftRequestForm.vue';
import TimeOffForm from '../components/TimeOffForm.vue';

type Mode = 'day' | 'week' | 'team';
const mode = ref<Mode>('day');
const date = ref(state.today);
const days = ref<ScheduleDay[]>([]);
const loading = ref(false);
const error = ref('');

const weekStartsOn = computed(() => state.settings?.weekStartsOn ?? 1);
const weekStart = computed(() => startOfWeek(date.value, weekStartsOn.value));
const isThisWeek = computed(() => weekStart.value === startOfWeek(state.today, weekStartsOn.value));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const start = mode.value === 'day' ? date.value : weekStart.value;
    const r = await get<{ days: ScheduleDay[]; today: string }>(`/schedule?start=${start}&days=${mode.value === 'day' ? 1 : 7}`);
    days.value = r.days;
    state.today = r.today;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([mode, () => (mode.value === 'day' ? date.value : weekStart.value)], load, { immediate: true });

function shift(n: number) { date.value = addDays(date.value, mode.value === 'day' ? n : 7 * n); }
function toToday() { date.value = state.today; }

const navLabel = computed(() => {
  if (mode.value === 'day') return { main: dayLong(date.value), sub: date.value === state.today ? 'Today' : '' };
  const vis = visibleDays.value;
  const a = vis[0]?.date ?? weekStart.value, b = vis[vis.length - 1]?.date ?? addDays(weekStart.value, 6);
  return { main: `${monthDay(a)} – ${monthDay(b)}`, sub: isThisWeek.value ? 'This week' : '' };
});

// Hide weekend columns unless enabled or someone is actually scheduled.
const visibleDays = computed(() => days.value.filter((d) => {
  if (state.settings?.showWeekends) return true;
  const wd = weekdayOf(d.date);
  return (wd !== 0 && wd !== 6) || d.entries.some((e) => e.shifts.length);
}));

const entryFor = (d: ScheduleDay, uid: string) => d.entries.find((e) => e.userId === uid);
const myEntry = (d: ScheduleDay) => entryFor(d, state.me!.id);
const name = (uid: string) => usersById.value.get(uid)?.displayName ?? '';

// ----- day timeline -----
const today = computed(() => days.value[0]);
const working = computed(() => (today.value?.entries ?? [])
  .filter((e) => e.shifts.length)
  .sort((a, b) => a.shifts[0].start.localeCompare(b.shifts[0].start) || name(a.userId).localeCompare(name(b.userId))));
const awayToday = computed(() => (today.value?.entries ?? []).filter((e) => !e.shifts.length && e.timeOff));
const offToday = computed(() => (today.value?.entries ?? []).filter((e) => !e.shifts.length && !e.timeOff));
const range = computed(() => {
  const all = working.value.flatMap((e) => e.shifts);
  let lo = 7 * 60, hi = 18 * 60;
  if (all.length) {
    lo = Math.floor(Math.min(...all.map((s) => toMinutes(s.start))) / 60) * 60;
    hi = Math.ceil(Math.max(...all.map((s) => toMinutes(s.end))) / 60) * 60;
  }
  return { lo, hi, span: Math.max(60, hi - lo) };
});
const pct = (m: number) => `${((m - range.value.lo) / range.value.span) * 100}%`;
const ticks = computed(() => {
  const out: { m: number; label: string }[] = [];
  const step = range.value.span > 10 * 60 ? 180 : 120;
  for (let m = range.value.lo; m <= range.value.hi; m += step) {
    const h = m / 60;
    out.push({ m, label: `${h % 12 || 12}${h < 12 ? 'a' : 'p'}` });
  }
  return out;
});
const nowLine = computed(() => {
  if (date.value !== state.today) return null;
  const m = zonedNow(tz()).minutes;
  return m >= range.value.lo && m <= range.value.hi ? pct(m) : null;
});

// ----- detail sheet -----
const detail = ref<{ date: string; userId: string } | null>(null);
const detailDay = computed(() => days.value.find((d) => d.date === detail.value?.date));
const detailEntry = computed<DayEntry | undefined>(() => (detailDay.value && detail.value ? entryFor(detailDay.value, detail.value.userId) : undefined));
const isMe = computed(() => detail.value?.userId === state.me?.id);
const isFuture = computed(() => !!detail.value && detail.value.date >= state.today);
const editing = ref(false);
const draft = ref<Shift[]>([]);
const form = ref<null | { kind: 'request'; type: ShiftRequestType; targetId?: string } | { kind: 'timeoff' }>(null);

function open(d: string, userId: string) { detail.value = { date: d, userId }; editing.value = false; form.value = null; }
function startEdit() { draft.value = (detailEntry.value?.shifts ?? []).map((s) => ({ ...s })); editing.value = true; }
async function saveDay(shifts: Shift[] | null, msg: string) {
  const ok = await attempt(() => api('PUT', '/schedule/day', { userId: detail.value!.userId, date: detail.value!.date, shifts }), msg);
  if (ok) { editing.value = false; await load(); }
}
async function formDone() { form.value = null; detail.value = null; await load(); }

function timeOffText(e: DayEntry) {
  const t = e.timeOff!;
  const base = TIME_OFF_LABEL[t.type];
  const when = t.allDay ? '' : ` ${time12(t.startTime)} – ${time12(t.endTime)}`;
  return `${base}${when}${t.status === 'pending' ? ' (pending)' : ''}`;
}
</script>

<template>
  <div class="page">
    <div class="seg" role="group" aria-label="Schedule view">
      <button :aria-pressed="mode === 'day'" @click="mode = 'day'">Day</button>
      <button :aria-pressed="mode === 'week'" @click="mode = 'week'">My week</button>
      <button :aria-pressed="mode === 'team'" @click="mode = 'team'">Team</button>
    </div>

    <div class="datenav">
      <button class="icon-btn" :aria-label="mode === 'day' ? 'Previous day' : 'Previous week'" @click="shift(-1)"><Icon name="chev-left" /></button>
      <div class="datenav-label">{{ navLabel.main }}<small>{{ navLabel.sub || ' ' }}</small></div>
      <button class="icon-btn" :aria-label="mode === 'day' ? 'Next day' : 'Next week'" @click="shift(1)"><Icon name="chev-right" /></button>
    </div>
    <button v-if="(mode === 'day' && date !== state.today) || (mode !== 'day' && !isThisWeek)" class="btn btn-ghost btn-small" style="justify-self: center; margin-top: -14px" @click="toToday">
      Back to {{ mode === 'day' ? 'today' : 'this week' }}
    </button>

    <div v-if="error" class="empty">{{ error }}</div>

    <!-- DAY -->
    <template v-else-if="mode === 'day' && today">
      <div v-if="today.closure" class="banner banner-closed"><Icon name="closed" style="width: 22px; height: 22px" />Closed: {{ today.closure.name }}</div>
      <button v-if="myEntry(today)" class="myshift" :class="{ off: !myEntry(today)!.shifts.length }" style="border: 0; text-align: left; cursor: pointer" @click="open(today.date, state.me!.id)">
        <span class="myshift-sub">Your hours</span>
        <span class="myshift-time">{{ today.closure ? 'Closed' : myEntry(today)!.timeOff?.allDay && myEntry(today)!.timeOff?.status === 'approved' ? TIME_OFF_LABEL[myEntry(today)!.timeOff!.type] : shiftsText(myEntry(today)!.shifts) }}</span>
        <span v-for="(s, i) in myEntry(today)!.shifts.filter((x) => x.lunchStart)" :key="i" class="myshift-sub">Lunch {{ time12(s.lunchStart) }} – {{ time12(s.lunchEnd) }}</span>
        <span v-if="myEntry(today)!.source === 'changed'" class="myshift-sub">Changed from your regular hours</span>
        <span v-if="myEntry(today)!.timeOff && !(myEntry(today)!.timeOff!.allDay && myEntry(today)!.timeOff!.status === 'approved')" class="myshift-sub">{{ timeOffText(myEntry(today)!) }}</span>
      </button>

      <section v-if="!today.closure">
        <div class="section-head"><h2 class="section-title">Working <span class="count">{{ working.length }}</span></h2></div>
        <div v-if="!working.length" class="empty">No one is scheduled.</div>
        <div v-else class="timeline">
          <div class="tl-axis">
            <span />
            <div class="tl-ticks"><span v-for="t in ticks" :key="t.m" :style="{ left: pct(t.m) }">{{ t.label }}</span></div>
          </div>
          <button v-for="e in working" :key="e.userId" class="tl-row" @click="open(today.date, e.userId)">
            <span class="tl-name">{{ name(e.userId) }}<span v-if="e.timeOff" class="faint" style="display: block; font-size: 0.72rem">{{ timeOffText(e) }}</span></span>
            <span class="tl-track">
              <template v-for="(s, i) in e.shifts" :key="i">
                <span class="tl-bar" :style="{ left: pct(toMinutes(s.start)), width: `calc(${pct(toMinutes(s.end))} - ${pct(toMinutes(s.start))})`, background: usersById.get(e.userId)?.color }" :title="shiftsText([s])" />
                <span v-if="s.lunchStart" class="tl-lunch" :style="{ left: pct(toMinutes(s.lunchStart)), width: `calc(${pct(toMinutes(s.lunchEnd!))} - ${pct(toMinutes(s.lunchStart))})` }" :title="`Lunch ${time12(s.lunchStart)}`" />
              </template>
              <span v-if="nowLine" class="tl-now" :style="{ left: nowLine }" />
            </span>
          </button>
        </div>
        <div class="legend" style="margin-top: 8px"><span><span class="swatch" style="background: repeating-linear-gradient(-45deg, #bbb 0 3px, #eee 3px 6px)" />Planned lunch</span><span v-if="nowLine"><span class="swatch" style="background: var(--danger); width: 3px" />Now</span></div>
      </section>

      <section v-if="awayToday.length">
        <div class="section-head"><h2 class="section-title">Off</h2></div>
        <div class="list">
          <button v-for="e in awayToday" :key="e.userId" class="list-row" @click="open(today.date, e.userId)">
            <Avatar :user-id="e.userId" size="sm" />
            <div class="list-row-main"><div class="list-row-title">{{ name(e.userId) }}</div><div class="list-row-sub">{{ timeOffText(e) }}</div></div>
          </button>
        </div>
      </section>
      <p v-if="offToday.length && !today.closure" class="faint">Not scheduled: {{ offToday.map((e) => name(e.userId)).join(', ') }}</p>
    </template>

    <!-- MY WEEK -->
    <div v-else-if="mode === 'week'" class="weeklist">
      <button v-for="d in visibleDays" :key="d.date" class="weekday" :class="{ 'is-today': d.date === state.today }" @click="open(d.date, state.me!.id)">
        <div class="weekday-date"><span>{{ weekdayShort(d.date) }}</span><b>{{ dayNum(d.date) }}</b></div>
        <div class="weekday-main">
          <template v-if="d.closure"><span class="weekday-hours">Closed</span><span class="faint">{{ d.closure.name }}</span></template>
          <template v-else-if="myEntry(d)">
            <span class="weekday-hours">{{ myEntry(d)!.timeOff?.allDay && myEntry(d)!.timeOff?.status === 'approved' ? TIME_OFF_LABEL[myEntry(d)!.timeOff!.type] : shiftsText(myEntry(d)!.shifts) }}</span>
            <span v-for="(s, i) in myEntry(d)!.shifts.filter((x) => x.lunchStart)" :key="i" class="small" style="color: var(--plum); font-weight: 700">Lunch {{ time12(s.lunchStart) }}</span>
            <span style="display: flex; gap: 6px; flex-wrap: wrap">
              <span v-if="myEntry(d)!.source === 'changed'" class="pill pill-teal">Changed</span>
              <span v-if="myEntry(d)!.timeOff && !(myEntry(d)!.timeOff!.allDay && myEntry(d)!.timeOff!.status === 'approved')" class="pill pill-plum">{{ timeOffText(myEntry(d)!) }}</span>
            </span>
          </template>
        </div>
      </button>
    </div>

    <!-- TEAM -->
    <template v-else-if="mode === 'team'">
      <div class="grid-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="who" scope="col"><span class="faint">Team</span></th>
              <th v-for="d in visibleDays" :key="d.date" scope="col" :class="{ 'is-today': d.date === state.today }">{{ weekdayShort(d.date) }}<b>{{ dayNum(d.date) }}</b></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in activeUsers" :key="u.id">
              <th class="who" scope="row"><span class="who-name">{{ u.displayName.split(' ')[0] }} {{ u.displayName.split(' ')[1]?.[0] ?? '' }}</span></th>
              <td v-for="d in visibleDays" :key="d.date" :class="{ 'cell-closed': d.closure }">
                <button class="cell" :aria-label="`${u.displayName}, ${dayMed(d.date)}`" @click="open(d.date, u.id)">
                  <template v-if="d.closure"><span class="cell-off">Closed</span></template>
                  <template v-else-if="entryFor(d, u.id)?.timeOff?.allDay && (entryFor(d, u.id)!.timeOff!.status === 'approved' || !entryFor(d, u.id)!.shifts.length)">
                    <span class="cell-to" :class="{ pending: entryFor(d, u.id)!.timeOff!.status === 'pending' }">{{ TIME_OFF_LABEL[entryFor(d, u.id)!.timeOff!.type] }}</span>
                  </template>
                  <template v-else-if="entryFor(d, u.id)?.shifts.length">
                    <span class="cell-shift" :class="{ 'cell-changed': entryFor(d, u.id)!.source === 'changed' }" :style="{ background: `color-mix(in srgb, ${u.color} 16%, white)` }">
                      {{ shiftsShort(entryFor(d, u.id)!.shifts) }}
                      <span v-if="entryFor(d, u.id)!.timeOff" style="display: block; color: var(--plum)">+ off</span>
                    </span>
                  </template>
                  <span v-else class="cell-off">–</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="legend">
        <span><span class="swatch" style="box-shadow: inset 0 0 0 1.5px var(--teal)" />Changed for that day</span>
        <span><span class="swatch" style="background: var(--plum-tint)" />Time off</span>
        <span><span class="swatch" style="background: repeating-linear-gradient(-45deg, var(--plum-tint) 0 3px, #fff 3px 6px)" />Pending</span>
        <span><span class="swatch cell-closed" />Closed</span>
      </div>
    </template>

    <div v-if="loading && !days.length" class="empty">Loading…</div>

    <!-- Detail sheet -->
    <Sheet v-if="detail && detailEntry" :title="`${isMe ? 'You' : name(detail.userId)}, ${dayMed(detail.date)}`" @close="detail = null">
      <template v-if="form?.kind === 'request'">
        <ShiftRequestForm :type="form.type" :date="detail.date" :target-id="form.targetId" @done="formDone" />
      </template>
      <template v-else-if="form?.kind === 'timeoff'">
        <TimeOffForm :date="detail.date" :user-id="detail.userId" @done="formDone" />
      </template>
      <template v-else>
        <div class="panel">
          <div v-if="detailDay?.closure" style="font-weight: 800; font-size: 1.2rem">Closed: {{ detailDay.closure.name }}</div>
          <template v-else>
            <div style="font-weight: 800; font-size: 1.25rem">{{ shiftsText(detailEntry.shifts) }}</div>
            <div v-for="(s, i) in detailEntry.shifts.filter((x) => x.lunchStart)" :key="i" class="small" style="color: var(--plum); font-weight: 700">Planned lunch {{ time12(s.lunchStart) }} – {{ time12(s.lunchEnd) }}</div>
            <div v-if="detailEntry.source === 'changed'" class="faint">Changed from regular hours</div>
            <div v-if="detailEntry.timeOff" class="small" style="margin-top: 6px"><span class="pill pill-plum">{{ timeOffText(detailEntry) }}</span><span v-if="detailEntry.timeOff.note" class="muted"> {{ detailEntry.timeOff.note }}</span></div>
          </template>
        </div>

        <template v-if="isFuture && !detailDay?.closure && !editing">
          <div v-if="isMe" class="list">
            <button class="list-row" @click="form = { kind: 'request', type: 'change' }"><Icon name="clock" class="chev" style="color: var(--teal)" /><div class="list-row-main"><div class="list-row-title">Change my hours</div></div><Icon name="chev-right" class="chev" /></button>
            <button v-if="detailEntry.shifts.length" class="list-row" @click="form = { kind: 'request', type: 'cover' }"><Icon name="team" class="chev" style="color: var(--teal)" /><div class="list-row-main"><div class="list-row-title">Ask someone to cover</div></div><Icon name="chev-right" class="chev" /></button>
            <button class="list-row" @click="form = { kind: 'request', type: 'swap' }"><Icon name="swap" class="chev" style="color: var(--teal)" /><div class="list-row-main"><div class="list-row-title">Swap with someone</div></div><Icon name="chev-right" class="chev" /></button>
            <button class="list-row" @click="form = { kind: 'timeoff' }"><Icon name="sun" class="chev" style="color: var(--teal)" /><div class="list-row-main"><div class="list-row-title">Request time off</div></div><Icon name="chev-right" class="chev" /></button>
          </div>
          <div v-else class="list">
            <button class="list-row" @click="form = { kind: 'request', type: 'swap', targetId: detail.userId }"><Icon name="swap" class="chev" style="color: var(--teal)" /><div class="list-row-main"><div class="list-row-title">Ask {{ name(detail.userId).split(' ')[0] }} to swap</div><div class="list-row-sub">Trade your shifts for this day</div></div><Icon name="chev-right" class="chev" /></button>
          </div>
        </template>

        <div v-if="isManager && !detailDay?.closure" class="panel" style="display: grid; gap: 12px">
          <template v-if="!editing">
            <div class="faint">Manager</div>
            <div class="btn-row">
              <button class="btn btn-quiet btn-small" @click="startEdit">Edit hours for this day</button>
              <button v-if="detailEntry.source === 'changed'" class="btn btn-quiet btn-small" @click="saveDay(null, 'Back to regular hours')">Reset to regular</button>
              <button v-if="!isMe" class="btn btn-quiet btn-small" @click="form = { kind: 'timeoff' }">Add time off</button>
            </div>
          </template>
          <template v-else>
            <div style="font-weight: 800">Hours on {{ dayMed(detail.date) }}</div>
            <ShiftEditor v-model="draft" allow-empty />
            <span v-if="!draft.length" class="faint">No hours means off that day.</span>
            <div class="btn-row">
              <button class="btn btn-quiet" @click="editing = false">Cancel</button>
              <button class="btn" @click="saveDay(draft, 'Hours saved')">Save</button>
            </div>
          </template>
        </div>
      </template>
    </Sheet>
  </div>
</template>
