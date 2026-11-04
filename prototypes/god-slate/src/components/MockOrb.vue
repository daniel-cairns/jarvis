<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Glyph from "./Glyph.vue";
import { GLYPHS } from "../data/glyphs.js";
import { orbWings, wingPoint } from "../wings.js";

/**
 * A stand-in orb with lower wings in Astra's style. God mode adds a rotating
 * ring of carved glyphs, one orbiting satellite per commanded session, and
 * the Eye on her left wing; the sun (bring panels forward) is always on her
 * right wing. The orb itself is the slate's trigger, and the slate slot is
 * told which way to open: away from the nearer edge of the screen.
 */
const props = defineProps({
  godMode: Boolean,
  sessions: { type: Array, required: true },
  slateOpen: Boolean,
});
const emit = defineEmits(["open", "sun", "eye", "orb-hold", "orb-release", "orb-activate", "escape"]);

const FIELD = 440;
const CENTRE = FIELD / 2;
const WING_BASE = 150; // just outside the glyph ring's outer line
const wings = orbWings(CENTRE, CENTRE, WING_BASE);
const eyeAt = wingPoint(CENTRE, CENTRE, WING_BASE + 14, 0.42, -1);
const sunAt = wingPoint(CENTRE, CENTRE, WING_BASE + 14, 0.42, 1);

const RING_GLYPHS = ["working", "researching", "done", "background", "idle", "note", "waiting", "teardown"];
const ring = computed(() => [...RING_GLYPHS, ...RING_GLYPHS].map((name, i, all) => ({ name, angle: (360 / all.length) * i })));

const satellites = computed(() =>
  props.sessions.map((session, i) => ({
    ...session,
    angle: (360 / props.sessions.length) * i + 20,
    stateLabel: GLYPHS[session.state].label,
  })),
);

const summary = computed(() => {
  const count = (state) => props.sessions.filter((s) => s.state === state).length;
  return `Commanding ${props.sessions.length} sessions: ${count("working")} working, ${count("idle")} idle, ${count("waiting")} waiting on you.`;
});

const field = ref(null);
const orbButton = ref(null);
const slateSide = ref("to-left");

/** On the right half of the screen the slate opens to her left, and vice versa. */
function measureSide() {
  if (!field.value) return;
  const rect = field.value.getBoundingClientRect();
  slateSide.value = rect.left + rect.width / 2 > window.innerWidth / 2 ? "to-left" : "to-right";
}

let observer = null;
onMounted(() => {
  measureSide();
  window.addEventListener("resize", measureSide);
  observer = new ResizeObserver(measureSide);
  observer.observe(document.body);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", measureSide);
  observer?.disconnect();
});

/** Moves focus back to the orb without that focus re-opening the slate. */
let quietFocus = false;
function focusOrb() {
  quietFocus = true;
  orbButton.value?.focus();
  quietFocus = false;
}
defineExpose({ focusOrb, measureSide });

function onOrbFocus() {
  if (!quietFocus) emit("orb-hold", "focus");
}
</script>

<template>
  <div class="orb-stage">
    <div ref="field" class="orb-field">
      <Transition name="fade">
        <div v-if="godMode" class="glyph-ring" aria-hidden="true">
          <div class="ring-spin">
            <span
              v-for="(g, i) in ring"
              :key="i"
              class="ring-glyph"
              :style="{ transform: `rotate(${g.angle}deg) translateY(calc(-1 * var(--ring-r)))` }"
            >
              <Glyph :name="g.name" :size="16" />
            </span>
          </div>
        </div>
      </Transition>

      <svg class="orb-wings" :viewBox="`0 0 ${FIELD} ${FIELD}`" aria-hidden="true" focusable="false">
        <polygon v-for="(f, i) in wings.feathers" :key="'f' + i" :points="f.points" :fill="f.fill" />
        <polyline v-for="(l, i) in wings.lines" :key="'l' + i" :points="l.points" :stroke="l.stroke" fill="none" stroke-width="1.2" />
      </svg>

      <button
        ref="orbButton"
        type="button"
        class="mock-orb"
        aria-label="Astra: show the slate"
        :aria-expanded="slateOpen"
        aria-controls="slate"
        @mouseenter="emit('orb-hold', 'hover')"
        @mouseleave="emit('orb-release', 'hover')"
        @focus="onOrbFocus"
        @blur="emit('orb-release', 'focus')"
        @click="emit('orb-activate')"
        @keydown.esc.prevent="emit('escape')"
      ></button>

      <!-- The slate sits straight after the orb in tab order, so Tab walks from her into its glyphs. -->
      <slot name="slate" :side="slateSide" />

      <Transition name="fade">
        <button
          v-if="godMode"
          type="button"
          class="wing-btn eye"
          :style="{ left: eyeAt.x + 'px', top: eyeAt.y + 'px' }"
          :aria-label="`God mode is on. ${summary}`"
          @click="emit('eye')"
        >
          <Glyph name="waiting" :size="22" />
        </button>
      </Transition>
      <button
        type="button"
        class="wing-btn sun"
        :style="{ left: sunAt.x + 'px', top: sunAt.y + 'px' }"
        aria-label="Bring panels forward"
        @click="emit('sun')"
      >
        <Glyph name="sun" :size="22" />
      </button>

      <Transition name="fade">
        <ul v-if="godMode" class="satellites" aria-label="Commanded sessions">
          <li
            v-for="sat in satellites"
            :key="sat.id"
            class="orbit"
            :style="{ '--start': sat.angle + 'deg' }"
          >
            <div class="arm">
              <div class="upright">
                <button
                  type="button"
                  class="sat"
                  :class="sat.state"
                  :aria-label="`${sat.name}, ${sat.stateLabel.toLowerCase()}`"
                  @click="emit('open', sat)"
                >
                  <span class="dot"></span>
                </button>
                <span class="tip" aria-hidden="true">
                  {{ sat.name }} · {{ sat.stateLabel }}
                </span>
              </div>
            </div>
          </li>
        </ul>
      </Transition>
    </div>

    <p class="orb-caption">
      <span class="orb-name">Astra</span>
      <span v-if="godMode" class="god-on">God mode on. {{ summary }}</span>
      <span v-else>God mode off.</span>
    </p>
    <ul v-if="godMode" class="sat-key" aria-label="Satellite key">
      <li><span class="key-dot working" aria-hidden="true"></span>Bright pulse: working</li>
      <li><span class="key-dot idle" aria-hidden="true"></span>Dim: idle</li>
      <li><span class="key-dot waiting" aria-hidden="true"></span>Amber ring: waiting on you</li>
    </ul>
  </div>
</template>
