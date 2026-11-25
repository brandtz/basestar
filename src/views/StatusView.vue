<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { BoardPerson, StatusEntry, WorkState } from '../../shared/types';
import { toMinutes, zonedNow } from '../../shared/time';
import { post } from '../api';
import { boardState, refreshBoard } from '../board';
import { attempt, isManager, state, toast, tz, usersById } from '../state';
import { clockOf, duration, minutesSince, shiftRange, shiftsText, time12, TIME_OFF_LABEL } from '../format';
import Avatar from '../components/Avatar.vue';
import Icon from '../components/Icon.vue';
import Sheet from '../components/Sheet.vue';

const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;
onMounted(() => { tick = setInterval(() => (now.value = Date.now()), 20_000); if (Date.now() - boardState.fetchedAt > 5_000) refreshBoard(); });
onBeforeUnmount(() => clearInterval(tick));

const board = computed(() => boardState.board);
const nowMin = computed(() => { void now.value; return zonedNow(tz()).minutes; });
const people = computed(() => (board.value?.people ?? []).filter((p) => usersById.value.has(p.userId)));
const me = computed(() => people.value.find((p) => p.userId === state.me?.id));
const name = (p: BoardPerson) => usersById.value.get(p.userId)?.displayName ?? '';
const byName = (a: BoardPerson, b: BoardPerson) => name(a).localeCompare(name(b));

const away = computed(() => people.value.filter((p) => p.state === 'break' || p.state === 'lunch').sort((a, b) => (a.since ?? '').localeCompare(b.since ?? '')));
const available = computed(() => people.value.filter((p) => p.state === 'in').sort(byName));
const notIn = computed(() => {
  const list = people.value.filter((p) => p.state === 'out');
  const upcoming = (p: BoardPerson) => p.shifts.find((s) => toMinutes(s.end) > nowMin.value);
  return list.sort((a, b) => {
    const ua = upcoming(a), ub = upcoming(b);
    if (ua && ub) return ua.start.localeCompare(ub.start);
    if (ua) return -1;
    if (ub) return 1;
    return byName(a, b);
  });
});
const breaks = computed(() => away.value.filter((p) => p.state === 'break').length);
const lunches = computed(() => away.value.filter((p) => p.state === 'lunch').length);

function partialOff(p: BoardPerson) {
  const t = p.timeOff;
  if (!t || t.allDay) return '';
  return `Out ${time12(t.startTime)} – ${time12(t.endTime)}${t.status === 'pending' ? ' (pending)' : ''}`;
}

function outReason(p: BoardPerson): string {
  if (board.value?.closure) return 'Center closed today';
  if (p.timeOff?.allDay && p.timeOff.status === 'approved') return TIME_OFF_LABEL[p.timeOff.type];
  if (p.stale) return 'Still clocked in from a previous day';
  if (p.since) return `Clocked out at ${clockOf(p.since)}`;
  if (!p.shifts.length) return 'Not scheduled today';
  const n = nowMin.value;
  const next = p.shifts.find((s) => toMinutes(s.start) > n);
  const cur = p.shifts.find((s) => toMinutes(s.start) <= n && n < toMinutes(s.end));
  if (cur) return `Scheduled ${shiftRange(cur)}, not clocked in`;
  if (next) return `Starts at ${time12(next.start)}`;
  return 'Done for the day';
}

function availableSub(p: BoardPerson): string {
  const off = partialOff(p);
  if (off) return off;
  const n = nowMin.value;
  const cur = p.shifts.find((s) => toMinutes(s.start) <= n + 30 && n < toMinutes(s.end));
  const lunch = p.shifts.find((s) => s.lunchStart && toMinutes(s.lunchStart) > n);
  if (lunch && toMinutes(lunch.lunchStart!) - n <= 90) return `Lunch at ${time12(lunch.lunchStart)}`;
  if (cur) return `Until ${time12(cur.end)}`;
  return p.clockedInAt ? `In since ${clockOf(p.clockedInAt)}` : '';
}

// ----- my status -----
const STATE_TEXT: Record<WorkState, string> = { out: 'You’re not clocked in', in: 'You’re available', break: 'You’re on break', lunch: 'You’re at lunch' };
const busy = ref(false);
const DONE: Record<string, string> = { clock_in: 'Clocked in', clock_out: 'Clocked out', break_start: 'Break started', lunch_start: 'Lunch started', back: 'Welcome back' };

async function act(action: string, userId?: string) {
  busy.value = true;
  const ok = await attempt(async () => {
    const r = await post<{ status: StatusEntry }>('/status', { action, userId });
    const p = board.value?.people.find((x) => x.userId === (userId ?? state.me?.id));
    if (p) {
      p.state = r.status.state;
      p.since = r.status.since;
      p.clockedInAt = r.status.clockedInAt;
      p.stale = undefined;
    }
  });
  busy.value = false;
  if (ok) {
    const who = userId && userId !== state.me?.id ? `${usersById.value.get(userId)?.displayName.split(' ')[0]}: ` : '';
    toast(who + DONE[action]);
    refreshBoard();
  }
}

const myShiftLine = computed(() => {
  if (!me.value) return '';
  if (board.value?.closure) return `Closed today: ${board.value.closure.name}`;
  if (me.value.timeOff?.allDay && me.value.timeOff.status === 'approved') return `You’re off today (${TIME_OFF_LABEL[me.value.timeOff.type].toLowerCase()})`;
  return me.value.shifts.length ? `Today ${shiftsText(me.value.shifts)}` : 'Not scheduled today';
});

// ----- person detail -----
const selected = ref<BoardPerson | null>(null);
const selUser = computed(() => (selected.value ? usersById.value.get(selected.value.userId) : undefined));
const live = computed(() => (selected.value ? people.value.find((p) => p.userId === selected.value!.userId) ?? selected.value : null));
const STATE_LABEL: Record<WorkState, string> = { out: 'Not in', in: 'Available', break: 'On break', lunch: 'At lunch' };
</script>

<template>
  <div class="page">
    <div v-if="board?.closure" class="banner banner-closed"><Icon name="closed" style="width: 22px; height: 22px" />Closed today: {{ board.closure.name }}</div>

    <!-- My status: the door sign -->
    <section v-if="me" class="door" :data-state="me.state" aria-live="polite">
      <div>
        <h2 class="door-state">{{ STATE_TEXT[me.state] }}</h2>
        <p class="door-since">
          <template v-if="me.state === 'out'">{{ myShiftLine }}</template>
          <template v-else-if="me.state === 'in'">Clocked in at {{ clockOf(me.clockedInAt) }}</template>
          <template v-else>Since {{ clockOf(me.since) }}, {{ duration(minutesSince(me.since, now)) }}</template>
        </p>
        <p v-if="me.stale" class="door-note" style="margin-top: 6px">You were still clocked in from a previous day. Clock in to start today, and let your director know when you actually left.</p>
      </div>

      <div v-if="me.state === 'out'" class="door-actions">
        <button class="door-btn go wide" :disabled="busy" @click="act('clock_in')"><Icon name="in" />Clock in</button>
        <p v-if="state.settings?.clockReminder" class="door-note wide">{{ state.settings.clockReminder }}</p>
      </div>
      <div v-else-if="me.state === 'in'" class="door-actions">
        <button class="door-btn sun" :disabled="busy" @click="act('break_start')"><Icon name="coffee" />Break</button>
        <button class="door-btn plum" :disabled="busy" @click="act('lunch_start')"><Icon name="lunch" />Lunch</button>
        <button class="door-btn soft wide" :disabled="busy" @click="act('clock_out')"><Icon name="out" />Clock out</button>
      </div>
      <div v-else class="door-actions">
        <button class="door-btn wide" :disabled="busy" @click="act('back')"><Icon name="back" />I’m back</button>
        <button v-if="me.state === 'break'" class="door-btn soft" :disabled="busy" @click="act('lunch_start')">Switch to lunch</button>
        <button v-else class="door-btn soft" :disabled="busy" @click="act('break_start')">Switch to break</button>
        <button class="door-btn soft" :disabled="busy" @click="act('clock_out')">Clock out</button>
      </div>
    </section>

    <div v-if="!board && boardState.loading" class="empty">Loading the team…</div>
    <div v-else-if="!board && boardState.error" class="empty">{{ boardState.error }} <button class="btn btn-ghost" @click="refreshBoard">Try again</button></div>

    <template v-if="board">
      <div class="tally" aria-label="Team summary">
        <span class="tally-item"><span class="swatch" style="background: var(--leaf)" /><b>{{ available.length }}</b> available</span>
        <span class="tally-item"><span class="swatch" style="background: var(--sun)" /><b>{{ breaks }}</b> on break</span>
        <span class="tally-item"><span class="swatch" style="background: var(--plum)" /><b>{{ lunches }}</b> at lunch</span>
        <span class="tally-item"><span class="swatch" style="background: var(--pebble)" /><b>{{ notIn.length }}</b> not in</span>
      </div>

      <section>
        <div class="section-head"><h2 class="section-title">On break or at lunch</h2></div>
        <div v-if="!away.length" class="empty">Nobody’s away right now.</div>
        <button v-for="p in away" :key="p.userId" class="away-card" :data-state="p.state" @click="selected = p">
          <Avatar :user-id="p.userId" :state="p.state" />
          <div>
            <div class="away-name">{{ name(p) }}</div>
            <div class="away-meta">{{ p.state === 'break' ? 'On break' : 'At lunch' }} since {{ clockOf(p.since) }}</div>
          </div>
          <div class="away-mins">{{ minutesSince(p.since, now) || 'now' }}<small v-if="minutesSince(p.since, now)">min</small></div>
        </button>
      </section>

      <section>
        <div class="section-head"><h2 class="section-title">Available <span class="count">{{ available.length }}</span></h2></div>
        <div v-if="!available.length" class="empty">No one is clocked in yet.</div>
        <div v-else class="tags">
          <button v-for="p in available" :key="p.userId" class="tag" @click="selected = p">
            <Avatar :user-id="p.userId" state="in" size="sm" />
            <div>
              <div class="tag-name">{{ name(p) }}</div>
              <div class="tag-sub">{{ availableSub(p) || usersById.get(p.userId)?.title }}</div>
            </div>
          </button>
        </div>
      </section>

      <section>
        <div class="section-head"><h2 class="section-title">Not in <span class="count">{{ notIn.length }}</span></h2></div>
        <div class="list">
          <button v-for="p in notIn" :key="p.userId" class="list-row out-row" @click="selected = p">
            <Avatar :user-id="p.userId" size="sm" />
            <div class="list-row-main">
              <div class="list-row-title">{{ name(p) }}</div>
              <div class="list-row-sub">{{ outReason(p) }}<template v-if="partialOff(p)">. {{ partialOff(p) }}</template></div>
            </div>
          </button>
        </div>
      </section>

      <p class="updated">
        Updated {{ clockOf(board.now) }}
        <button class="btn btn-ghost btn-small" :disabled="boardState.loading" @click="refreshBoard"><Icon name="refresh" style="width: 16px; height: 16px" />Refresh</button>
      </p>
    </template>

    <Sheet v-if="live && selUser" :title="selUser.displayName" @close="selected = null">
      <div class="panel" style="display: flex; gap: 14px; align-items: center">
        <Avatar :user-id="live.userId" :state="live.state" size="lg" />
        <div>
          <div style="font-weight: 800; font-size: 1.2rem">{{ STATE_LABEL[live.state] }}</div>
          <div class="muted small">
            <template v-if="live.state === 'break' || live.state === 'lunch'">Since {{ clockOf(live.since) }}, {{ duration(minutesSince(live.since, now)) }}</template>
            <template v-else-if="live.state === 'in'">Clocked in at {{ clockOf(live.clockedInAt) }}</template>
            <template v-else>{{ outReason(live) }}</template>
          </div>
          <div v-if="selUser.title" class="faint">{{ selUser.title }}</div>
        </div>
      </div>
      <div class="panel">
        <div class="faint">Today’s hours</div>
        <div style="font-weight: 800; font-size: 1.1rem">{{ board?.closure ? 'Closed' : shiftsText(live.shifts) }}</div>
        <div v-for="(s, i) in live.shifts.filter((x) => x.lunchStart)" :key="i" class="small" style="color: var(--plum); font-weight: 700">Planned lunch {{ time12(s.lunchStart) }} – {{ time12(s.lunchEnd) }}</div>
        <div v-if="live.timeOff" class="small muted" style="margin-top: 4px">
          {{ TIME_OFF_LABEL[live.timeOff.type] }}{{ live.timeOff.allDay ? ' (all day)' : `, ${time12(live.timeOff.startTime)} – ${time12(live.timeOff.endTime)}` }}{{ live.timeOff.status === 'pending' ? ', pending' : '' }}
        </div>
      </div>
      <div v-if="isManager && live.userId !== state.me?.id" class="panel" style="display: grid; gap: 10px">
        <div class="faint">Update for {{ selUser.displayName.split(' ')[0] }}</div>
        <div class="btn-row">
          <button v-if="live.state === 'out'" class="btn" :disabled="busy" @click="act('clock_in', live.userId)">Clock in</button>
          <template v-else>
            <button v-if="live.state !== 'in'" class="btn" :disabled="busy" @click="act('back', live.userId)">End {{ live.state }}</button>
            <button class="btn btn-quiet" :disabled="busy" @click="act('clock_out', live.userId)">Clock out</button>
          </template>
        </div>
        <p class="faint">For when someone forgets. The change is logged under your name.</p>
      </div>
    </Sheet>
  </div>
</template>
