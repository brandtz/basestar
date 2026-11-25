<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Closure, ShiftRequest, TimeOff } from '../../shared/types';
import { addDays } from '../../shared/time';
import { get, post } from '../api';
import { refreshBoard } from '../board';
import { attempt, firstName, isManager, nameOf, state } from '../state';
import { dateSpan, dayMed, shiftsText, time12, TIME_OFF_LABEL } from '../format';
import Avatar from '../components/Avatar.vue';
import Icon from '../components/Icon.vue';
import Sheet from '../components/Sheet.vue';
import ShiftRequestForm from '../components/ShiftRequestForm.vue';
import TimeOffForm from '../components/TimeOffForm.vue';

const requests = ref<ShiftRequest[]>([]);
const timeOff = ref<TimeOff[]>([]);
const closures = ref<Closure[]>([]);
const loading = ref(true);
const sheet = ref<null | 'timeoff' | 'shift'>(null);
const busyId = ref('');

async function load() {
  try {
    const [r, t, c] = await Promise.all([
      get<{ requests: ShiftRequest[] }>('/requests'),
      get<{ timeOff: TimeOff[] }>(`/timeoff?from=${addDays(state.today, -30)}&to=${addDays(state.today, 180)}`),
      get<{ closures: Closure[] }>('/closures'),
    ]);
    requests.value = r.requests;
    timeOff.value = t.timeOff.sort((a, b) => a.startDate.localeCompare(b.startDate));
    closures.value = c.closures.sort((a, b) => a.startDate.localeCompare(b.startDate));
  } catch (e) {
    attempt(() => Promise.reject(e));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const me = computed(() => state.me!.id);
const waitingOnMe = computed(() => requests.value.filter((r) => r.status === 'awaiting_peer' && r.targetId === me.value));
const approvals = computed(() => (isManager.value ? requests.value.filter((r) => r.status === 'awaiting_manager') : []));
const timeOffApprovals = computed(() => (isManager.value ? timeOff.value.filter((t) => t.status === 'pending') : []));
const myRequests = computed(() => requests.value.filter((r) => r.requesterId === me.value || (r.targetId === me.value && r.status !== 'awaiting_peer')));
const myTimeOff = computed(() => timeOff.value.filter((t) => t.userId === me.value && t.endDate >= addDays(state.today, -30)));
const upcomingOff = computed(() => timeOff.value.filter((t) => t.status === 'approved' && t.endDate >= state.today && t.startDate <= addDays(state.today, 60)));
const upcomingClosures = computed(() => closures.value.filter((c) => c.endDate >= state.today));

function title(r: ShiftRequest): string {
  const a = firstName(r.requesterId), b = firstName(r.targetId), d = dayMed(r.date);
  if (r.type === 'swap') return r.targetId === me.value ? `${a} wants to swap on ${d}` : `Swap with ${b} on ${d}`;
  if (r.type === 'cover') return r.targetId === me.value ? `${a} asks you to cover ${d}` : `${b} covers ${a === firstName(me.value) ? 'you' : a} on ${d}`;
  return `${r.requesterId === me.value ? 'Your' : `${a}’s`} hours on ${d}`;
}
function body(r: ShiftRequest): string {
  const a = firstName(r.requesterId), b = firstName(r.targetId);
  const mine = shiftsText(r.requesterShifts), theirs = shiftsText(r.targetShifts ?? []);
  if (r.type === 'swap') {
    if (r.targetId === me.value) return `You’d work ${mine} instead of ${theirs}.`;
    return `${a} works ${theirs}, ${b} works ${mine}.`;
  }
  if (r.type === 'cover') {
    if (r.targetId === me.value) return `You’d take ${mine}${r.targetShifts?.length ? ` on top of your ${theirs}` : ''}.`;
    return `${a}’s ${mine} shift moves to ${b}.`;
  }
  return `From ${mine} to ${shiftsText(r.proposedShifts ?? [])}.`;
}
const REQ_STATUS: Record<ShiftRequest['status'], [string, string]> = {
  awaiting_peer: ['Waiting on coworker', 'pill-wait'], awaiting_manager: ['Waiting on approval', 'pill-wait'],
  approved: ['On the schedule', 'pill-ok'], declined: ['Declined', 'pill-bad'], denied: ['Not approved', 'pill-bad'], cancelled: ['Cancelled', ''],
};
const TO_STATUS: Record<TimeOff['status'], [string, string]> = {
  pending: ['Pending', 'pill-wait'], approved: ['Approved', 'pill-ok'], denied: ['Not approved', 'pill-bad'], cancelled: ['Cancelled', ''],
};
const timeOffWhen = (t: TimeOff) => (t.allDay ? dateSpan(t.startDate, t.endDate) : `${dayMed(t.startDate)}, ${time12(t.startTime)} – ${time12(t.endTime)}`);

async function act(id: string, path: string, payload: unknown, msg: string) {
  busyId.value = id;
  const ok = await attempt(() => post(path, payload), msg);
  busyId.value = '';
  if (ok) { await load(); refreshBoard(); }
}
async function done() { sheet.value = null; await load(); refreshBoard(); }
</script>

<template>
  <div class="page">
    <div class="quick">
      <button class="quick-btn" @click="sheet = 'timeoff'"><Icon name="sun" />Time off<small>Vacation, sick, appointments</small></button>
      <button class="quick-btn" @click="sheet = 'shift'"><Icon name="swap" />Shift change<small>Swap, cover, or adjust hours</small></button>
    </div>

    <div v-if="loading" class="empty">Loading…</div>
    <template v-else>
      <section v-if="waitingOnMe.length">
        <div class="section-head"><h2 class="section-title"><span class="swatch" style="background: var(--sun)" />Waiting on you</h2></div>
        <article v-for="r in waitingOnMe" :key="r.id" class="req">
          <div class="req-head"><div class="req-title">{{ title(r) }}</div><Avatar :user-id="r.requesterId" size="sm" /></div>
          <p class="req-body">{{ body(r) }}</p>
          <p v-if="r.note" class="req-quote">{{ r.note }}</p>
          <p v-if="state.settings?.swapsNeedApproval" class="faint">If you accept, your director still approves it.</p>
          <div class="btn-row">
            <button class="btn btn-quiet btn-small" :disabled="busyId === r.id" @click="act(r.id, `/requests/${r.id}/respond`, { accept: false }, 'Declined')">Decline</button>
            <button class="btn btn-small" :disabled="busyId === r.id" @click="act(r.id, `/requests/${r.id}/respond`, { accept: true }, state.settings?.swapsNeedApproval ? 'Accepted, sent for approval' : 'Accepted, schedule updated')">Accept</button>
          </div>
        </article>
      </section>

      <section v-if="isManager && (approvals.length || timeOffApprovals.length)">
        <div class="section-head"><h2 class="section-title"><span class="swatch" style="background: var(--sun)" />To approve <span class="count">{{ approvals.length + timeOffApprovals.length }}</span></h2></div>
        <article v-for="t in timeOffApprovals" :key="t.id" class="req">
          <div class="req-head">
            <div><div class="req-title">{{ nameOf(t.userId) }}: {{ TIME_OFF_LABEL[t.type].toLowerCase() }}</div><div class="req-body">{{ timeOffWhen(t) }}</div></div>
            <Avatar :user-id="t.userId" size="sm" />
          </div>
          <p v-if="t.note" class="req-quote">{{ t.note }}</p>
          <div class="btn-row">
            <button class="btn btn-quiet btn-small" :disabled="busyId === t.id" @click="act(t.id, `/timeoff/${t.id}/decision`, { approve: false }, 'Time off not approved')">Don’t approve</button>
            <button class="btn btn-small" :disabled="busyId === t.id" @click="act(t.id, `/timeoff/${t.id}/decision`, { approve: true }, 'Time off approved')">Approve</button>
          </div>
        </article>
        <article v-for="r in approvals" :key="r.id" class="req">
          <div class="req-head"><div class="req-title">{{ title(r) }}</div><Avatar :user-id="r.requesterId" size="sm" /></div>
          <p class="req-body">{{ body(r) }}</p>
          <p v-if="r.note" class="req-quote">{{ r.note }}</p>
          <div class="btn-row">
            <button class="btn btn-quiet btn-small" :disabled="busyId === r.id" @click="act(r.id, `/requests/${r.id}/decision`, { approve: false }, 'Not approved')">Don’t approve</button>
            <button class="btn btn-small" :disabled="busyId === r.id" @click="act(r.id, `/requests/${r.id}/decision`, { approve: true }, 'Approved, schedule updated')">Approve</button>
          </div>
        </article>
      </section>

      <section>
        <div class="section-head"><h2 class="section-title">Your requests</h2></div>
        <div v-if="!myRequests.length && !myTimeOff.length" class="empty">Nothing yet. Time off and shift changes you ask for show up here.</div>
        <article v-for="t in myTimeOff" :key="t.id" class="req">
          <div class="req-head">
            <div><div class="req-title">{{ TIME_OFF_LABEL[t.type] }}</div><div class="req-body">{{ timeOffWhen(t) }}</div></div>
            <span class="pill" :class="TO_STATUS[t.status][1]">{{ TO_STATUS[t.status][0] }}</span>
          </div>
          <div v-if="(t.status === 'pending' || t.status === 'approved') && t.endDate >= state.today">
            <button class="btn btn-ghost btn-small" style="padding: 0" :disabled="busyId === t.id" @click="act(t.id, `/timeoff/${t.id}/cancel`, {}, 'Time off cancelled')">Cancel this time off</button>
          </div>
        </article>
        <article v-for="r in myRequests" :key="r.id" class="req">
          <div class="req-head">
            <div class="req-title">{{ title(r) }}</div>
            <span class="pill" :class="REQ_STATUS[r.status][1]">{{ r.status === 'awaiting_peer' ? `Waiting on ${firstName(r.targetId)}` : REQ_STATUS[r.status][0] }}</span>
          </div>
          <p class="req-body">{{ body(r) }}</p>
          <div v-if="(r.status === 'awaiting_peer' || r.status === 'awaiting_manager') && r.requesterId === state.me!.id">
            <button class="btn btn-ghost btn-small" style="padding: 0" :disabled="busyId === r.id" @click="act(r.id, `/requests/${r.id}/cancel`, {}, 'Request cancelled')">Cancel request</button>
          </div>
        </article>
      </section>

      <section>
        <div class="section-head"><h2 class="section-title">Coming up</h2></div>
        <div v-if="!upcomingOff.length && !upcomingClosures.length" class="empty">No time off or closures in the next 60 days.</div>
        <div v-else class="list">
          <div v-for="c in upcomingClosures" :key="c.id" class="list-row" style="cursor: default">
            <span class="avatar avatar-sm cell-closed" style="color: var(--ink-2)"><Icon name="closed" style="width: 16px; height: 16px" /></span>
            <div class="list-row-main"><div class="list-row-title">Closed: {{ c.name }}</div><div class="list-row-sub">{{ dateSpan(c.startDate, c.endDate) }}</div></div>
          </div>
          <div v-for="t in upcomingOff" :key="t.id" class="list-row" style="cursor: default">
            <Avatar :user-id="t.userId" size="sm" />
            <div class="list-row-main"><div class="list-row-title">{{ nameOf(t.userId) }}</div><div class="list-row-sub">{{ TIME_OFF_LABEL[t.type] }}, {{ timeOffWhen(t) }}</div></div>
          </div>
        </div>
      </section>
    </template>

    <Sheet v-if="sheet === 'timeoff'" title="Time off" @close="sheet = null"><TimeOffForm @done="done" /></Sheet>
    <Sheet v-if="sheet === 'shift'" title="Shift change" @close="sheet = null"><ShiftRequestForm @done="done" /></Sheet>
  </div>
</template>
