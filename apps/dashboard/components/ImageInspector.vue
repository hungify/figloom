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
type EvidenceKind = 'baseline' | 'actual' | 'diff';
const naturalSizes = reactive<Record<EvidenceKind, CanvasSize>>({
  baseline: { width: 0, height: 0 },
  actual: { width: 0, height: 0 },
  diff: { width: 0, height: 0 },
});
const autoFit = ref(true);
const { view, MIN_ZOOM, MAX_ZOOM, fitToView, centerAt, zoomAt, pan } = useCanvasView();

function containerSize(): CanvasSize {
  const el = viewportEl.value;
  if (!el) return { width: 0, height: 0 };
  const width = mode.value === 'split' ? el.clientWidth / 2 : el.clientWidth;
  return { width, height: el.clientHeight };
}

function fitToViewport(): void {
  if (!contentSize.width || !contentSize.height) return;
  const container = containerSize();
  if (!container.width || !container.height) return;
  fitToView(container, contentSize);
  autoFit.value = true;
}

function zoomTo100(): void {
  if (!contentSize.width || !contentSize.height) return;
  centerAt(containerSize(), contentSize, 1);
  autoFit.value = false;
}

function evidenceSize(kind: EvidenceKind): CanvasSize {
  const evidence = props.contract[kind];
  return {
    width: evidence?.width ?? naturalSizes[kind].width,
    height: evidence?.height ?? naturalSizes[kind].height,
  };
}

function measureContent(): boolean {
  const baseline = evidenceSize('baseline');
  const actual = evidenceSize('actual');
  const width = Math.max(baseline.width, actual.width);
  const height = Math.max(baseline.height, actual.height);
  if (!width || !height) return false;
  contentSize.width = width;
  contentSize.height = height;
  return true;
}

function imageStyle(kind: EvidenceKind): Record<string, string | undefined> {
  const size = evidenceSize(kind);
  return {
    width: size.width ? `${size.width}px` : undefined,
    height: size.height ? `${size.height}px` : undefined,
  };
}

function onImageLoad(event: Event, kind: EvidenceKind): void {
  const img = event.target as HTMLImageElement;
  naturalSizes[kind].width = img.naturalWidth;
  naturalSizes[kind].height = img.naturalHeight;
  if (measureContent() && autoFit.value) fitToViewport();
}

watch(
  () => [
    props.contract.id,
    props.contract.baseline?.path,
    props.contract.baseline?.width,
    props.contract.baseline?.height,
    props.contract.actual?.path,
    props.contract.actual?.width,
    props.contract.actual?.height,
    props.contract.diff?.path,
  ],
  () => {
    contentSize.width = 0;
    contentSize.height = 0;
    for (const size of Object.values(naturalSizes)) {
      size.width = 0;
      size.height = 0;
    }
    autoFit.value = true;
    reveal.value = 50;
    opacity.value = 55;
    void nextTick(() => {
      if (measureContent()) fitToViewport();
    });
  },
  { immediate: true },
);

watch(mode, () => {
  void nextTick(fitToViewport);
});

let resizeObserver: ResizeObserver | null = null;
watch(viewportEl, (el) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el) return;
  if (autoFit.value) fitToViewport();
  resizeObserver = new ResizeObserver(() => {
    if (autoFit.value) fitToViewport();
  });
  resizeObserver.observe(el);
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
  autoFit.value = false;
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
  autoFit.value = false;
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
  autoFit.value = false;
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
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  resizeObserver?.disconnect();
});
</script>

<template>
  <section class="relative h-full bg-bg overflow-hidden" aria-label="Visual comparison inspector">
    <div
      v-if="ready"
      ref="viewportEl"
      class="absolute inset-0 overflow-hidden touch-none"
      :class="dragState ? 'cursor-grabbing' : 'cursor-grab'"
      @wheel="onWheel"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="endPan"
      @pointercancel="endPan"
    >
      <div
        class="absolute inset-0 [background-image:radial-gradient(circle,#2b2f34_1px,transparent_1px)] [background-size:22px_22px] pointer-events-none"
        aria-hidden="true"
      />

      <template v-if="mode === 'split'">
        <div class="absolute top-0 bottom-0 left-0 w-1/2 overflow-hidden border-r border-line">
          <span class="absolute top-2.5 left-2.5 z-[1] px-2 py-[3px] rounded-[4px] bg-[rgb(17_19_21_/_82%)] text-muted font-semibold text-[0.68rem] leading-none font-mono pointer-events-none">Baseline</span>
          <div class="absolute top-0 left-0 bg-[#f1f2f3] shadow-[0_0_0_1px_#353a40,0_20px_48px_rgb(0_0_0_/_45%)]" :style="contentStyle">
            <img class="block max-w-none select-none [-webkit-user-drag:none]" :style="imageStyle('baseline')" :src="baselineUrl" alt="Baseline capture" draggable="false" @load="onImageLoad($event, 'baseline')" />
          </div>
        </div>
        <div class="absolute top-0 bottom-0 left-1/2 w-1/2 overflow-hidden">
          <span class="absolute top-2.5 left-2.5 z-[1] px-2 py-[3px] rounded-[4px] bg-[rgb(17_19_21_/_82%)] text-muted font-semibold text-[0.68rem] leading-none font-mono pointer-events-none">Actual</span>
          <div class="absolute top-0 left-0 bg-[#f1f2f3] shadow-[0_0_0_1px_#353a40,0_20px_48px_rgb(0_0_0_/_45%)]" :style="contentStyle">
            <img class="block max-w-none select-none [-webkit-user-drag:none]" :style="imageStyle('actual')" :src="actualUrl" alt="Actual capture" draggable="false" @load="onImageLoad($event, 'actual')" />
          </div>
        </div>
      </template>

      <div v-else class="absolute top-0 left-0 bg-[#f1f2f3] shadow-[0_0_0_1px_#353a40,0_20px_48px_rgb(0_0_0_/_45%)]" :style="contentStyle">
        <ImageReveal
          v-if="mode === 'overlay'"
          v-model="reveal"
          :before-src="baselineUrl"
          :after-src="actualUrl"
          before-alt="Baseline capture"
          after-alt="Actual capture"
          :opacity="opacity"
          :canvas-width="contentSize.width"
          :canvas-height="contentSize.height"
          :before-width="evidenceSize('baseline').width"
          :before-height="evidenceSize('baseline').height"
          :after-width="evidenceSize('actual').width"
          :after-height="evidenceSize('actual').height"
          @before-load="onImageLoad($event, 'baseline')"
          @after-load="onImageLoad($event, 'actual')"
        />
        <img
          v-else-if="mode === 'baseline'"
          class="block max-w-none select-none [-webkit-user-drag:none]"
          :style="imageStyle('baseline')"
          :src="baselineUrl"
          alt="Baseline capture"
          draggable="false"
          @load="onImageLoad($event, 'baseline')"
        />
        <img
          v-else-if="mode === 'actual'"
          class="block max-w-none select-none [-webkit-user-drag:none]"
          :style="imageStyle('actual')"
          :src="actualUrl"
          alt="Actual capture"
          draggable="false"
          @load="onImageLoad($event, 'actual')"
        />
        <img
          v-else-if="mode === 'diff' && diffUrl"
          class="block max-w-none select-none [-webkit-user-drag:none]"
          :style="imageStyle('diff')"
          :src="diffUrl"
          alt="Visual difference heatmap"
          draggable="false"
          @load="onImageLoad($event, 'diff')"
        />
      </div>

      <div v-if="mode === 'diff' && !diffUrl" class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-muted text-center bg-transparent">
        <strong class="text-text text-[0.95rem]">No diff image</strong>
        <p class="max-w-[420px] m-0 text-[0.8rem]">Comparison produced no residual heatmap.</p>
      </div>
    </div>

    <div v-if="!ready" class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-muted text-center bg-bg">
      <strong class="text-text text-[0.95rem]">Evidence unavailable</strong>
      <p class="max-w-[420px] m-0 text-[0.8rem]">{{ contract.blockers[0]?.message ?? 'Capture has not completed.' }}</p>
    </div>

    <UFieldGroup
      v-if="ready"
      class="absolute bottom-4 left-1/2 -translate-x-1/2 z-[3] flex items-center gap-0.5 p-1 border border-line rounded-lg bg-[rgb(23_25_28_/_92%)] backdrop-blur-[14px] shadow-[0_10px_28px_rgb(0_0_0_/_40%)] max-[980px]:min-[761px]:max-w-[calc(100vw-580px)] max-[980px]:min-[761px]:overflow-x-auto max-[760px]:bottom-3 max-[760px]:max-w-[calc(100vw-24px)] max-[760px]:overflow-x-auto"
      role="tablist"
      aria-label="Comparison mode"
    >
      <UButton
        v-for="item in modes"
        :key="item.value"
        role="tab"
        :aria-selected="mode === item.value"
        color="neutral"
        variant="ghost"
        size="sm"
        class="min-h-[30px] px-[11px]! py-[5px]! border-0 rounded-[5px]! text-[0.78rem] cursor-pointer"
        :class="mode === item.value ? 'text-[#11151a]! bg-accent! hover:bg-accent!' : 'bg-transparent! text-muted! hover:text-text! hover:bg-[var(--ui-bg-accented)]!'"
        @click="mode = item.value"
      >
        {{ item.label }}
      </UButton>
      <template v-if="mode === 'overlay'">
        <span class="w-px h-5 mx-1 bg-line" aria-hidden="true" />
        <label class="flex items-center gap-1.5 pl-0.5 pr-1.5 text-muted text-xs">
          <span>Opacity</span>
          <USlider v-model="opacity" class="w-[90px]" :min="0" :max="100" color="primary" size="xs" aria-label="Opacity" />
          <output class="min-w-8 text-right text-[#b9bdc2] text-[0.72rem]">{{ opacity }}%</output>
        </label>
      </template>
    </UFieldGroup>

    <UFieldGroup v-if="ready" class="absolute bottom-4 left-4 z-[3] flex items-center gap-0.5 p-1 border border-line rounded-lg bg-[rgb(23_25_28_/_92%)] backdrop-blur-[14px] shadow-[0_10px_28px_rgb(0_0_0_/_40%)] max-[760px]:hidden">
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        class="min-h-7 px-[9px]! py-1! border-0 rounded-[5px]! bg-transparent! text-muted! font-medium text-[0.74rem] leading-none font-mono cursor-pointer enabled:hover:text-text! enabled:hover:bg-[#25292e]! disabled:opacity-[.35] disabled:cursor-default"
        aria-label="Zoom out"
        :disabled="zoomPercent <= MIN_ZOOM * 100"
        @click="stepZoom(1 / zoomStepFactor)"
      >
        −
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        class="min-h-7 min-w-[46px] px-[9px]! py-1! border-0 rounded-[5px]! bg-transparent! text-muted! font-medium text-[0.74rem] leading-none font-mono cursor-pointer enabled:hover:text-text! enabled:hover:bg-[#25292e]!"
        title="Fit to view"
        @click="fitToViewport"
      >
        {{ zoomPercent }}%
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        class="min-h-7 px-[9px]! py-1! border-0 rounded-[5px]! bg-transparent! text-muted! font-medium text-[0.74rem] leading-none font-mono cursor-pointer enabled:hover:text-text! enabled:hover:bg-[#25292e]! disabled:opacity-[.35] disabled:cursor-default"
        aria-label="Zoom in"
        :disabled="zoomPercent >= MAX_ZOOM * 100"
        @click="stepZoom(zoomStepFactor)"
      >
        +
      </UButton>
      <span class="w-px h-[18px] mx-0.5 bg-line" aria-hidden="true" />
      <UButton color="neutral" variant="ghost" size="xs" class="min-h-7 px-[9px]! py-1! border-0 rounded-[5px]! bg-transparent! text-muted! font-medium text-[0.74rem] leading-none font-mono cursor-pointer hover:text-text! hover:bg-[#25292e]!" @click="zoomTo100">100%</UButton>
      <UButton color="neutral" variant="ghost" size="xs" class="min-h-7 px-[9px]! py-1! border-0 rounded-[5px]! bg-transparent! text-muted! font-medium text-[0.74rem] leading-none font-mono cursor-pointer hover:text-text! hover:bg-[#25292e]!" @click="fitToViewport">Fit</UButton>
    </UFieldGroup>
  </section>
</template>
