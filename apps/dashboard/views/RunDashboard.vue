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
const railOpen = ref(true);
const detailsOpen = ref(true);
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

const viewportTags = new Set(['desktop', 'mobile', 'tablet']);
const verdictPriority: DashboardVerdict[] = ['failed', 'blocked', 'running', 'queued', 'passed'];

interface ContractTreeItem {
  id: string;
  label: string;
  kind: 'feature' | 'contract';
  status: DashboardVerdict;
  contract?: DashboardContractResult;
  children?: ContractTreeItem[];
  leafCount?: number;
  defaultExpanded?: boolean;
  onSelect?: () => void;
  class?: string;
}

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
const contractTree = computed<ContractTreeItem[]>(() => {
  const suiteKey = run.value?.suiteName?.toLowerCase() ?? '';
  const suiteLabel = (run.value?.suiteName ?? 'Verification run')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
  const aggregateStatus = verdictPriority.find((verdict) => contracts.value.some((contract) => contract.status === verdict)) ?? 'passed';
  const children = contracts.value.map((contract): ContractTreeItem => {
    const prefix = contract.id.split('.')[0]?.toLowerCase();
    const suffix = prefix && prefix === suiteKey ? contract.id.split('.').slice(1).join('.') : contract.id;
    const childLabel = suffix
      ? suffix.split('.').map((part) => part.replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase())).join(' · ')
      : contract.tags.find((tag) => viewportTags.has(tag.toLowerCase()))?.replace(/\b\w/g, (character) => character.toUpperCase()) ?? contract.name;
    return {
      id: `contract:${contract.id}`,
      label: childLabel,
      kind: 'contract',
      status: contract.status,
      contract,
      leafCount: 1,
      onSelect: () => selectContract(contract),
      class: contract.id === selected.value?.id ? 'bg-[#173a63]! text-[#e7f1ff]!' : '',
    };
  });

  return [{
    id: `suite:${suiteKey || 'verification-run'}`,
    label: suiteLabel,
    kind: 'feature',
    status: aggregateStatus,
    children,
    leafCount: children.length,
    defaultExpanded: true,
  }];
});
const selectedTreeItem = computed(() => contractTree.value
  .flatMap((group) => group.children ?? [])
  .find((item) => item.contract?.id === selected.value?.id));
const workspaceStyle = computed<Record<string, string>>(() => ({
  '--rail-width': railOpen.value ? '264px' : '0px',
  '--rail-tablet-width': railOpen.value ? '232px' : '0px',
  '--rail-mobile-height': railOpen.value ? '260px' : '0px',
  '--details-width': detailsOpen.value ? '264px' : '0px',
  '--details-tablet-height': detailsOpen.value ? '150px' : '0px',
}));

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
      <div class="flex items-center gap-3" aria-label="Figloom">
        <strong class="text-[0.9rem] tracking-[-0.015em]">Figloom</strong>
        <UFieldGroup size="xs">
          <UButton
            color="neutral"
            :variant="railOpen ? 'soft' : 'ghost'"
            size="xs"
            :aria-pressed="railOpen"
            @click="railOpen = !railOpen"
          >
            Contracts
          </UButton>
          <UButton
            color="neutral"
            :variant="detailsOpen ? 'soft' : 'ghost'"
            size="xs"
            :aria-pressed="detailsOpen"
            @click="detailsOpen = !detailsOpen"
          >
            Details
          </UButton>
        </UFieldGroup>
      </div>
      <div v-if="run" class="flex items-baseline gap-2 max-[760px]:hidden">
        <span class="text-[0.8rem] font-[550]">{{ selected?.name ?? run.suiteName ?? 'Verification run' }}</span>
        <code class="text-muted text-[0.68rem]">{{ selected?.id ?? run.runId }}</code>
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

    <main
      v-else-if="run"
      class="grid h-[calc(100vh-2.75rem)] grid-cols-[var(--rail-width)_minmax(0,1fr)_var(--details-width)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-bg max-[1100px]:grid-cols-[var(--rail-tablet-width)_minmax(0,1fr)] max-[1100px]:grid-rows-[minmax(0,1fr)_var(--details-tablet-height)] max-[760px]:h-auto max-[760px]:min-h-[calc(100vh-2.75rem)] max-[760px]:grid-cols-[minmax(0,1fr)] max-[760px]:grid-rows-[var(--rail-mobile-height)_minmax(480px,65vh)_auto] max-[760px]:overflow-visible"
      :style="workspaceStyle"
    >
      <section class="col-start-2 row-start-1 min-w-0 min-h-0 max-[760px]:col-start-1 max-[760px]:row-start-2">
        <ImageInspector v-if="selected" :contract="selected" :artifact-url="artifactUrl" />
        <div v-else class="h-full flex items-center justify-center text-muted text-[0.85rem]">No contract selected.</div>
      </section>

      <aside
        class="col-start-1 row-start-1 min-w-0 min-h-0 border-r border-line bg-panel overflow-hidden max-[1100px]:row-span-2 max-[760px]:row-span-1 max-[760px]:border-r-0 max-[760px]:border-b"
        :class="railOpen ? '' : 'hidden'"
      >
        <div class="min-w-0 w-full min-h-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto]">
          <header class="flex justify-between items-center gap-2 px-3 pt-3 pb-2.5">
            <div class="min-w-0">
              <strong class="block overflow-hidden text-ellipsis whitespace-nowrap text-[0.84rem]">{{ run.suiteName ?? 'Verification run' }}</strong>
              <span class="block mt-0.5 text-muted text-[0.68rem]">{{ contracts.length }} of {{ run.summary.total }} stories</span>
            </div>
            <StatusBadge :status="run.status" />
          </header>
          <div class="grid grid-cols-[minmax(0,1fr)_94px] gap-1.5 px-2 pb-2">
            <UInput
              v-model="query"
              class="min-w-0"
              type="search"
              color="neutral"
              variant="outline"
              size="sm"
              aria-label="Search stories"
              placeholder="Find stories"
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
          <div class="min-h-0 overflow-y-auto border-t border-line-soft px-1.5 py-2">
            <UTree
              :items="contractTree"
              :model-value="selectedTreeItem"
              :get-key="(item: ContractTreeItem) => item.id"
              size="sm"
              color="neutral"
              :ui="{
                root: 'gap-px',
                item: 'p-0',
                itemWithChildren: 'ms-0 ps-0 border-s-0',
                link: 'min-h-7 gap-1.5 rounded-sm px-1.5 py-1 hover:bg-[#22262b]',
                linkLabel: 'min-w-0',
                linkTrailing: 'ms-auto',
                listWithChildren: 'ms-3 ps-1 border-s border-[#2c3035]',
              }"
            >
              <template #item-leading="{ item, expanded }">
                <span
                  v-if="item.kind === 'feature'"
                  class="w-3 text-center text-accent text-[0.66rem]"
                  aria-hidden="true"
                >{{ expanded ? '▾' : '▸' }}</span>
                <span v-else class="w-1.5 h-1.5 mx-[3px] rounded-full" :class="dotColor[item.status]" />
              </template>
              <template #item-label="{ item }">
                <span class="min-w-0 flex-1 overflow-hidden">
                  <strong
                    class="block overflow-hidden text-ellipsis whitespace-nowrap"
                    :class="item.kind === 'feature' ? 'text-[0.69rem] uppercase tracking-[0.065em] text-accent font-bold' : 'text-[0.78rem] font-[520]'"
                  >{{ item.label }}</strong>
                </span>
              </template>
              <template #item-trailing="{ item }">
                <span v-if="item.kind === 'feature'" class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full" :class="dotColor[item.status]" />
                  <span class="min-w-[1ch] text-muted text-[0.66rem] tabular-nums">{{ item.leafCount ?? 0 }}</span>
                </span>
                <span v-else class="min-w-[3.6em] text-[#adb2b8] font-medium text-[0.7rem] leading-none text-right font-mono">{{ formatRatio(item.contract?.comparison?.diffRatio) }}</span>
              </template>
            </UTree>
            <div v-if="contracts.length === 0" class="px-5 py-[30px] text-muted text-center text-[0.8rem]">No contracts match current filter.</div>
          </div>
          <footer class="border-t border-line px-2.5 py-2.5 bg-[#15171a]" aria-label="Verification summary">
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="text-[0.72rem] font-semibold">Visual tests</span>
              <span class="text-muted text-[0.66rem] tabular-nums">{{ run.summary.passed }}/{{ run.summary.total }} passed</span>
            </div>
            <UProgress
              :model-value="run.summary.total ? (run.summary.passed / run.summary.total) * 100 : 0"
              color="success"
              size="xs"
            />
            <div class="flex items-center gap-2 mt-2 text-[0.66rem] text-muted">
              <span v-if="run.summary.failed" class="text-red">{{ run.summary.failed }} failed</span>
              <span v-if="run.summary.blocked" class="text-amber">{{ run.summary.blocked }} blocked</span>
              <span v-if="run.summary.running" class="text-blue">{{ run.summary.running }} running</span>
            </div>
          </footer>
        </div>
      </aside>

      <aside
        v-if="selected"
        class="col-start-3 row-start-1 min-w-0 min-h-0 border-l border-line bg-panel overflow-hidden max-[1100px]:col-start-2 max-[1100px]:row-start-2 max-[1100px]:border-l-0 max-[1100px]:border-t max-[760px]:col-start-1 max-[760px]:row-start-3 max-[760px]:min-h-[180px]"
        :class="detailsOpen ? '' : 'hidden'"
      >
        <div class="min-w-0 w-full min-h-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-x-hidden overflow-y-auto pb-3.5 max-[1100px]:grid-cols-[minmax(220px,0.8fr)_minmax(340px,1.2fr)_minmax(260px,1fr)] max-[1100px]:grid-rows-[minmax(0,1fr)] max-[1100px]:items-start max-[1100px]:overflow-x-auto max-[1100px]:overflow-y-hidden max-[1100px]:pb-0 max-[760px]:grid-cols-[minmax(0,1fr)] max-[760px]:grid-rows-[auto_auto_minmax(0,1fr)] max-[760px]:overflow-x-hidden max-[760px]:overflow-y-auto max-[760px]:pb-3.5">
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
