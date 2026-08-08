<script setup lang="ts">
import { computed } from 'vue';
import type { DashboardArtifactMode } from '../lib/artifact-mode';
import { artifactModeMeta } from '../lib/artifact-mode';

const props = defineProps<{
  loading: boolean;
  error?: string;
  hasRun: boolean;
  title?: string;
  subtitle?: string;
  artifactMode: DashboardArtifactMode;
  railOpen: boolean;
  detailsOpen: boolean;
  showDetails: boolean;
}>();

defineEmits<{
  'update:railOpen': [value: boolean];
  'update:detailsOpen': [value: boolean];
}>();

const mode = computed(() => artifactModeMeta(props.artifactMode));

const workspaceStyle = computed(() => {
  const showDetails = props.detailsOpen && props.showDetails;
  return {
    '--rail-width': props.railOpen ? '264px' : '0px',
    '--rail-tablet-width': props.railOpen ? '232px' : '0px',
    '--rail-mobile-height': props.railOpen ? '260px' : '0px',
    '--details-width': showDetails ? '264px' : '0px',
    '--details-tablet-height': showDetails ? '150px' : '0px',
  };
});
</script>

<template>
  <div class="min-h-screen bg-bg">
    <header class="h-11 grid grid-cols-[1fr_auto_1fr] max-[760px]:grid-cols-[1fr_auto] items-center px-3.5 border-b border-line bg-panel">
      <div class="flex items-center gap-3" aria-label="Figloom">
        <strong class="text-[0.9rem] tracking-[-0.015em]">Figloom</strong>
        <UFieldGroup size="xs">
          <UButton
            color="neutral"
            :variant="railOpen ? 'soft' : 'ghost'"
            size="xs"
            :aria-pressed="railOpen"
            @click="$emit('update:railOpen', !railOpen)"
          >
            Contracts
          </UButton>
          <UButton
            color="neutral"
            :variant="detailsOpen ? 'soft' : 'ghost'"
            size="xs"
            :aria-pressed="detailsOpen"
            @click="$emit('update:detailsOpen', !detailsOpen)"
          >
            Details
          </UButton>
        </UFieldGroup>
      </div>
      <div v-if="hasRun" class="flex items-baseline gap-2 max-[760px]:hidden">
        <span class="text-[0.8rem] font-[550]">{{ title }}</span>
        <code class="text-muted text-[0.68rem]">{{ subtitle }}</code>
      </div>
      <div class="justify-self-end flex items-center gap-1.75 text-muted text-xs">
        <span class="w-1.5 h-1.5 rounded-full" :class="mode.dotClass" />
        {{ mode.label }}
      </div>
    </header>

    <main v-if="loading" class="min-h-[calc(100vh-2.75rem)] flex flex-col items-center justify-center">
      <p class="text-muted text-[0.8rem]">Loading verification evidence</p>
      <UProgress class="w-45! mt-2" color="primary" size="xs" animation="carousel" />
    </main>

    <main v-else-if="error" class="min-h-[calc(100vh-2.75rem)] flex flex-col items-center justify-center px-7.5 py-7.5 text-center">
      <p class="m-0 text-muted text-xs">Dashboard unavailable</p>
      <h1 class="max-w-155 my-3 text-[clamp(1.4rem,4vw,2.4rem)] tracking-[-0.04em]">Verification artifact could not be loaded.</h1>
      <code class="max-w-170 p-2.5 text-red bg-danger-surface">{{ error }}</code>
      <p class="text-muted text-[0.8rem]">Open this report through <code>figloom open</code> or serve static report directory over HTTP.</p>
    </main>

    <main
      v-else-if="hasRun"
      class="grid h-[calc(100vh-2.75rem)] grid-cols-[var(--rail-width)_minmax(0,1fr)_var(--details-width)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-bg max-[1100px]:grid-cols-[var(--rail-tablet-width)_minmax(0,1fr)] max-[1100px]:grid-rows-[minmax(0,1fr)_var(--details-tablet-height)] max-[760px]:h-auto max-[760px]:min-h-[calc(100vh-2.75rem)] max-[760px]:grid-cols-[minmax(0,1fr)] max-[760px]:grid-rows-[var(--rail-mobile-height)_minmax(480px,65vh)_auto] max-[760px]:overflow-visible"
      :style="workspaceStyle"
    >
      <aside
        class="col-start-1 row-start-1 min-w-0 min-h-0 border-r border-line bg-panel overflow-hidden max-[1100px]:row-span-2 max-[760px]:row-span-1 max-[760px]:border-r-0 max-[760px]:border-b"
        :aria-hidden="!railOpen"
        :inert="!railOpen"
      >
        <slot name="rail" />
      </aside>

      <section class="col-start-2 row-start-1 min-w-0 min-h-0 max-[760px]:col-start-1 max-[760px]:row-start-2">
        <slot />
      </section>

      <aside
        v-if="showDetails"
        class="col-start-3 row-start-1 min-w-0 min-h-0 border-l border-line bg-panel overflow-hidden max-[1100px]:col-start-2 max-[1100px]:row-start-2 max-[1100px]:border-l-0 max-[1100px]:border-t max-[760px]:col-start-1 max-[760px]:row-start-3 max-[760px]:min-h-45"
        :aria-hidden="!detailsOpen"
        :inert="!detailsOpen"
      >
        <slot name="details" />
      </aside>
    </main>
  </div>
</template>
