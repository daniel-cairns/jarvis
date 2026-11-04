<script setup>
import { computed } from "vue";
import Glyph from "./Glyph.vue";
import { GLYPHS } from "../data/glyphs.js";

/**
 * A stand-in orb with the God mode indicator: a rotating ring of carved
 * glyphs, one orbiting satellite per commanded session, and the Eye
 * placed in or beside the sun glyph's slot.
 */
const props = defineProps({
  godMode: Boolean,
  sessions: { type: Array, required: true },
  eyeMode: { type: String, default: "replace" }, // "replace" | "beside"
});
const emit = defineEmits(["open", "sun", "eye"]);

const RING_GLYPHS = ["working", "researching", "done", "background", "idle", "note", "waiting", "teardown"];
const ring = computed(() => [...RING_GLYPHS, ...RING_GLYPHS].map((name, i, all) => ({ name, angle: (360 / all.length) * i })));

const satellites = computed(() =>
  props.sessions.map((session, i) => ({
    ...session,
    angle: (360 / props.sessions.length) * i + 20,
    stateLabel: GLYPHS[session.state].label,
  })),
);

const showSun = computed(() => !props.godMode || props.eyeMode === "beside");

const summary = computed(() => {
  const count = (state) => props.sessions.filter((s) => s.state === state).length;
  return `Commanding ${props.sessions.length} sessions: ${count("working")} working, ${count("idle")} idle, ${count("waiting")} waiting on you.`;
});
</script>

<template>
  <div class="orb-stage">
    <div class="orb-field">
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

      <div class="mock-orb" aria-hidden="true"></div>

      <div class="orb-glyph-slot">
        <button
          v-if="showSun"
          type="button"
          class="slot-btn"
          aria-label="Sun glyph (mock)"
          @click="emit('sun')"
        >
          <Glyph name="sun" :size="22" />
        </button>
        <Transition name="fade">
          <button
            v-if="godMode"
            type="button"
            class="slot-btn eye"
            :aria-label="`God mode is on. ${summary}`"
            @click="emit('eye')"
          >
            <Glyph name="waiting" :size="24" />
          </button>
        </Transition>
      </div>

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
