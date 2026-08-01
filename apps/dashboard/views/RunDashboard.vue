<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DashboardContractResult, DashboardVerdict } from '@figloom/contracts';
import ImageInspector from '../components/ImageInspector.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRunArtifact } from '../data-source';
import { isTypingTarget } from '../lib/dom';

const route = useRoute();
const router = useRouter();
const { run, loading, error, staticMode, liveMode, mockMode, artifactUrl } = useRunArtifact();
const query = ref('');
const status = ref<'all' | DashboardVerdict>('all');
const statusOptions: Array<{ label: string; value: 'all' | DashboardVerdict }> = [
  { label: 'All', value: 'all' },
  { label: 'Passed', value: 'passed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Running', value: 'running' },
  { label: 'Queued', value: 'queued' },
];

const dotColor: Record<DashboardVerdict, string> = {
  queued: 'bg-muted',
  running: 'bg-blue',
  passed: 'bg-green',
  failed: 'bg-red',
  blocked: 'bg-amber',
};

const contracts = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return (run.value?.contracts ?? []).filter((contract) => {
    const statusMatch = status.value === 'all' || contract.status === status.value;
    const queryMatch = !needle || `${contract.id} ${contract.name} ${contract.tags.join(' ')}`.toLowerCase().includes(needle);
    return statusMatch && queryMatch;
  });
});

const selectedId = computed(() => 'id' in route.params && typeof route.params.id === 'string' ? route.params.id : undefined);
const selected = computed(() => run.value?.contracts.find((contract) => contract.id === selectedId.value) ?? contracts.value[0]);

function selectContract(contract: DashboardContractResult) {
  router.push({ name: '/contracts/[...id]', params: { id: contract.id } });
}

function formatRatio(value: number | null | undefined): string {
  if (value == null) return '—';
  const percent = value * 100;
  if (percent > 0 && percent < 0.01) return '<0.01%';
  return `${percent.toFixed(2)}%`;
}

function moveSelection(direction: number) {
  if (!selected.value || contracts.value.length === 0) return;
  const index = contracts.value.findIndex((contract) => contract.id === selected.value?.id);
  const next = contracts.value[(index + direction + contracts.value.length) % contracts.value.length];
  if (next) selectContract(next);
}

function onKeydown(event: KeyboardEvent) {
  if (isTypingTarget(event.target)) return;
  if (!event.altKey) return;
  if (event.key === 'ArrowRight') moveSelection(1);
  if (event.key === 'ArrowLeft') moveSelection(-1);
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="min-h-screen bg-bg">
    <header class="h-11 grid grid-cols-[1fr_auto_1fr] max-[760px]:grid-cols-[1fr_auto] items-center px-3.5 border-b border-line bg-panel">
      <div aria-label="Figloom">
        <strong class="text-[0.9rem] tracking-[-0.015em]">Figloom</strong>
      </div>
      <div v-if="run" class="flex items-baseline gap-2 max-[760px]:hidden">
        <span class="text-[0.8rem] font-[550]">{{ run.suiteName ?? 'Verification run' }}</span>
        <code class="text-muted text-[0.68rem]">{{ run.runId }}</code>
      </div>
      <div class="justify-self-end flex items-center gap-[7px] text-muted text-xs">
        <span class="w-1.5 h-1.5 rounded-full" :class="liveMode ? 'bg-green' : 'bg-blue'" />
        {{ mockMode ? 'Mock data' : staticMode ? 'Report' : liveMode ? 'Live' : 'Archived' }}
      </div>
    </header>

    <main v-if="loading" class="min-h-[calc(100vh-2.75rem)] flex flex-col items-center justify-center">
      <p class="text-muted text-[0.8rem]">Loading verification evidence</p>
      <UProgress class="w-[180px]! mt-2" color="primary" size="xs" animation="carousel" />
    </main>

    <main v-else-if="error" class="min-h-[calc(100vh-2.75rem)] flex flex-col items-center justify-center px-[30px] py-[30px] text-center">
      <p class="m-0 text-muted text-xs">Dashboard unavailable</p>
      <h1 class="max-w-[620px] my-3 text-[clamp(1.4rem,4vw,2.4rem)] tracking-[-0.04em]">Verification artifact could not be loaded.</h1>
      <code class="max-w-[680px] p-2.5 text-red bg-[#211719]">{{ error }}</code>
      <p class="text-muted text-[0.8rem]">Open this report through <code>figloom open</code> or serve static report directory over HTTP.</p>
    </main>

    <main v-else-if="run" class="relative h-[calc(100vh-2.75rem)] overflow-hidden bg-bg">
      <ImageInspector v-if="selected" :contract="selected" :artifact-url="artifactUrl" class="absolute inset-0" />
      <div v-else class="absolute inset-0 flex items-center justify-center text-muted text-[0.85rem]">No contract selected.</div>

      <aside
        class="absolute top-3 bottom-[72px] left-3 z-[4] flex w-[296px] border border-line rounded-[10px] bg-[rgb(23_25_28_/_92%)] backdrop-blur-[14px] backdrop-saturate-[140%] shadow-[0_16px_40px_rgb(0_0_0_/_45%)] overflow-hidden max-[760px]:left-3 max-[760px]:right-3 max-[760px]:w-auto max-[760px]:max-h-[38vh] max-[760px]:top-3 max-[760px]:bottom-auto"
      >
        <div class="min-w-0 w-full min-h-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_auto_minmax(0,1fr)]">
          <header class="flex justify-between items-center px-3.5 pt-3.5 pb-2">
            <div>
              <strong class="block text-[0.88rem]">Contracts</strong>
              <span class="block mt-0.5 text-muted text-[0.72rem]">{{ contracts.length }} of {{ run.summary.total }}</span>
            </div>
            <StatusBadge :status="run.status" />
          </header>
          <div class="flex flex-wrap gap-x-2.5 gap-y-1 px-3.5 pb-[11px] text-muted text-[0.72rem]" aria-label="Contract status totals">
            <span>{{ run.summary.passed }} passed</span>
            <span v-if="run.summary.failed">{{ run.summary.failed }} failed</span>
            <span v-if="run.summary.blocked">{{ run.summary.blocked }} blocked</span>
            <span v-if="run.summary.running">{{ run.summary.running }} running</span>
          </div>
          <div class="grid grid-cols-[minmax(0,1fr)_108px] gap-1.5 px-2.5 pb-2.5">
            <UInput
              v-model="query"
              class="min-w-0"
              type="search"
              color="neutral"
              variant="outline"
              size="sm"
              aria-label="Search contracts"
              placeholder="Search contracts"
            />
            <USelect
              v-model="status"
              class="min-w-0"
              :items="statusOptions"
              color="neutral"
              variant="outline"
              size="sm"
              aria-label="Filter by status"
            />
          </div>
          <div class="min-h-0 overflow-y-auto border-t border-line-soft">
            <UButton
              v-for="contract in contracts"
              :key="contract.id"
              class="w-full grid! grid-cols-[6px_minmax(0,1fr)_auto]! items-center! gap-[9px]! rounded-none! border-0! border-b! border-line-soft! px-3! py-[11px]! text-left!"
              :class="selected?.id === contract.id ? 'bg-[#20242a]! shadow-[inset_2px_0_var(--color-accent)]!' : ''"
              color="neutral"
              variant="ghost"
              :ui="{ label: 'contents' }"
              @click="selectContract(contract)"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="dotColor[contract.status]" />
              <span class="min-w-0">
                <strong class="block overflow-hidden text-ellipsis whitespace-nowrap text-[0.82rem] font-[550]">{{ contract.name }}</strong>
                <code class="block overflow-hidden text-ellipsis whitespace-nowrap mt-[3px] text-muted text-[0.7rem]">{{ contract.id }}</code>
              </span>
              <span class="min-w-[3.6em] text-[#adb2b8] font-medium text-[0.74rem] leading-none text-right font-mono">{{ formatRatio(contract.comparison?.diffRatio) }}</span>
            </UButton>
            <div v-if="contracts.length === 0" class="px-5 py-[30px] text-muted text-center text-[0.8rem]">No contracts match current filter.</div>
          </div>
        </div>
      </aside>

      <aside
        v-if="selected"
        class="absolute top-3 bottom-3 right-3 z-[4] flex w-[264px] border border-line rounded-[10px] bg-[rgb(23_25_28_/_92%)] backdrop-blur-[14px] backdrop-saturate-[140%] shadow-[0_16px_40px_rgb(0_0_0_/_45%)] overflow-hidden max-[980px]:w-[232px] max-[760px]:left-3 max-[760px]:w-auto max-[760px]:max-h-[38vh] max-[760px]:top-auto max-[760px]:bottom-[100px]"
      >
        <div class="min-w-0 w-full min-h-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-x-hidden overflow-y-auto pb-3.5">
          <header class="block px-3.5 pt-3.5 pb-2.5">
            <div class="flex items-center gap-[9px]">
              <h1 class="m-0 text-[0.98rem] font-semibold tracking-[-0.01em]">{{ selected.name }}</h1>
              <StatusBadge :status="selected.status" />
            </div>
            <code class="block mt-1 text-muted text-[0.7rem]">{{ selected.id }}</code>
          </header>
          <dl class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-2.5 gap-y-3 w-full min-w-0 m-0 px-3.5 pb-3.5">
            <div class="min-w-0"><dt class="text-muted text-[0.7rem]">Diff ratio</dt><dd class="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[0.8rem] leading-[1.25] font-mono">{{ formatRatio(selected.comparison?.diffRatio) }}</dd></div>
            <div class="min-w-0"><dt class="text-muted text-[0.7rem]">Pixels</dt><dd class="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[0.8rem] leading-[1.25] font-mono">{{ selected.comparison?.diffPixels?.toLocaleString() ?? '—' }}</dd></div>
            <div class="min-w-0"><dt class="text-muted text-[0.7rem]">Viewport</dt><dd class="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[0.8rem] leading-[1.25] font-mono">{{ selected.capture.viewport.width }}×{{ selected.capture.viewport.height }}</dd></div>
            <div class="min-w-0"><dt class="text-muted text-[0.7rem]">Baseline</dt><dd class="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[0.8rem] leading-[1.25] font-mono">{{ selected.baselineKind }}</dd></div>
          </dl>
          <div v-if="selected.baseline?.provenance || selected.evidenceHash" class="flex flex-col gap-2.5 mx-3.5 mt-1 pt-3 border-t border-line-soft">
            <div v-if="selected.baseline?.provenance" class="min-w-0">
              <span class="block overflow-hidden text-ellipsis whitespace-nowrap text-muted text-[0.68rem]">Baseline provenance</span>
              <code class="block overflow-hidden text-ellipsis whitespace-nowrap mt-[3px] text-[#b7bbc0] text-[0.68rem]">{{ selected.baseline.provenance }}</code>
            </div>
            <div v-if="selected.evidenceHash" class="min-w-0">
              <span class="block overflow-hidden text-ellipsis whitespace-nowrap text-muted text-[0.68rem]">Evidence hash</span>
              <code class="block overflow-hidden text-ellipsis whitespace-nowrap mt-[3px] text-[#b7bbc0] text-[0.68rem]">{{ selected.evidenceHash }}</code>
            </div>
          </div>
        </div>
      </aside>
    </main>
  </div>
</template>
