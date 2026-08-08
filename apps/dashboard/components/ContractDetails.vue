<script setup lang="ts">
import type { DashboardContractResult } from '@figloom/contracts';
import { formatRatio } from '../lib/format';
import StatusBadge from './StatusBadge.vue';

defineProps<{
  contract: DashboardContractResult;
}>();
</script>

<template>
  <div class="min-w-0 w-full min-h-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-x-hidden overflow-y-auto pb-3.5 max-[1100px]:grid-cols-[minmax(220px,0.8fr)_minmax(340px,1.2fr)_minmax(260px,1fr)] max-[1100px]:grid-rows-[minmax(0,1fr)] max-[1100px]:items-start max-[1100px]:overflow-x-auto max-[1100px]:overflow-y-hidden max-[1100px]:pb-0 max-[760px]:grid-cols-[minmax(0,1fr)] max-[760px]:grid-rows-[auto_auto_minmax(0,1fr)] max-[760px]:overflow-x-hidden max-[760px]:overflow-y-auto max-[760px]:pb-3.5">
    <header class="block px-3.5 pt-3.5 pb-2.5">
      <div class="flex items-center gap-2.25">
        <h1 class="m-0 text-[0.98rem] font-semibold tracking-[-0.01em]">{{ contract.name }}</h1>
        <StatusBadge :status="contract.status" />
      </div>
      <code class="block mt-1 text-muted text-[0.7rem]">{{ contract.id }}</code>
    </header>
    <dl class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-2.5 gap-y-3 w-full min-w-0 m-0 px-3.5 pb-3.5">
      <div class="min-w-0"><dt class="text-muted text-[0.7rem]">Diff ratio</dt><dd class="mt-0.75 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[0.8rem] leading-tight font-mono">{{ formatRatio(contract.comparison?.diffRatio) }}</dd></div>
      <div class="min-w-0"><dt class="text-muted text-[0.7rem]">Pixels</dt><dd class="mt-0.75 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[0.8rem] leading-tight font-mono">{{ contract.comparison?.diffPixels?.toLocaleString() ?? '—' }}</dd></div>
      <div class="min-w-0"><dt class="text-muted text-[0.7rem]">Viewport</dt><dd class="mt-0.75 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[0.8rem] leading-tight font-mono">{{ contract.capture.viewport.width }}×{{ contract.capture.viewport.height }}</dd></div>
      <div class="min-w-0"><dt class="text-muted text-[0.7rem]">Baseline</dt><dd class="mt-0.75 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[0.8rem] leading-tight font-mono">{{ contract.baselineKind }}</dd></div>
    </dl>
    <div
      v-if="contract.blockers.length || contract.baseline?.provenance || contract.evidenceHash"
      class="flex flex-col gap-2.5 mx-3.5 mt-1 pt-3 border-t border-line-soft"
    >
      <div v-if="contract.blockers.length" class="min-w-0">
        <span class="block text-muted text-[0.68rem]">Blockers</span>
        <ul class="m-0 mt-1.5 p-0 list-none flex flex-col gap-1.5">
          <li
            v-for="(blocker, index) in contract.blockers"
            :key="`${blocker.code}-${index}`"
            class="min-w-0 text-[0.72rem] leading-[1.35]"
          >
            <code class="text-amber text-[0.68rem]">{{ blocker.code }}</code>
            <span class="text-text-soft"> — {{ blocker.message }}</span>
          </li>
        </ul>
      </div>
      <div v-if="contract.baseline?.provenance" class="min-w-0">
        <span class="block overflow-hidden text-ellipsis whitespace-nowrap text-muted text-[0.68rem]">Baseline provenance</span>
        <code class="block overflow-hidden text-ellipsis whitespace-nowrap mt-0.75 text-text-soft text-[0.68rem]">{{ contract.baseline.provenance }}</code>
      </div>
      <div v-if="contract.evidenceHash" class="min-w-0">
        <span class="block overflow-hidden text-ellipsis whitespace-nowrap text-muted text-[0.68rem]">Evidence hash</span>
        <code class="block overflow-hidden text-ellipsis whitespace-nowrap mt-0.75 text-text-soft text-[0.68rem]">{{ contract.evidenceHash }}</code>
      </div>
    </div>
  </div>
</template>
