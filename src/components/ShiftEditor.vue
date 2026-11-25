<script setup lang="ts">
// Edits the shifts for one day (usually one; up to three for split days), with optional planned lunch.
import type { Shift } from '../../shared/types';
import Icon from './Icon.vue';

const model = defineModel<Shift[]>({ required: true });
defineProps<{ allowEmpty?: boolean }>();

function patch(i: number, p: Partial<Shift>) {
  model.value = model.value.map((s, j) => (j === i ? { ...s, ...p } : s));
}
function toggleLunch(i: number) {
  const s = model.value[i];
  if (s.lunchStart) {
    const { lunchStart: _a, lunchEnd: _b, ...rest } = s;
    model.value = model.value.map((x, j) => (j === i ? rest : x));
  } else patch(i, { lunchStart: '12:00', lunchEnd: '12:30' });
}
const add = () => {
  const last = model.value[model.value.length - 1];
  model.value = [...model.value, last ? { start: last.end, end: last.end < '17:00' ? '17:00' : '18:00' } : { start: '08:00', end: '16:30' }];
};
const remove = (i: number) => { model.value = model.value.filter((_, j) => j !== i); };
</script>
<template>
  <div class="shift-ed">
    <div v-for="(s, i) in model" :key="i" class="shift-ed" style="gap: 6px">
      <div class="shift-ed-row">
        <input class="input" type="time" :value="s.start" aria-label="Start" @change="patch(i, { start: ($event.target as HTMLInputElement).value })" />
        <span class="to">to</span>
        <input class="input" type="time" :value="s.end" aria-label="End" @change="patch(i, { end: ($event.target as HTMLInputElement).value })" />
        <button class="icon-btn" type="button" :aria-label="`Remove shift ${i + 1}`" :disabled="!allowEmpty && model.length === 1" @click="remove(i)"><Icon name="close" /></button>
      </div>
      <div v-if="s.lunchStart" class="lunch-row">
        <span>Lunch</span>
        <input class="input" type="time" :value="s.lunchStart" aria-label="Lunch start" @change="patch(i, { lunchStart: ($event.target as HTMLInputElement).value })" />
        <span>to</span>
        <input class="input" type="time" :value="s.lunchEnd" aria-label="Lunch end" @change="patch(i, { lunchEnd: ($event.target as HTMLInputElement).value })" />
      </div>
      <div class="btn-row" style="gap: 4px">
        <button class="btn btn-ghost btn-small" type="button" @click="toggleLunch(i)">{{ s.lunchStart ? 'Remove lunch' : 'Add planned lunch' }}</button>
      </div>
    </div>
    <button v-if="model.length < 3" class="btn btn-quiet btn-small" type="button" @click="add">
      <Icon name="plus" style="width: 18px; height: 18px" />{{ model.length ? 'Add another shift' : 'Add hours' }}
    </button>
  </div>
</template>
