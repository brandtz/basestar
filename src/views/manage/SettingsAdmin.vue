<script setup lang="ts">
import { ref } from 'vue';
import type { Settings } from '../../../shared/types';
import { api } from '../../api';
import { attempt, state } from '../../state';

const s = ref<Settings>({ ...state.settings! });
const ZONES = ['America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Anchorage', 'Pacific/Honolulu'];
const busy = ref(false);
async function save() {
  busy.value = true;
  await attempt(async () => { state.settings = (await api<{ settings: Settings }>('PUT', '/settings', s.value)).settings; }, 'Settings saved');
  busy.value = false;
}
</script>
<template>
  <form class="page form" style="padding: 0" @submit.prevent="save">
    <div class="panel form">
      <label class="field"><span>Center name</span><input v-model="s.orgName" class="input" required maxlength="80" /></label>
      <label class="field">
        <span>Timezone</span>
        <select v-model="s.timezone" class="input"><option v-for="z in ZONES" :key="z" :value="z">{{ z.replace('_', ' ') }}</option></select>
      </label>
      <label class="field">
        <span>Weeks start on</span>
        <select v-model.number="s.weekStartsOn" class="input"><option :value="1">Monday</option><option :value="0">Sunday</option></select>
      </label>
      <label class="check"><input v-model="s.showWeekends" type="checkbox" />Show Saturday and Sunday on schedules</label>
    </div>
    <div class="panel form">
      <h3 class="section-title">Approvals</h3>
      <label class="check"><input v-model="s.timeOffNeedsApproval" type="checkbox" />Time off needs manager approval</label>
      <label class="check"><input v-model="s.swapsNeedApproval" type="checkbox" />Swaps and covers need manager approval</label>
      <p class="faint" style="margin-top: -8px">When off, a swap or cover goes on the schedule as soon as the coworker accepts.</p>
      <label class="check"><input v-model="s.changesNeedApproval" type="checkbox" />Changing your own hours needs manager approval</label>
    </div>
    <div class="panel form">
      <label class="field">
        <span>Reminder under the clock-in button <span class="hint">leave blank to hide</span></span>
        <input v-model="s.clockReminder" class="input" maxlength="200" />
      </label>
    </div>
    <button class="btn btn-block" type="submit" :disabled="busy">Save settings</button>
  </form>
</template>
