<script setup lang="ts">
import type { DashboardContractResult, DashboardRun, DashboardVerdict } from '@figloom/contracts';
import type { ContractStatusFilter, ContractTreeItem } from '../lib/contract-tree';
import { formatRatio } from '../lib/format';
import StatusBadge from './StatusBadge.vue';

defineProps<{
  run: DashboardRun;
  contractsCount: number;
  contractTree: ContractTreeItem[];
  selectedTreeItem?: ContractTreeItem;
}>();

const query = defineModel<string>('query', { required: true });
const status = defineModel<ContractStatusFilter>('status', { required: true });

const emit = defineEmits<{
  select: [contract: DashboardContractResult];
}>();

const statusOptions: Array<{ label: string; value: ContractStatusFilter }> = [
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

function treeItemKey(item: ContractTreeItem) {
  return item.id;
}

function onTreeSelect(event: { preventDefault: () => void }, item: ContractTreeItem) {
  if (item.kind !== 'contract') {
    event.preventDefault();
    return;
  }
  emit('select', item.contract);
}
</script>

<template>
  <div class="min-w-0 w-full min-h-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto]">
    <header class="flex justify-between items-center gap-2 px-3 pt-3 pb-2.5">
      <div class="min-w-0">
        <strong class="block overflow-hidden text-ellipsis whitespace-nowrap text-[0.84rem]">{{ run.suiteName ?? 'Verification run' }}</strong>
        <span class="block mt-0.5 text-muted text-[0.68rem]">{{ contractsCount }} of {{ run.summary.total }} stories</span>
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
        :get-key="treeItemKey"
        :on-select="onTreeSelect"
        size="sm"
        color="neutral"
        :ui="{
          root: 'gap-px',
          item: 'p-0',
          itemWithChildren: 'ms-0 ps-0 border-s-0',
          link: 'min-h-7 gap-1.5 rounded-sm px-1.5 py-1 hover:bg-panel-hover data-[selected]:bg-selection! data-[selected]:text-selection-fg! hover:data-[selected]:bg-selection!',
          linkLabel: 'min-w-0',
          linkTrailing: 'ms-auto',
          listWithChildren: 'ms-3 ps-1 border-s border-line',
        }"
      >
        <template #item-leading="{ item, expanded }">
          <span
            v-if="item.kind === 'feature'"
            class="w-3 text-center text-accent text-[0.66rem]"
            aria-hidden="true"
          >{{ expanded ? '▾' : '▸' }}</span>
          <span v-else class="w-1.5 h-1.5 mx-0.75 rounded-full" :class="dotColor[item.status]" />
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
            <span class="min-w-[1ch] text-muted text-[0.66rem] tabular-nums">{{ item.leafCount }}</span>
          </span>
          <span v-else class="min-w-[3.6em] text-text-subtle font-medium text-[0.7rem] leading-none text-right font-mono">{{ formatRatio(item.contract.comparison?.diffRatio) }}</span>
        </template>
      </UTree>
      <div v-if="run.summary.total === 0" class="px-5 py-7.5 text-muted text-center text-[0.8rem]">No verifications yet — run <code>figloom verify</code> to produce one.</div>
      <div v-else-if="contractsCount === 0" class="px-5 py-7.5 text-muted text-center text-[0.8rem]">No contracts match current filter.</div>
    </div>
    <footer class="border-t border-line px-2.5 py-2.5 bg-panel-deep" aria-label="Verification summary">
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
        <span v-if="run.summary.queued">{{ run.summary.queued }} queued</span>
      </div>
      <p class="mt-2 text-muted text-[0.62rem]">Alt + ← / → to move selection</p>
    </footer>
  </div>
</template>
