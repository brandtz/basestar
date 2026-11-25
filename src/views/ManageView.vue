<script setup lang="ts">
import { computed, ref } from 'vue';
import { isOwner, state } from '../state';
import Icon from '../components/Icon.vue';
import PeopleAdmin from './manage/PeopleAdmin.vue';
import ClosuresAdmin from './manage/ClosuresAdmin.vue';
import TimesheetsAdmin from './manage/TimesheetsAdmin.vue';
import SettingsAdmin from './manage/SettingsAdmin.vue';

type Section = 'people' | 'closures' | 'timesheets' | 'settings';
const section = ref<Section | null>(null);
const notSetUp = computed(() => state.users.filter((u) => u.active && !u.hasPassword).length);
const activeCount = computed(() => state.users.filter((u) => u.active).length);
const items = computed(() => [
  { id: 'people' as const, title: 'People', sub: `${activeCount.value} on the team${notSetUp.value ? `, ${notSetUp.value} without a password yet` : ''}`, icon: 'user' },
  { id: 'closures' as const, title: 'Closures', sub: 'Holidays and days the center is closed', icon: 'closed' },
  { id: 'timesheets' as const, title: 'Timesheets', sub: 'Hours from clock-ins, with CSV download', icon: 'clock' },
  ...(isOwner.value ? [{ id: 'settings' as const, title: 'Settings', sub: 'Approvals, timezone, weekends', icon: 'sliders' }] : []),
]);
const TITLES: Record<Section, string> = { people: 'People', closures: 'Closures', timesheets: 'Timesheets', settings: 'Settings' };
</script>
<template>
  <div class="page">
    <template v-if="!section">
      <div class="list">
        <button v-for="i in items" :key="i.id" class="list-row" @click="section = i.id">
          <Icon :name="i.icon" class="chev" style="color: var(--teal); width: 24px; height: 24px" />
          <div class="list-row-main"><div class="list-row-title">{{ i.title }}</div><div class="list-row-sub">{{ i.sub }}</div></div>
          <Icon name="chev-right" class="chev" />
        </button>
      </div>
      <p class="faint" style="padding: 0 4px">Managers see this tab. Everyone else sees Now, Schedule, and Requests.</p>
    </template>
    <template v-else>
      <div class="datenav">
        <button class="icon-btn" aria-label="Back to Manage" @click="section = null"><Icon name="chev-left" /></button>
        <h2 class="section-title" style="font-size: 1.2rem">{{ TITLES[section] }}</h2>
      </div>
      <PeopleAdmin v-if="section === 'people'" />
      <ClosuresAdmin v-else-if="section === 'closures'" />
      <TimesheetsAdmin v-else-if="section === 'timesheets'" />
      <SettingsAdmin v-else-if="section === 'settings' && isOwner" />
    </template>
  </div>
</template>
