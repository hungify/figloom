<script setup lang="ts">
import type { DashboardVerdict } from '@figloom/contracts';

defineProps<{ status: DashboardVerdict }>();

const colors: Record<DashboardVerdict, 'neutral' | 'info' | 'success' | 'error' | 'warning'> = {
  queued: 'neutral',
  running: 'info',
  passed: 'success',
  failed: 'error',
  blocked: 'warning',
};
</script>

<template>
  <UBadge class="status-badge" :data-status="status" :color="colors[status]" variant="subtle" size="sm">
    {{ status }}
  </UBadge>
</template>
