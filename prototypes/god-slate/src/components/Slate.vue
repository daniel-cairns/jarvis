<script setup>
import { computed } from "vue";
import Glyph from "./Glyph.vue";
import { GLYPHS } from "../data/glyphs.js";
import { slateWing } from "../wings.js";

/**
 * The slate: a small wing of carved, gilded cartouches that unfolds from
 * the orb. Glyphs only on the wing itself; each cartouche is a button named
 * by its meaning and session, with a tooltip (shown on hover and focus) as
 * its visible text label. Newest sits nearest the orb.
 */
const props = defineProps({
  entries: { type: Array, required: true },
  open: Boolean,
  side: { type: String, default: "to-left" }, // "to-left" | "to-right" of the orb
  reduceMotion: Boolean,
});
const emit = defineEmits(["hold", "release", "escape"]);

const CELL = 46; // horizontal space per cartouche
const ROOT_PAD = 22; // gap between the wing's root and the first cartouche
const HEIGHT = 128;

const width = computed(() => ROOT_PAD + props.entries.length * CELL + 8);
const wing = computed(() => slateWing({ width: width.value, rootY: 62, lift: 26, rootHalf: 27, tipHalf: 21 }));

const cells = computed(() =>
  props.entries.map((entry, i) => {
    const x = ROOT_PAD + CELL * (i + 0.5);
    return {
      entry,
      label: GLYPHS[entry.glyph].label,
      left: props.side === "to-left" ? width.value - x : x,
      top: wing.value.centreY(x),
    };
  }),
);

const needsYou = (entry) => !/^nothing/i.test(entry.needs);

/** Focus leaving the slate counts as a release only when it lands outside it. */
function onFocusOut(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) emit("release", "focus");
}
</script>

<template>
  <Transition :name="reduceMotion ? 'fade' : 'wing'">
    <section
      v-show="open"
      id="slate"
      class="slate-wing"
      :class="side"
      :style="{ width: width + 'px', height: HEIGHT + 'px' }"
      aria-label="The slate: sessions and loops"
      @mouseenter="emit('hold', 'hover')"
      @mouseleave="emit('release', 'hover')"
      @focusin="emit('hold', 'focus')"
      @focusout="onFocusOut"
      @keydown.esc.stop.prevent="emit('escape')"
    >
      <svg
        class="wing-art"
        :viewBox="`0 0 ${width + 16} ${HEIGHT}`"
        :width="width + 16"
        :height="HEIGHT"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="slate-lapis" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style="stop-color: var(--lapis-top)" />
            <stop offset="1" style="stop-color: var(--lapis-deep)" />
          </linearGradient>
        </defs>
        <polygon v-for="(f, i) in wing.feathers" :key="'f' + i" :points="f.points" :fill="f.fill" />
        <polyline v-for="(l, i) in wing.lines" :key="'l' + i" :points="l.points" :stroke="l.stroke" fill="none" stroke-width="1.2" />
        <path class="wing-band" :d="wing.band" />
      </svg>

      <TransitionGroup tag="ol" :name="reduceMotion ? 'fade' : 'carve'" class="slate-cells">
        <li
          v-for="cell in cells"
          :key="cell.entry.id"
          class="slate-cell"
          :class="{ fresh: cell.entry.fresh }"
          :style="{ left: cell.left + 'px', top: cell.top + 'px' }"
        >
          <button
            type="button"
            class="cartouche"
            :aria-label="`${cell.label}: ${cell.entry.title}`"
            :aria-describedby="`tip-${cell.entry.id}`"
          >
            <Glyph :name="cell.entry.glyph" carved :chisel="cell.entry.fresh" :size="26" />
          </button>
          <div :id="`tip-${cell.entry.id}`" role="tooltip" class="slate-tip">
            <p class="tip-head"><span class="tip-meaning">{{ cell.label }}</span> · {{ cell.entry.title }}</p>
            <p class="tip-line">{{ cell.entry.line }}</p>
            <dl class="tip-detail">
              <div><dt>Time</dt><dd>{{ cell.entry.time }}</dd></div>
              <div><dt>Last action</dt><dd>{{ cell.entry.lastAction }}</dd></div>
              <div :class="{ needs: needsYou(cell.entry) }"><dt>Needs from you</dt><dd>{{ cell.entry.needs }}</dd></div>
            </dl>
          </div>
        </li>
      </TransitionGroup>
    </section>
  </Transition>
</template>
