<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ScheduleDay, Shift, ShiftRequestType } from '../../shared/types';
import { get, post } from '../api';
import { activeUsers, attempt, firstName, isManager, state } from '../state';
import { dayMed, shiftsText } from '../format';
import ShiftEditor from './ShiftEditor.vue';

const props = defineProps<{ type?: ShiftRequestType; date?: string; targetId?: string }>();
const emit = defineEmits<{ done: [] }>();

const type = ref<ShiftRequestType>(props.type ?? 'swap');
const date = ref(props.date && props.date >= state.today ? props.date : state.today);
const targetId = ref(props.targetId ?? '');
const proposed = ref<Shift[]>([]);
const note = ref('');
const busy = ref(false);
const day = ref<ScheduleDay | null>(null);

const coworkers = computed(() => activeUsers.value.filter((u) => u.id !== state.me!.id));
const mine = computed(() => day.value?.entries.find((e) => e.userId === state.me!.id)?.shifts ?? []);
const theirs = computed(() => day.value?.entries.find((e) => e.userId === targetId.value)?.shifts ?? []);

async function load() {
  if (!date.value) return;
  const r = await get<{ days: ScheduleDay[] }>(`/schedule?start=${date.value}&days=1`).catch(() => null);
  day.value = r?.days[0] ?? null;
  if (type.value === 'change') proposed.value = mine.value.map((s) => ({ ...s }));
}
watch(date, load, { immediate: true });
watch(type, (t) => { if (t === 'change') proposed.value = mine.value.map((s) => ({ ...s })); });

const needsManager = computed(() =>
  !isManager.value && (type.value === 'change' ? state.settings?.changesNeedApproval : state.settings?.swapsNeedApproval));

const preview = computed(() => {
  const them = firstName(targetId.value);
  if (type.value === 'change') return `Your hours on ${dayMed(date.value)} would be ${shiftsText(proposed.value)} (now ${shiftsText(mine.value)}).`;
  if (!targetId.value) return '';
  if (type.value === 'swap') return `You’d work ${shiftsText(theirs.value)}. ${them} would work ${shiftsText(mine.value)}.`;
  if (!mine.value.length) return 'You aren’t scheduled that day, so there’s nothing to cover.';
  return `${them} would take your ${shiftsText(mine.value)} shift${theirs.value.length ? ` on top of their ${shiftsText(theirs.value)}` : ''}. You’d be off.`;
});

const flowHint = computed(() => {
  if (type.value === 'change') return needsManager.value ? 'Your director approves it, then the schedule updates.' : 'The schedule updates right away.';
  const them = targetId.value ? firstName(targetId.value) : 'Your coworker';
  return needsManager.value ? `${them} accepts, then your director approves it.` : `${them} accepts, then the schedule updates.`;
});

const canSend = computed(() => !!date.value && (type.value === 'change' || (!!targetId.value && (type.value === 'swap' || mine.value.length > 0))));

async function submit() {
  busy.value = true;
  const done = type.value === 'change' && !needsManager.value ? 'Hours changed' : 'Request sent';
  const ok = await attempt(() => post('/requests', {
    type: type.value, date: date.value, targetId: targetId.value || undefined,
    proposedShifts: type.value === 'change' ? proposed.value : undefined, note: note.value,
  }), done);
  busy.value = false;
  if (ok) emit('done');
}
</script>
<template>
  <form class="form" @submit.prevent="submit">
    <div class="seg" role="group" aria-label="Request type">
      <button type="button" :aria-pressed="type === 'swap'" @click="type = 'swap'">Swap</button>
      <button type="button" :aria-pressed="type === 'cover'" @click="type = 'cover'">Cover</button>
      <button type="button" :aria-pressed="type === 'change'" @click="type = 'change'">My hours</button>
    </div>
    <p class="faint">
      <template v-if="type === 'swap'">Trade shifts with a coworker for one day.</template>
      <template v-else-if="type === 'cover'">Ask a coworker to take your shift.</template>
      <template v-else>Come in later, leave earlier, or pick up hours on a day.</template>
    </p>
    <label class="field"><span>Day</span><input v-model="date" class="input" type="date" :min="state.today" required /></label>
    <label v-if="type !== 'change'" class="field">
      <span>Coworker</span>
      <select v-model="targetId" class="input" required>
        <option value="" disabled>Choose someone</option>
        <option v-for="u in coworkers" :key="u.id" :value="u.id">{{ u.displayName }}</option>
      </select>
    </label>
    <div v-else class="field">
      <span>Your hours that day</span>
      <ShiftEditor v-model="proposed" allow-empty />
      <span v-if="!proposed.length" class="hint">No hours means you’d be off that day.</span>
    </div>
    <div v-if="preview" class="callout">{{ preview }}</div>
    <label class="field"><span>Note <span class="hint">optional</span></span><textarea v-model="note" class="input" maxlength="300" placeholder="Anything they should know" /></label>
    <p class="faint">{{ flowHint }}</p>
    <button class="btn btn-block" type="submit" :disabled="busy || !canSend">{{ type === 'change' && !needsManager ? 'Change my hours' : 'Send request' }}</button>
  </form>
</template>
