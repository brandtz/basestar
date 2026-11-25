<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PublicUser } from '../../../shared/types';
import { state } from '../../state';
import Avatar from '../../components/Avatar.vue';
import Icon from '../../components/Icon.vue';
import Sheet from '../../components/Sheet.vue';
import UserEditor from './UserEditor.vue';

const editing = ref<PublicUser | 'new' | null>(null);
const ROLE: Record<string, string> = { super: 'Owner', manager: 'Manager', staff: '' };
const sorted = (list: PublicUser[]) => [...list].sort((a, b) => a.displayName.localeCompare(b.displayName));
const active = computed(() => sorted(state.users.filter((u) => u.active)));
const inactive = computed(() => sorted(state.users.filter((u) => !u.active)));

function saved(u: PublicUser) {
  const i = state.users.findIndex((x) => x.id === u.id);
  if (i >= 0) state.users[i] = u; else state.users.push(u);
  if (u.id === state.me?.id) state.me = { ...state.me, ...u };
}
</script>
<template>
  <div class="page" style="padding: 0">
    <button class="btn btn-block" @click="editing = 'new'"><Icon name="plus" style="width: 20px; height: 20px" />Add a person</button>
    <div class="list">
      <button v-for="u in active" :key="u.id" class="list-row" @click="editing = u">
        <Avatar :user-id="u.id" size="sm" />
        <div class="list-row-main">
          <div class="list-row-title">{{ u.displayName }}</div>
          <div class="list-row-sub">{{ u.username }}<template v-if="u.title">, {{ u.title }}</template></div>
        </div>
        <span v-if="!u.hasPassword" class="pill pill-wait">No password yet</span>
        <span v-else-if="ROLE[u.role]" class="pill pill-teal">{{ ROLE[u.role] }}</span>
        <Icon name="chev-right" class="chev" />
      </button>
    </div>
    <template v-if="inactive.length">
      <h3 class="section-title">Deactivated</h3>
      <div class="list">
        <button v-for="u in inactive" :key="u.id" class="list-row out-row" @click="editing = u">
          <Avatar :user-id="u.id" size="sm" />
          <div class="list-row-main"><div class="list-row-title">{{ u.displayName }}</div><div class="list-row-sub">{{ u.username }}</div></div>
          <Icon name="chev-right" class="chev" />
        </button>
      </div>
    </template>
    <Sheet v-if="editing" :title="editing === 'new' ? 'Add a person' : editing.displayName" @close="editing = null">
      <UserEditor :user="editing === 'new' ? undefined : editing" @saved="saved" @close="editing = null" />
    </Sheet>
  </div>
</template>
