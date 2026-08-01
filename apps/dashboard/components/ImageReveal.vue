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
  <div ref="root" class="image-reveal">
    <img class="image-reveal__layer" :src="beforeSrc" :alt="beforeAlt" draggable="false" />
    <img
      class="image-reveal__layer image-reveal__after"
      :src="afterSrc"
      :alt="afterAlt"
      :style="{
        clipPath: `inset(0 ${100 - reveal}% 0 0)`,
        opacity: opacity / 100,
      }"
      draggable="false"
    />
    <div
      class="image-reveal__divider"
      :class="{ 'is-dragging': activePointer !== null }"
      :style="{ left: `${reveal}%` }"
      role="slider"
      tabindex="0"
      aria-label="Reveal after image"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="reveal"
      @pointerdown.prevent="startDrag"
      @pointermove.prevent="drag"
      @pointerup="stopDrag"
      @pointercancel="stopDrag"
      @keydown="onKeydown"
    >
      <span aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.image-reveal {
  position: relative;
  flex: none;
  background: #f1f2f3;
  box-shadow: 0 0 0 1px #353a40, 0 10px 28px rgb(0 0 0 / 24%);
  transform: scale(var(--zoom));
  transform-origin: center;
}

.image-reveal__layer {
  display: block;
  max-width: none;
  user-select: none;
  -webkit-user-drag: none;
}

.image-reveal__after {
  position: absolute;
  inset: 0;
}

.image-reveal__divider {
  position: absolute;
  top: -8px;
  bottom: -8px;
  width: 24px;
  margin-left: -12px;
  cursor: ew-resize;
  touch-action: none;
}

.image-reveal__divider::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: var(--accent);
  content: '';
  transform: translateX(-50%);
}

.image-reveal__divider:hover::before,
.image-reveal__divider:focus-visible::before,
.image-reveal__divider.is-dragging::before {
  width: 2px;
}

.image-reveal__divider:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.image-reveal__divider span {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 18px;
  height: 30px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  background: #20252b;
  transform: translate(-50%, -50%);
}

.image-reveal__divider span::before,
.image-reveal__divider span::after {
  position: absolute;
  top: 50%;
  width: 0;
  height: 0;
  border-top: 3px solid transparent;
  border-bottom: 3px solid transparent;
  content: '';
  transform: translateY(-50%);
}

.image-reveal__divider span::before {
  left: 3px;
  border-right: 3px solid var(--accent);
}

.image-reveal__divider span::after {
  right: 3px;
  border-left: 3px solid var(--accent);
}
</style>
