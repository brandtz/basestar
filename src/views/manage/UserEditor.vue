<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PublicUser, Role, Shift, Weekly } from '../../../shared/types';
import { api, post } from '../../api';
import { attempt, isOwner, state } from '../../state';
import ShiftEditor from '../../components/ShiftEditor.vue';

const props = defineProps<{ user?: PublicUser }>();
const emit = defineEmits<{ saved: [PublicUser]; close: [] }>();

const COLORS = ['#2F7D5B', '#3B6FB6', '#9B4F96', '#C26A2E', '#1E8A8A', '#B23A48', '#6B7A2A', '#5B5BB8', '#8A5A3C', '#C04D86'];
const DAYS: { key: keyof Weekly; label: string }[] = [
  { key: '1', label: 'Monday' }, { key: '2', label: 'Tuesday' }, { key: '3', label: 'Wednesday' }, { key: '4', label: 'Thursday' },
  { key: '5', label: 'Friday' }, { key: '6', label: 'Saturday' }, { key: '0', label: 'Sunday' },
];

const isNew = !props.user;
const u = props.user;
const displayName = ref(u?.displayName ?? '');
const username = ref(u?.username ?? '');
const title = ref(u?.title ?? '');
const email = ref(u?.email ?? '');
const role = ref<Role>(u?.role ?? 'staff');
const color = ref(u?.color ?? COLORS[state.users.length % COLORS.length]);
const gusto = ref(u?.gustoEmployeeUuid ?? '');
const defaultDay = (): Shift[] => [{ start: '08:00', end: '16:30' }];
const weekly = ref<Record<string, Shift[]>>(
  Object.fromEntries(DAYS.map((d) => [d.key, (u ? u.weekly[d.key] ?? [] : ['1', '2', '3', '4', '5'].includes(d.key) ? defaultDay() : []).map((s) => ({ ...s }))])),
);
const busy = ref(false);
const confirmReset = ref(false);
const created = ref<PublicUser | null>(null);

const isSelf = computed(() => u?.id === state.me?.id);
const visibleDays = computed(() => DAYS.filter((d) => state.settings?.showWeekends || (d.key !== '0' && d.key !== '6') || weekly.value[d.key].length));
const suggested = computed(() => displayName.value.trim().toLowerCase().replace(/[^a-z\s'-]/g, '').replace(/['-]/g, '').split(/\s+/).filter(Boolean).join('.'));

function toggleDay(k: string, on: boolean) {
  weekly.value[k] = on ? (weekly.value['1'].length && k !== '1' ? weekly.value['1'].map((s) => ({ ...s })) : defaultDay()) : [];
}
function copyMonday() {
  for (const d of ['2', '3', '4', '5']) weekly.value[d] = weekly.value['1'].map((s) => ({ ...s }));
}

async function save() {
  busy.value = true;
  const payload = {
    displayName: displayName.value, username: username.value || suggested.value, title: title.value, email: email.value,
    color: color.value, weekly: weekly.value, gustoEmployeeUuid: gusto.value,
    ...(isOwner.value && !isSelf.value ? { role: role.value } : {}),
  };
  await attempt(async () => {
    const r = isNew ? await post<{ user: PublicUser }>('/users', payload) : await api<{ user: PublicUser }>('PATCH', `/users/${u!.id}`, payload);
    emit('saved', r.user);
    if (isNew) created.value = r.user;
    else emit('close');
  }, isNew ? undefined : 'Saved');
  busy.value = false;
}

async function resetPassword() {
  if (!confirmReset.value) { confirmReset.value = true; return; }
  await attempt(async () => {
    const r = await post<{ user: PublicUser }>(`/users/${u!.id}/reset-password`);
    emit('saved', r.user);
  }, `Password reset. ${u!.displayName.split(' ')[0]} creates a new one at next sign-in.`);
  confirmReset.value = false;
}

async function setActive(active: boolean) {
  await attempt(async () => {
    const r = await api<{ user: PublicUser }>('PATCH', `/users/${u!.id}`, { active });
    emit('saved', r.user);
    emit('close');
  }, active ? 'Reactivated' : 'Deactivated. They can no longer sign in.');
}

const signInUrl = location.origin;
async function copyInvite() {
  const text = `Sign in to the team app at ${signInUrl} with the username ${created.value!.username}. The first time, you'll create your own password.`;
  await navigator.clipboard?.writeText(text).catch(() => {});
}
</script>

<template>
  <div v-if="created" class="form">
    <div class="callout">
      <b>{{ created.displayName }}</b> is on the team list. Tell them to open <b>{{ signInUrl }}</b> and sign in as <b>{{ created.username }}</b>.
      The first time, they’ll create their own password.
    </div>
    <button class="btn btn-quiet btn-block" @click="copyInvite">Copy sign-in instructions</button>
    <button class="btn btn-block" @click="emit('close')">Done</button>
  </div>

  <form v-else class="form" @submit.prevent="save">
    <label class="field"><span>Name</span><input v-model="displayName" class="input" autocomplete="off" required maxlength="60" /></label>
    <label class="field">
      <span>Username <span class="hint">they sign in with this</span></span>
      <input v-model="username" class="input" :placeholder="suggested || 'firstname.lastname'" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="64" />
    </label>
    <div class="row2">
      <label class="field"><span>Job title</span><input v-model="title" class="input" maxlength="60" placeholder="Lead teacher" /></label>
      <label class="field">
        <span>Role</span>
        <select v-model="role" class="input" :disabled="!isOwner || isSelf">
          <option value="staff">Staff</option>
          <option value="manager">Manager</option>
          <option value="super">Owner</option>
        </select>
      </label>
    </div>
    <p v-if="role !== 'staff'" class="faint">{{ role === 'super' ? 'Owners can do everything, including settings and adding managers.' : 'Managers can add staff, edit schedules, approve requests, and see timesheets.' }}</p>
    <div class="field">
      <span>Color</span>
      <div class="colors">
        <button v-for="c in COLORS" :key="c" type="button" class="color-dot" :style="{ background: c }" :aria-pressed="color === c" :aria-label="`Color ${c}`" @click="color = c" />
      </div>
    </div>

    <div class="field">
      <span>Regular hours <span class="hint">repeats every week; change single days from the schedule</span></span>
      <div class="week-editor">
        <div v-for="d in visibleDays" :key="d.key" class="wd">
          <div class="wd-head">
            <label class="check" style="min-height: 32px"><input type="checkbox" :checked="weekly[d.key].length > 0" @change="toggleDay(d.key, ($event.target as HTMLInputElement).checked)" /><span class="wd-name">{{ d.label }}</span></label>
            <button v-if="d.key === '1' && weekly['1'].length" type="button" class="btn btn-ghost btn-small" @click="copyMonday">Copy to Tue–Fri</button>
          </div>
          <ShiftEditor v-if="weekly[d.key].length" v-model="weekly[d.key]" allow-empty />
        </div>
      </div>
    </div>

    <label class="field"><span>Email <span class="hint">optional</span></span><input v-model="email" class="input" type="email" maxlength="120" /></label>
    <label class="field"><span>Gusto employee ID <span class="hint">optional, for a future Gusto connection</span></span><input v-model="gusto" class="input" maxlength="64" autocapitalize="none" /></label>

    <button class="btn btn-block" type="submit" :disabled="busy || !displayName.trim()">{{ isNew ? 'Add to team' : 'Save changes' }}</button>

    <div v-if="!isNew && !isSelf" class="panel" style="display: grid; gap: 10px">
      <div class="faint">{{ u!.hasPassword ? `Signed in before${u!.lastLoginAt ? `, last on ${new Date(u!.lastLoginAt).toLocaleDateString()}` : ''}.` : 'Hasn’t created a password yet.' }}</div>
      <button v-if="u!.hasPassword" type="button" class="btn btn-quiet" @click="resetPassword">{{ confirmReset ? 'Tap again to reset password' : 'Reset password' }}</button>
      <button v-if="u!.active" type="button" class="btn btn-danger" @click="setActive(false)">Deactivate</button>
      <button v-else type="button" class="btn btn-quiet" @click="setActive(true)">Reactivate</button>
    </div>
  </form>
</template>
