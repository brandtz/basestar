<script setup lang="ts">
// Username first. Known user with a password -> password field. Known user without one -> create password.
import { nextTick, ref } from 'vue';
import { post } from '../api';
import { applyBootstrap, type Bootstrap } from '../state';

type Step = 'username' | 'password' | 'setup';
const step = ref<Step>('username');
const username = ref('');
const firstName = ref('');
const password = ref('');
const confirm = ref('');
const error = ref('');
const busy = ref(false);
const pwInput = ref<HTMLInputElement>();

async function focusPw() { await nextTick(); pwInput.value?.focus(); }

async function run(fn: () => Promise<void>) {
  error.value = '';
  busy.value = true;
  try { await fn(); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}

const lookup = () => run(async () => {
  const r = await post<{ next: string; firstName?: string }>('/auth/lookup', { username: username.value });
  if (r.next === 'unknown') {
    error.value = `“${username.value.trim()}” isn’t on the team list. Check the spelling, or ask your director to add you.`;
    return;
  }
  firstName.value = r.firstName ?? '';
  step.value = r.next as Step;
  password.value = confirm.value = '';
  focusPw();
});

const signIn = () => run(async () => {
  const r = await post<Bootstrap & { next?: string }>('/auth/login', { username: username.value, password: password.value });
  if (r.next === 'setup') { step.value = 'setup'; password.value = ''; focusPw(); return; }
  applyBootstrap(r);
});

const create = () => run(async () => {
  if (password.value.length < 8) { error.value = 'Use at least 8 characters for your password.'; return; }
  if (password.value !== confirm.value) { error.value = 'The two passwords don’t match.'; return; }
  applyBootstrap(await post<Bootstrap>('/auth/setup', { username: username.value, password: password.value }));
});

function restart() { step.value = 'username'; error.value = ''; password.value = confirm.value = ''; }
</script>

<template>
  <main class="login">
    <div class="login-mark">
      <img src="/icon.svg" alt="" />
      <div>
        <div class="login-org">Guided Growth Early Learning</div>
        <div style="font-weight: 800">Basestar</div>
      </div>
    </div>

    <form v-if="step === 'username'" class="form" @submit.prevent="lookup">
      <div>
        <h1 class="login-title">Sign in</h1>
        <p class="login-lede">Use the username your director set up for you, usually firstname.lastname.</p>
      </div>
      <label class="field">
        <span>Username</span>
        <input v-model="username" class="input" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="email" required autofocus />
      </label>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <button class="btn btn-block" type="submit" :disabled="busy || !username.trim()">Continue</button>
    </form>

    <form v-else-if="step === 'password'" class="form" @submit.prevent="signIn">
      <h1 class="login-title">Welcome back{{ firstName ? `, ${firstName}` : '' }}</h1>
      <div class="login-who"><span>{{ username.trim().toLowerCase() }}</span><button class="btn btn-ghost btn-small" type="button" @click="restart">Not you?</button></div>
      <input type="text" name="username" autocomplete="username" :value="username" hidden />
      <label class="field">
        <span>Password</span>
        <input ref="pwInput" v-model="password" class="input" type="password" name="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <button class="btn btn-block" type="submit" :disabled="busy || !password">Sign in</button>
      <p class="faint">Forgot it? Ask your director to reset your password, then sign in again to make a new one.</p>
    </form>

    <form v-else class="form" @submit.prevent="create">
      <div>
        <h1 class="login-title">Welcome{{ firstName ? `, ${firstName}` : '' }}. Create your password.</h1>
        <p class="login-lede">This is your first sign-in. You’ll use this password from now on, on any device.</p>
      </div>
      <div class="login-who"><span>{{ username.trim().toLowerCase() }}</span><button class="btn btn-ghost btn-small" type="button" @click="restart">Not you?</button></div>
      <input type="text" name="username" autocomplete="username" :value="username" hidden />
      <label class="field">
        <span>New password <span class="hint">at least 8 characters</span></span>
        <input ref="pwInput" v-model="password" class="input" type="password" name="new-password" autocomplete="new-password" minlength="8" required />
      </label>
      <label class="field">
        <span>Type it again</span>
        <input v-model="confirm" class="input" type="password" name="confirm-password" autocomplete="new-password" minlength="8" required />
      </label>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <button class="btn btn-block" type="submit" :disabled="busy">Create password and sign in</button>
    </form>
  </main>
</template>
