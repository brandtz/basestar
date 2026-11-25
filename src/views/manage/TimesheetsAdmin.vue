<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TimesheetRow } from '../../../shared/types';
import { addDays, startOfWeek } from '../../../shared/time';
import { get } from '../../api';
import { attempt, nameOf, state, usersById } from '../../state';
import { clockOf, dayMed, hours, monthDay } from '../../format';
import Icon from '../../components/Icon.vue';

const ws = state.settings?.weekStartsOn ?? 1;
const thisWeek = startOfWeek(state.today, ws);
const presets = [
  { id: 'this', label: 'This week', from: thisWeek, to: addDays(thisWeek, 6) },
  { id: 'last', label: 'Last week', from: addDays(thisWeek, -7), to: addDays(thisWeek, -1) },
  { id: 'two', label: '2 weeks', from: addDays(thisWeek, -14), to: addDays(thisWeek, -1) },
  { id: 'month', label: 'Month', from: state.today.slice(0, 8) + '01', to: state.today },
];
const from = ref(presets[0].from);
const to = ref(presets[0].to);
const rows = ref<TimesheetRow[]>([]);
const open = ref<string | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  await attempt(async () => { rows.value = (await get<{ rows: TimesheetRow[] }>(`/timesheets?from=${from.value}&to=${to.value}`)).rows; });
  loading.value = false;
}
watch([from, to], load, { immediate: true });
const setPreset = (p: (typeof presets)[number]) => { from.value = p.from; to.value = p.to; };
const sorted = computed(() => [...rows.value].sort((a, b) => nameOf(a.userId).localeCompare(nameOf(b.userId))));
const flagged = computed(() => rows.value.reduce((n, r) => n + r.days.filter((d) => d.flags.length).length, 0));

function csv() {
  const head = ['Name', 'Username', 'Date', 'Clock in', 'Clock out', 'On clock (hrs)', 'Lunch (hrs)', 'Breaks (hrs)', 'Worked (hrs)', 'Flags'];
  const lines = [head];
  for (const r of sorted.value) {
    for (const d of r.days) {
      lines.push([nameOf(r.userId), usersById.value.get(r.userId)?.username ?? '', d.date, clockOf(d.firstIn), clockOf(d.lastOut),
        hours(d.onClockMinutes), hours(d.lunchMinutes), hours(d.breakMinutes), hours(d.workedMinutes), [...d.flags, ...(d.open ? ['Still on the clock'] : [])].join('; ')]);
    }
  }
  const text = lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `timesheets_${from.value}_to_${to.value}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
</script>
<template>
  <div class="page" style="padding: 0">
    <div class="panel form">
      <div class="seg" role="group" aria-label="Date range">
        <button v-for="p in presets" :key="p.id" type="button" :aria-pressed="from === p.from && to === p.to" @click="setPreset(p)">{{ p.label }}</button>
      </div>
      <div class="row2">
        <label class="field"><span>From</span><input v-model="from" class="input" type="date" /></label>
        <label class="field"><span>To</span><input v-model="to" class="input" type="date" :min="from" /></label>
      </div>
      <button class="btn btn-quiet" :disabled="!rows.length" @click="csv"><Icon name="download" style="width: 20px; height: 20px" />Download CSV</button>
      <p class="faint">Hours come from clock-ins in this app. Lunch is unpaid and subtracted; rest breaks are paid. Compare against Gusto before running payroll.</p>
    </div>
    <div v-if="flagged" class="banner" style="background: var(--sun-tint); color: var(--sun-ink)">{{ flagged }} day{{ flagged === 1 ? '' : 's' }} need a look (missed clock-outs and the like).</div>
    <div v-if="loading && !rows.length" class="empty">Loading…</div>
    <div v-else class="list">
      <template v-for="r in sorted" :key="r.userId">
        <button class="list-row" :aria-expanded="open === r.userId" @click="open = open === r.userId ? null : r.userId">
          <div class="list-row-main">
            <div class="list-row-title">{{ nameOf(r.userId) }}</div>
            <div class="list-row-sub">{{ r.days.length }} day{{ r.days.length === 1 ? '' : 's' }} from {{ monthDay(from) }} to {{ monthDay(to) }}</div>
          </div>
          <span v-if="r.days.some((d) => d.flags.length)" class="pill pill-wait">Check</span>
          <b style="font-variant-numeric: tabular-nums">{{ hours(r.totalWorkedMinutes) }} h</b>
        </button>
        <div v-if="open === r.userId" style="padding: 0 12px 12px; overflow-x: auto">
          <p v-if="!r.days.length" class="faint">No clock-ins in this range.</p>
          <table v-else class="ts-table">
            <thead><tr><th>Day</th><th>In</th><th>Out</th><th class="num">Lunch</th><th class="num">Worked</th></tr></thead>
            <tbody>
              <tr v-for="d in r.days" :key="d.date">
                <td>{{ dayMed(d.date) }}<div v-for="f in d.flags" :key="f" class="pill pill-wait" style="margin-top: 3px">{{ f }}</div></td>
                <td>{{ clockOf(d.firstIn) }}</td>
                <td>{{ d.open ? 'On the clock' : clockOf(d.lastOut) || '—' }}</td>
                <td class="num">{{ d.lunchMinutes }}m</td>
                <td class="num"><b>{{ hours(d.workedMinutes) }}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>
