<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { DashboardContractResult } from '@figloom/contracts';
import ImageReveal from './ImageReveal.vue';

const props = defineProps<{
  contract: DashboardContractResult;
  artifactUrl: (path: string | undefined) => string;
}>();

type Mode = 'baseline' | 'actual' | 'overlay' | 'diff' | 'split';
const mode = ref<Mode>('overlay');
const reveal = ref(50);
const opacity = ref(55);
const zoom = ref(100);

const baselineUrl = computed(() => props.artifactUrl(props.contract.baseline?.path));
const actualUrl = computed(() => props.artifactUrl(props.contract.actual?.path));
const diffUrl = computed(() => props.artifactUrl(props.contract.diff?.path));
const ready = computed(() => Boolean(props.contract.baseline && props.contract.actual));

const modes: Array<{ value: Mode; label: string; key: string }> = [
  { value: 'baseline', label: 'Baseline', key: '1' },
  { value: 'actual', label: 'Actual', key: '2' },
  { value: 'overlay', label: 'Scrub', key: '3' },
  { value: 'diff', label: 'Diff', key: '4' },
  { value: 'split', label: 'Split', key: '5' },
];

function onKeydown(event: KeyboardEvent) {
  const next = modes.find((item) => item.key === event.key);
  if (next && !event.metaKey && !event.ctrlKey && !event.altKey) mode.value = next.value;
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <section class="inspector-shell" aria-label="Visual comparison inspector">
    <header v-if="ready" class="inspector-toolbar">
      <UFieldGroup class="mode-switcher" role="tablist" aria-label="Comparison mode">
        <UButton
          v-for="item in modes"
          :key="item.value"
          type="button"
          role="tab"
          :aria-selected="mode === item.value"
          :class="{ active: mode === item.value }"
          :color="mode === item.value ? 'primary' : 'neutral'"
          :variant="mode === item.value ? 'subtle' : 'ghost'"
          size="sm"
          @click="mode = item.value"
        >
          {{ item.label }}
        </UButton>
      </UFieldGroup>
      <label class="zoom-control">
        <span>Zoom</span>
        <USlider v-model="zoom" class="inspector-slider" :min="25" :max="200" :step="5" color="primary" />
        <output>{{ zoom }}%</output>
      </label>
    </header>

    <div v-if="!ready" class="inspector-empty">
      <div class="empty-grid" />
      <strong>Evidence unavailable</strong>
      <p>{{ contract.blockers[0]?.message ?? 'Capture has not completed.' }}</p>
    </div>

    <div v-else class="stage-scroll">
      <div class="stage" :class="`mode-${mode}`" :style="{ '--zoom': `${zoom / 100}` }">
        <template v-if="mode === 'split'">
          <figure>
            <figcaption>Baseline</figcaption>
            <img :src="baselineUrl" alt="Baseline capture" />
          </figure>
          <figure>
            <figcaption>Actual</figcaption>
            <img :src="actualUrl" alt="Actual capture" />
          </figure>
        </template>
        <template v-else>
          <ImageReveal
            v-if="mode === 'overlay'"
            v-model="reveal"
            :before-src="baselineUrl"
            :after-src="actualUrl"
            before-alt="Baseline capture"
            after-alt="Actual capture"
            :opacity="opacity"
          />
          <div v-else class="image-stack">
            <img
              v-if="mode === 'baseline'"
              class="layer baseline-layer"
              :src="baselineUrl"
              alt="Baseline capture"
            />
            <img
              v-if="mode === 'actual'"
              class="layer actual-layer"
              :src="actualUrl"
              alt="Actual capture"
            />
            <img v-if="mode === 'diff' && diffUrl" class="layer" :src="diffUrl" alt="Visual difference heatmap" />
            <div v-else-if="mode === 'diff'" class="inspector-empty compact">
              <strong>No diff image</strong>
              <p>Comparison produced no residual heatmap.</p>
            </div>
          </div>
        </template>
      </div>
    </div>

    <footer v-if="ready && mode === 'overlay'" class="scrub-controls">
      <label>
        <span>Actual opacity</span>
        <USlider v-model="opacity" class="inspector-slider" :min="0" :max="100" color="primary" />
        <output>{{ opacity }}%</output>
      </label>
    </footer>
  </section>
</template>
