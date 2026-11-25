<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TimeOffType } from '../../shared/types';
import { post } from '../api';
import { activeUsers, attempt, isManager, state } from '../state';
import { TIME_OFF_LABEL } from '../format';

const props = defineProps<{ date?: string; userId?: string }>();
const emit = defineEmits<{ done: [] }>();

const userId = ref(props.userId ?? state.me!.id);
const startDate = ref(props.date ?? state.today);
const endDate = ref(props.date ?? state.today);
const allDay = ref(true);
const startTime = ref('12:00');
const endTime = ref('17:00');
const type = ref<TimeOffType>('vacation');
const note = ref('');
const busy = ref(false);

const autoApproved = computed(() => isManager.value || !state.settings?.timeOffNeedsApproval);
const onStart = () => { if (endDate.value < startDate.value || !allDay.value) endDate.value = startDate.value; };

async function submit() {
  busy.value = true;
  const ok = await attempt(() => post('/timeoff', {
    userId: userId.value, startDate: startDate.value, endDate: allDay.value ? endDate.value : startDate.value,
    allDay: allDay.value, startTime: startTime.value, endTime: endTime.value, type: type.value, note: note.value,
  }), autoApproved.value ? 'Time off added' : 'Time off requested');
  busy.value = false;
  if (ok) emit('done');
}
</script>
<template>
  <form class="form" @submit.prevent="submit">
    <label v-if="isManager" class="field">
      <span>Who</span>
      <select v-model="userId" class="input">
        <option v-for="u in activeUsers" :key="u.id" :value="u.id">{{ u.id === state.me!.id ? `${u.displayName} (you)` : u.displayName }}</option>
      </select>
    </label>
    <label class="check"><input v-model="allDay" type="checkbox" @change="onStart" />All day</label>
    <div v-if="allDay" class="row2">
      <label class="field"><span>First day</span><input v-model="startDate" class="input" type="date" required @change="onStart" /></label>
      <label class="field"><span>Last day</span><input v-model="endDate" class="input" type="date" :min="startDate" required /></label>
    </div>
    <template v-else>
      <label class="field"><span>Day</span><input v-model="startDate" class="input" type="date" required /></label>
      <div class="row2">
        <label class="field"><span>Out from</span><input v-model="startTime" class="input" type="time" required /></label>
        <label class="field"><span>Back at</span><input v-model="endTime" class="input" type="time" required /></label>
      </div>
    </template>
    <label class="field">
      <span>Type</span>
      <select v-model="type" class="input">
        <option v-for="(label, key) in TIME_OFF_LABEL" :key="key" :value="key">{{ label }}</option>
      </select>
    </label>
    <label class="field"><span>Note <span class="hint">optional, visible to managers and on the schedule</span></span><textarea v-model="note" class="input" maxlength="500" /></label>
    <p class="faint">{{ autoApproved ? 'This goes straight on the schedule.' : 'Your director approves it, then it shows on the team schedule.' }}</p>
    <button class="btn btn-block" type="submit" :disabled="busy">{{ autoApproved ? 'Add time off' : 'Request time off' }}</button>
  </form>
</template>
