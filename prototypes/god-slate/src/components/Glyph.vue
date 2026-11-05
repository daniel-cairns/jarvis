<script setup>
import { computed } from "vue";
import { GLYPHS } from "../data/glyphs.js";

/**
 * Draws one glyph from the fixed set. Decorative only (aria-hidden):
 * callers always pair it with visible text.
 * - carved: inset shadow (dark top-left, light bottom-right) under gold leaf.
 * - chisel: reveal stroke by stroke, then glint.
 */
const props = defineProps({
  name: { type: String, required: true },
  carved: { type: Boolean, default: false },
  chisel: { type: Boolean, default: false },
  size: { type: [Number, String], default: 40 },
});

const strokes = computed(() => GLYPHS[props.name]?.strokes ?? []);
const STEP = 0.32; // seconds between strokes while chiselling
const glintDelay = computed(() => `${strokes.value.length * STEP + 0.2}s`);
</script>

<template>
  <svg
    class="glyph"
    :class="{ carved, chisel }"
    viewBox="0 0 48 48"
    :width="size"
    :height="size"
    aria-hidden="true"
    focusable="false"
    :style="{ '--glint-delay': glintDelay }"
  >
    <template v-if="carved">
      <g class="cut-shadow" transform="translate(-1 -1)">
        <path v-for="(d, i) in strokes" :key="'s' + i" :d="d" pathLength="1" :style="{ '--i': i }" />
      </g>
      <g class="cut-light" transform="translate(1 1)">
        <path v-for="(d, i) in strokes" :key="'l' + i" :d="d" pathLength="1" :style="{ '--i': i }" />
      </g>
    </template>
    <g class="leaf">
      <path v-for="(d, i) in strokes" :key="'g' + i" :d="d" pathLength="1" :style="{ '--i': i }" />
    </g>
  </svg>
</template>
