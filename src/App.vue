<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, get, post } from './api';
import { applyBootstrap, attempt, isManager, state, type Bootstrap } from './state';
import { boardState, refreshBoard } from './board';
import Icon from './components/Icon.vue';
import Avatar from './components/Avatar.vue';
import Sheet from './components/Sheet.vue';
import Login from './views/Login.vue';
import StatusView from './views/StatusView.vue';
import ScheduleView from './views/ScheduleView.vue';
import RequestsView from './views/RequestsView.vue';
import ManageView from './views/ManageView.vue';

type Tab = 'now' | 'schedule' | 'requests' | 'manage';
const TITLES: Record<Tab, string> = { now: 'Team now', schedule: 'Schedule', requests: 'Requests', manage: 'Manage' };
const fromHash = (): Tab => {
  const h = location.hash.replace('#', '') as Tab;
  return (['now', 'schedule', 'requests', 'manage'] as Tab[]).includes(h) ? h : 'now';
};
const tab = ref<Tab>(fromHash());
const tabs = computed(() => {
  const t: { id: Tab; label: string; icon: string }[] = [
    { id: 'now', label: 'Now', icon: 'team' },
    { id: 'schedule', label: 'Schedule', icon: 'calendar' },
    { id: 'requests', label: 'Requests', icon: 'inbox' },
  ];
  if (isManager.value) t.push({ id: 'manage', label: 'Manage', icon: 'sliders' });
  return t;
});
function go(t: Tab) { tab.value = t; history.replaceState(null, '', `#${t}`); window.scrollTo({ top: 0 }); }
const onHash = () => { tab.value = fromHash(); };

// Polling: fast on the Now tab, slow elsewhere, paused when the app is hidden.
let timer: ReturnType<typeof setInterval> | undefined;
function schedulePoll() {
  clearInterval(timer);
  if (!state.me || document.hidden) return;
  timer = setInterval(refreshBoard, tab.value === 'now' ? 30_000 : 90_000);
}
const onVisible = () => {
  if (!document.hidden && state.me && Date.now() - boardState.fetchedAt > 10_000) refreshBoard();
  schedulePoll();
};

onMounted(async () => {
  window.addEventListener('hashchange', onHash);
  document.addEventListener('visibilitychange', onVisible);
  try { applyBootstrap(await get<Bootstrap>('/me')); } catch { /* not signed in */ }
  state.ready = true;
});
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHash);
  document.removeEventListener('visibilitychange', onVisible);
  clearInterval(timer);
});
watch(() => state.me?.id, (id) => { if (id) { refreshBoard(); } else { boardState.board = null; } schedulePoll(); });
watch(tab, schedulePoll);
watch(isManager, (m) => { if (!m && tab.value === 'manage') go('now'); });

// Account sheet
const accountOpen = ref(false);
const pw = ref({ current: '', next: '', confirm: '' });
const pwError = ref('');
async function changePassword() {
  pwError.value = '';
  if (pw.value.next !== pw.value.confirm) { pwError.value = 'The new passwords don’t match.'; return; }
  const ok = await attempt(() => post('/me/password', { current: pw.value.current, next: pw.value.next }), 'Password changed. Other devices are signed out.');
  if (ok) { pw.value = { current: '', next: '', confirm: '' }; accountOpen.value = false; }
}
async function signOut() {
  await api('POST', '/auth/logout').catch(() => {});
  state.me = null;
  accountOpen.value = false;
  go('now');
}
const ROLE: Record<string, string> = { super: 'Owner', manager: 'Manager', staff: 'Staff' };
</script>

<template>
  <template v-if="state.ready">
    <Login v-if="!state.me" />
    <div v-else class="shell">
      <header class="topbar">
        <div>
          <div class="topbar-org">{{ state.settings?.orgName }}</div>
          <h1 class="topbar-title">{{ TITLES[tab] }}</h1>
        </div>
        <button class="icon-btn" style="width: 44px; height: 44px; padding: 0; border: 0; background: none" aria-label="Your account" @click="accountOpen = true">
          <Avatar :user-id="state.me.id" />
        </button>
      </header>

      <main>
        <StatusView v-if="tab === 'now'" />
        <ScheduleView v-else-if="tab === 'schedule'" />
        <RequestsView v-else-if="tab === 'requests'" />
        <ManageView v-else-if="tab === 'manage' && isManager" />
      </main>

      <nav class="tabbar" aria-label="Sections">
        <div class="tabbar-inner">
          <button v-for="t in tabs" :key="t.id" class="tab" :aria-current="tab === t.id ? 'page' : undefined" @click="go(t.id)">
            <Icon :name="t.icon" />
            {{ t.label }}
            <span v-if="t.id === 'requests' && state.pending" class="tab-badge">{{ state.pending }}</span>
          </button>
        </div>
      </nav>

      <Sheet v-if="accountOpen" title="Your account" @close="accountOpen = false">
        <div class="panel" style="display: flex; gap: 14px; align-items: center">
          <Avatar :user-id="state.me.id" size="lg" />
          <div>
            <div style="font-weight: 800; font-size: 1.15rem">{{ state.me.displayName }}</div>
            <div class="muted small">{{ state.me.username }}</div>
            <div class="faint">{{ ROLE[state.me.role] }}<template v-if="state.me.title">, {{ state.me.title }}</template></div>
          </div>
        </div>
        <form class="panel form" @submit.prevent="changePassword">
          <h3 style="font-weight: 800">Change password</h3>
          <input type="text" name="username" autocomplete="username" :value="state.me.username" hidden />
          <label class="field"><span>Current password</span><input v-model="pw.current" class="input" type="password" autocomplete="current-password" required /></label>
          <label class="field"><span>New password</span><input v-model="pw.next" class="input" type="password" autocomplete="new-password" minlength="8" required /></label>
          <label class="field"><span>New password again</span><input v-model="pw.confirm" class="input" type="password" autocomplete="new-password" minlength="8" required /></label>
          <p v-if="pwError" class="error-text">{{ pwError }}</p>
          <button class="btn" type="submit">Change password</button>
        </form>
        <button class="btn btn-quiet btn-block" @click="signOut"><Icon name="out" style="width: 20px; height: 20px" />Sign out</button>
      </Sheet>
    </div>
  </template>

  <div v-if="state.toast" :key="state.toast.id" class="toast" :class="state.toast.kind" role="status">{{ state.toast.text }}</div>
</template>
