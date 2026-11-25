import { computed, reactive } from 'vue';
import type { PublicUser, Settings } from '../shared/types';

export interface Bootstrap { user: PublicUser; settings: Settings; users: PublicUser[]; today: string }

export const state = reactive({
  ready: false,
  me: null as PublicUser | null,
  settings: null as Settings | null,
  users: [] as PublicUser[],
  today: '',
  pending: 0,
  toast: null as null | { text: string; kind: 'ok' | 'error'; id: number },
});

export function applyBootstrap(b: Bootstrap) {
  state.me = b.user;
  state.settings = b.settings;
  state.users = b.users;
  state.today = b.today;
}

export const usersById = computed(() => new Map(state.users.map((u) => [u.id, u])));
export const activeUsers = computed(() =>
  state.users.filter((u) => u.active).sort((a, b) => a.displayName.localeCompare(b.displayName)));
export const isManager = computed(() => state.me?.role === 'super' || state.me?.role === 'manager');
export const isOwner = computed(() => state.me?.role === 'super');
export const tz = () => state.settings?.timezone ?? 'America/Los_Angeles';

export const nameOf = (id?: string) => (id && usersById.value.get(id)?.displayName) || 'Someone';
export const firstName = (id?: string) => nameOf(id).split(' ')[0];

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: 'ok' | 'error' = 'ok') {
  state.toast = { text, kind, id: Date.now() };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (state.toast = null), kind === 'error' ? 5000 : 2600);
}

/** Runs an async action, toasting the error message on failure. Returns true on success. */
export async function attempt(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await fn();
    if (success) toast(success);
    return true;
  } catch (e) {
    toast((e as Error).message, 'error');
    return false;
  }
}
