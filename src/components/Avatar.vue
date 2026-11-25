<script setup lang="ts">
import { computed } from 'vue';
import type { WorkState } from '../../shared/types';
import { usersById } from '../state';
import { initials } from '../format';

const props = defineProps<{ userId?: string; state?: WorkState; size?: 'sm' | 'lg' }>();
const RING: Record<WorkState, string> = { in: 'var(--leaf)', break: 'var(--sun)', lunch: 'var(--plum)', out: 'transparent' };
const user = computed(() => (props.userId ? usersById.value.get(props.userId) : undefined));
</script>
<template>
  <span
    class="avatar"
    :class="size ? `avatar-${size}` : ''"
    :style="{ background: user?.color ?? 'var(--pebble)', '--ring': state ? RING[state] : 'transparent' }"
    aria-hidden="true"
  >{{ initials(user?.displayName ?? '?') }}</span>
</template>
