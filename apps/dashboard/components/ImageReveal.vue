<script setup lang="ts">
import { ref } from 'vue';

withDefaults(defineProps<{
  beforeSrc: string;
  afterSrc: string;
  beforeAlt?: string;
  afterAlt?: string;
  opacity?: number;
}>(), {
  beforeAlt: 'Before image',
  afterAlt: 'After image',
  opacity: 100,
});

const emit = defineEmits<{ load: [Event] }>();

const reveal = defineModel<number>({ default: 50 });
const root = ref<HTMLElement | null>(null);
const activePointer = ref<number | null>(null);

function updateReveal(clientX: number) {
  const bounds = root.value?.getBoundingClientRect();
  if (!bounds?.width) return;
  reveal.value = Math.round(Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100)));
}

function startDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  activePointer.value = event.pointerId;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  updateReveal(event.clientX);
}

function drag(event: PointerEvent) {
  if (activePointer.value === event.pointerId) updateReveal(event.clientX);
}

function stopDrag(event: PointerEvent) {
  if (activePointer.value === event.pointerId) activePointer.value = null;
}

function onKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? 10 : 1;
  if (event.key === 'ArrowLeft') reveal.value = Math.max(0, reveal.value - step);
  else if (event.key === 'ArrowRight') reveal.value = Math.min(100, reveal.value + step);
  else if (event.key === 'Home') reveal.value = 0;
  else if (event.key === 'End') reveal.value = 100;
  else return;
  event.preventDefault();
}
</script>

<template>
  <div ref="root" class="relative flex-none bg-[#f1f2f3] shadow-[0_0_0_1px_#353a40,0_10px_28px_rgb(0_0_0_/_24%)]">
    <img
      class="block max-w-none select-none [-webkit-user-drag:none]"
      :src="beforeSrc"
      :alt="beforeAlt"
      draggable="false"
      @load="emit('load', $event)"
    />
    <img
      class="block max-w-none select-none [-webkit-user-drag:none] absolute inset-0"
      :src="afterSrc"
      :alt="afterAlt"
      :style="{
        clipPath: `inset(0 ${100 - reveal}% 0 0)`,
        opacity: opacity / 100,
      }"
      draggable="false"
      @load="emit('load', $event)"
    />
    <div
      class="absolute -top-2 -bottom-2 w-6 -ml-3 cursor-ew-resize touch-none before:content-[''] before:absolute before:inset-y-0 before:left-1/2 before:bg-accent before:-translate-x-1/2 hover:before:w-0.5 focus-visible:before:w-0.5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      :class="activePointer !== null ? 'before:w-0.5' : 'before:w-px'"
      :style="{ left: `${reveal}%` }"
      role="slider"
      tabindex="0"
      aria-label="Reveal after image"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="reveal"
      @pointerdown.prevent.stop="startDrag"
      @pointermove.prevent.stop="drag"
      @pointerup.stop="stopDrag"
      @pointercancel.stop="stopDrag"
      @keydown="onKeydown"
    >
      <span
        aria-hidden="true"
        class="absolute top-1/2 left-1/2 w-[18px] h-[30px] border border-accent rounded-[3px] bg-[#20252b] -translate-x-1/2 -translate-y-1/2 before:content-[''] before:absolute before:top-1/2 before:left-[3px] before:w-0 before:h-0 before:border-t-[3px] before:border-b-[3px] before:border-t-transparent before:border-b-transparent before:border-r-[3px] before:border-r-accent before:-translate-y-1/2 after:content-[''] after:absolute after:top-1/2 after:right-[3px] after:w-0 after:h-0 after:border-t-[3px] after:border-b-[3px] after:border-t-transparent after:border-b-transparent after:border-l-[3px] after:border-l-accent after:-translate-y-1/2"
      />
    </div>
  </div>
</template>
