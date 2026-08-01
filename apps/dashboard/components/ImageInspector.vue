<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { DashboardContractResult } from '@figloom/contracts';
import ImageReveal from './ImageReveal.vue';
import { useCanvasView, type CanvasSize } from '../composables/useCanvasView';
import { isTypingTarget } from '../lib/dom';

const props = defineProps<{
  contract: DashboardContractResult;
  artifactUrl: (path: string | undefined) => string;
}>();

type Mode = 'baseline' | 'actual' | 'overlay' | 'diff' | 'split';
const mode = ref<Mode>('overlay');
const reveal = ref(50);
const opacity = ref(55);

const modes: Array<{ value: Mode; label: string; code: string }> = [
  { value: 'baseline', label: 'Baseline', code: 'Digit1' },
  { value: 'actual', label: 'Actual', code: 'Digit2' },
  { value: 'overlay', label: 'Scrub', code: 'Digit3' },
  { value: 'diff', label: 'Diff', code: 'Digit4' },
  { value: 'split', label: 'Split', code: 'Digit5' },
];

const baselineUrl = computed(() => props.artifactUrl(props.contract.baseline?.path));
const actualUrl = computed(() => props.artifactUrl(props.contract.actual?.path));
const diffUrl = computed(() => props.artifactUrl(props.contract.diff?.path));
const ready = computed(() => Boolean(props.contract.baseline && props.contract.actual));

const viewportEl = ref<HTMLElement | null>(null);
const contentSize = reactive({ width: 0, height: 0 });
const { view, MIN_ZOOM, MAX_ZOOM, fitToView, centerAt, zoomAt, pan } = useCanvasView();

function containerSize(): CanvasSize {
  const el = viewportEl.value;
  if (!el) return { width: 0, height: 0 };
  const width = mode.value === 'split' ? el.clientWidth / 2 : el.clientWidth;
  return { width, height: el.clientHeight };
}

function fitToViewport(): void {
  if (!contentSize.width || !contentSize.height) return;
  fitToView(containerSize(), contentSize);
}

function zoomTo100(): void {
  if (!contentSize.width || !contentSize.height) return;
  centerAt(containerSize(), contentSize, 1);
}

function measureFromEvidence(): boolean {
  const width = Math.max(props.contract.baseline?.width ?? 0, props.contract.actual?.width ?? 0);
  const height = Math.max(props.contract.baseline?.height ?? 0, props.contract.actual?.height ?? 0);
  if (!width || !height) return false;
  contentSize.width = width;
  contentSize.height = height;
  return true;
}

function onImageLoad(event: Event): void {
  if (contentSize.width && contentSize.height) return;
  const img = event.target as HTMLImageElement;
  contentSize.width = img.naturalWidth;
  contentSize.height = img.naturalHeight;
  fitToViewport();
}

watch(
  () => props.contract.id,
  () => {
    contentSize.width = 0;
    contentSize.height = 0;
    reveal.value = 50;
    opacity.value = 55;
    void nextTick(() => {
      if (measureFromEvidence()) fitToViewport();
    });
  },
  { immediate: true },
);

watch(mode, () => {
  void nextTick(fitToViewport);
});

const contentStyle = computed(() => ({
  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
  transformOrigin: '0 0',
  width: contentSize.width ? `${contentSize.width}px` : undefined,
  height: contentSize.height ? `${contentSize.height}px` : undefined,
}));

const zoomPercent = computed(() => Math.round(view.scale * 100));
const zoomStepFactor = 1.2;

function stepZoom(factor: number): void {
  const size = containerSize();
  zoomAt(factor, size.width / 2, size.height / 2);
}

function onWheel(event: WheelEvent): void {
  if (!ready.value) return;
  event.preventDefault();
  const rect = viewportEl.value?.getBoundingClientRect();
  if (!rect) return;
  let pivotX = event.clientX - rect.left;
  const pivotY = event.clientY - rect.top;
  if (mode.value === 'split') pivotX %= rect.width / 2;
  if (event.ctrlKey || event.metaKey) {
    zoomAt(Math.exp(-event.deltaY * 0.01), pivotX, pivotY);
  } else {
    pan(event.deltaX, event.deltaY);
  }
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originTx: number;
  originTy: number;
}
const dragState = ref<DragState | null>(null);

function startPan(event: PointerEvent): void {
  if (event.button !== 0 && event.button !== 1) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originTx: view.tx,
    originTy: view.ty,
  };
}
function movePan(event: PointerEvent): void {
  const drag = dragState.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  view.tx = drag.originTx + (event.clientX - drag.startX);
  view.ty = drag.originTy + (event.clientY - drag.startY);
}
function endPan(event: PointerEvent): void {
  if (dragState.value?.pointerId === event.pointerId) dragState.value = null;
}

function onKeydown(event: KeyboardEvent): void {
  if (isTypingTarget(event.target)) return;
  if (event.shiftKey && event.code === 'Digit1') {
    fitToViewport();
    event.preventDefault();
    return;
  }
  if (event.shiftKey && event.code === 'Digit0') {
    zoomTo100();
    event.preventDefault();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const shortcut = modes.find((item) => item.code === event.code);
  if (shortcut) {
    mode.value = shortcut.value;
    return;
  }
  if (event.code === 'Equal' || event.code === 'NumpadAdd') {
    stepZoom(zoomStepFactor);
    event.preventDefault();
  } else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
    stepZoom(1 / zoomStepFactor);
    event.preventDefault();
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <section class="inspector-shell" aria-label="Visual comparison inspector">
    <div
      v-if="ready"
      ref="viewportEl"
      class="canvas-viewport"
      :class="{ 'is-panning': dragState }"
      @wheel="onWheel"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="endPan"
      @pointercancel="endPan"
    >
      <div class="canvas-dots" aria-hidden="true" />

      <template v-if="mode === 'split'">
        <div class="split-pane">
          <span class="split-label">Baseline</span>
          <div class="canvas-content" :style="contentStyle">
            <img class="canvas-image" :src="baselineUrl" alt="Baseline capture" draggable="false" @load="onImageLoad" />
          </div>
        </div>
        <div class="split-pane">
          <span class="split-label">Actual</span>
          <div class="canvas-content" :style="contentStyle">
            <img class="canvas-image" :src="actualUrl" alt="Actual capture" draggable="false" @load="onImageLoad" />
          </div>
        </div>
      </template>

      <div v-else class="canvas-content" :style="contentStyle">
        <ImageReveal
          v-if="mode === 'overlay'"
          v-model="reveal"
          :before-src="baselineUrl"
          :after-src="actualUrl"
          before-alt="Baseline capture"
          after-alt="Actual capture"
          :opacity="opacity"
        />
        <img
          v-else-if="mode === 'baseline'"
          class="canvas-image"
          :src="baselineUrl"
          alt="Baseline capture"
          draggable="false"
          @load="onImageLoad"
        />
        <img
          v-else-if="mode === 'actual'"
          class="canvas-image"
          :src="actualUrl"
          alt="Actual capture"
          draggable="false"
          @load="onImageLoad"
        />
        <img
          v-else-if="mode === 'diff' && diffUrl"
          class="canvas-image"
          :src="diffUrl"
          alt="Visual difference heatmap"
          draggable="false"
        />
      </div>

      <div v-if="mode === 'diff' && !diffUrl" class="inspector-empty compact">
        <strong>No diff image</strong>
        <p>Comparison produced no residual heatmap.</p>
      </div>
    </div>

    <div v-if="!ready" class="inspector-empty">
      <strong>Evidence unavailable</strong>
      <p>{{ contract.blockers[0]?.message ?? 'Capture has not completed.' }}</p>
    </div>

    <div v-if="ready" class="floating-toolbar" role="tablist" aria-label="Comparison mode">
      <button
        v-for="item in modes"
        :key="item.value"
        type="button"
        role="tab"
        :aria-selected="mode === item.value"
        :class="{ active: mode === item.value }"
        @click="mode = item.value"
      >
        {{ item.label }}
      </button>
      <template v-if="mode === 'overlay'">
        <span class="toolbar-divider" aria-hidden="true" />
        <label class="opacity-control">
          <span>Opacity</span>
          <input v-model.number="opacity" type="range" min="0" max="100" />
          <output>{{ opacity }}%</output>
        </label>
      </template>
    </div>

    <div v-if="ready" class="zoom-widget">
      <button type="button" aria-label="Zoom out" :disabled="zoomPercent <= MIN_ZOOM * 100" @click="stepZoom(1 / zoomStepFactor)">−</button>
      <button type="button" class="zoom-percent" title="Fit to view" @click="fitToViewport">{{ zoomPercent }}%</button>
      <button type="button" aria-label="Zoom in" :disabled="zoomPercent >= MAX_ZOOM * 100" @click="stepZoom(zoomStepFactor)">+</button>
      <span class="zoom-divider" aria-hidden="true" />
      <button type="button" @click="zoomTo100">100%</button>
      <button type="button" @click="fitToViewport">Fit</button>
    </div>
  </section>
</template>
