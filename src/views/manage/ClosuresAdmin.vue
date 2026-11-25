<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Closure } from '../../../shared/types';
import { api, get, post } from '../../api';
import { attempt, state } from '../../state';
import { dateSpan } from '../../format';

const closures = ref<Closure[]>([]);
const name = ref('');
const startDate = ref(state.today);
const endDate = ref(state.today);
const confirmId = ref('');

const load = async () => { closures.value = (await get<{ closures: Closure[] }>('/closures')).closures.sort((a, b) => a.startDate.localeCompare(b.startDate)); };
onMounted(load);
const upcoming = computed(() => closures.value.filter((c) => c.endDate >= state.today));
const past = computed(() => closures.value.filter((c) => c.endDate < state.today).reverse().slice(0, 10));

async function add() {
  const ok = await attempt(() => post('/closures', { name: name.value, startDate: startDate.value, endDate: endDate.value }), 'Closure added');
  if (ok) { name.value = ''; await load(); }
}
async function remove(id: string) {
  if (confirmId.value !== id) { confirmId.value = id; return; }
  if (await attempt(() => api('DELETE', `/closures/${id}`), 'Closure removed')) await load();
  confirmId.value = '';
}
</script>
<template>
  <div class="page" style="padding: 0">
    <form class="panel form" @submit.prevent="add">
      <label class="field"><span>What’s it for</span><input v-model="name" class="input" placeholder="Thanksgiving, staff training day…" required maxlength="80" /></label>
      <div class="row2">
        <label class="field"><span>First day</span><input v-model="startDate" class="input" type="date" required @change="endDate < startDate && (endDate = startDate)" /></label>
        <label class="field"><span>Last day</span><input v-model="endDate" class="input" type="date" :min="startDate" required /></label>
      </div>
      <button class="btn" type="submit">Add closure</button>
      <p class="faint">Everyone sees closed days on the schedule, and no one is expected in.</p>
    </form>
    <section>
      <h3 class="section-title" style="margin-bottom: 10px">Upcoming</h3>
      <div v-if="!upcoming.length" class="empty">No closures planned.</div>
      <div v-else class="list">
        <div v-for="c in upcoming" :key="c.id" class="list-row" style="cursor: default">
          <div class="list-row-main"><div class="list-row-title">{{ c.name }}</div><div class="list-row-sub">{{ dateSpan(c.startDate, c.endDate) }}</div></div>
          <button class="btn btn-small" :class="confirmId === c.id ? 'btn-danger' : 'btn-quiet'" @click="remove(c.id)">{{ confirmId === c.id ? 'Tap to remove' : 'Remove' }}</button>
        </div>
      </div>
    </section>
    <section v-if="past.length">
      <h3 class="section-title" style="margin-bottom: 10px">Past</h3>
      <div class="list">
        <div v-for="c in past" :key="c.id" class="list-row out-row" style="cursor: default">
          <div class="list-row-main"><div class="list-row-title">{{ c.name }}</div><div class="list-row-sub">{{ dateSpan(c.startDate, c.endDate) }}</div></div>
        </div>
      </div>
    </section>
  </div>
</template>
