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
  <div class="app-shell">
    <header class="topbar">
      <div class="wordmark" aria-label="Figloom">
        <strong>Figloom</strong>
      </div>
      <div v-if="run" class="run-identity">
        <span>{{ run.suiteName ?? 'Verification run' }}</span>
        <code>{{ run.runId }}</code>
      </div>
      <div class="connection-state">
        <span :class="{ live: liveMode }" />
        {{ mockMode ? 'Mock data' : staticMode ? 'Report' : liveMode ? 'Live' : 'Archived' }}
      </div>
    </header>

    <main v-if="loading" class="loading-state">
      <p>Loading verification evidence</p>
      <UProgress class="loading-progress" color="primary" size="xs" animation="carousel" />
    </main>

    <main v-else-if="error" class="fatal-state">
      <p class="eyebrow">Dashboard unavailable</p>
      <h1>Verification artifact could not be loaded.</h1>
      <code>{{ error }}</code>
      <p>Open this report through <code>figloom open</code> or serve static report directory over HTTP.</p>
    </main>

    <main v-else-if="run" class="workspace">
      <ImageInspector v-if="selected" :contract="selected" :artifact-url="artifactUrl" class="workspace-canvas" />
      <div v-else class="workspace-canvas workspace-empty">No contract selected.</div>

      <aside class="panel panel-layers">
        <div class="panel-body">
          <header>
            <div>
              <strong>Contracts</strong>
              <span>{{ contracts.length }} of {{ run.summary.total }}</span>
            </div>
            <StatusBadge :status="run.status" />
          </header>
          <div class="run-summary" aria-label="Contract status totals">
            <span>{{ run.summary.passed }} passed</span>
            <span v-if="run.summary.failed">{{ run.summary.failed }} failed</span>
            <span v-if="run.summary.blocked">{{ run.summary.blocked }} blocked</span>
            <span v-if="run.summary.running">{{ run.summary.running }} running</span>
          </div>
          <div class="contract-filters">
            <UInput
              v-model="query"
              class="search-field"
              type="search"
              color="neutral"
              variant="outline"
              size="sm"
              aria-label="Search contracts"
              placeholder="Search contracts"
            />
            <USelect
              v-model="status"
              class="status-filter"
              :items="statusOptions"
              color="neutral"
              variant="outline"
              size="sm"
              aria-label="Filter by status"
            />
          </div>
          <div class="contract-list">
            <UButton
              v-for="contract in contracts"
              :key="contract.id"
              :class="{ selected: selected?.id === contract.id }"
              color="neutral"
              variant="ghost"
              :ui="{ label: 'contents' }"
              @click="selectContract(contract)"
            >
              <span class="contract-status" :data-status="contract.status" />
              <span class="contract-copy">
                <strong>{{ contract.name }}</strong>
                <code>{{ contract.id }}</code>
              </span>
              <span class="contract-metric">{{ formatRatio(contract.comparison?.diffRatio) }}</span>
            </UButton>
            <div v-if="contracts.length === 0" class="list-empty">No contracts match current filter.</div>
          </div>
        </div>
      </aside>

      <aside v-if="selected" class="panel panel-details">
        <div class="panel-body">
          <header>
            <div class="detail-title-row">
              <h1>{{ selected.name }}</h1>
              <StatusBadge :status="selected.status" />
            </div>
            <code>{{ selected.id }}</code>
          </header>
          <dl>
            <div><dt>Diff ratio</dt><dd>{{ formatRatio(selected.comparison?.diffRatio) }}</dd></div>
            <div><dt>Pixels</dt><dd>{{ selected.comparison?.diffPixels?.toLocaleString() ?? '—' }}</dd></div>
            <div><dt>Viewport</dt><dd>{{ selected.capture.viewport.width }}×{{ selected.capture.viewport.height }}</dd></div>
            <div><dt>Baseline</dt><dd>{{ selected.baselineKind }}</dd></div>
          </dl>
          <div v-if="selected.baseline?.provenance || selected.evidenceHash" class="evidence-strip">
            <div v-if="selected.baseline?.provenance">
              <span>Baseline provenance</span>
              <code>{{ selected.baseline.provenance }}</code>
            </div>
            <div v-if="selected.evidenceHash">
              <span>Evidence hash</span>
              <code>{{ selected.evidenceHash }}</code>
            </div>
          </div>
        </div>
      </aside>
    </main>
  </div>
</template>
