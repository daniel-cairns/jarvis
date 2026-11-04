<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import MockOrb from "./components/MockOrb.vue";
import Slate from "./components/Slate.vue";
import PlatePanel from "./components/PlatePanel.vue";
import { ENTRIES, MOCK_EVENTS, SESSIONS } from "./data/mock.js";
import { playChime } from "./chime.js";

const godMode = ref(true);
const eyeMode = ref("replace");
const slateMode = ref("own");
const chimeOn = ref(true);
const forceReduce = ref(false);
const systemReduce = ref(false);
const reduceMotion = computed(() => systemReduce.value || forceReduce.value);

const entries = ref(ENTRIES.map((e) => ({ ...e, fresh: false })));
let eventIndex = 0;
let nextId = 100;

const toast = ref("");
let toastTimer = null;

/** Shows a one-line toast, announced politely to screen readers. */
function showToast(message) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 3200);
}

/** Flips God mode, with the optional chime and a toast. */
function toggleGodMode() {
  godMode.value = !godMode.value;
  if (chimeOn.value) playChime(godMode.value);
  showToast(godMode.value ? "God mode on: Astra is commanding your sessions." : "God mode off: your sessions are your own again.");
}

/** Chisels a new mock cartouche onto the slate (and the plate). */
function addMockEvent() {
  const template = MOCK_EVENTS[eventIndex++ % MOCK_EVENTS.length];
  const id = `n${nextId++}`;
  const time = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit", hour12: false });
  entries.value = [{ ...template, id, time, fresh: true }, ...entries.value].slice(0, 10);
  setTimeout(() => {
    const entry = entries.value.find((e) => e.id === id);
    if (entry) entry.fresh = false;
  }, 6000);
}

let media = null;
const syncReduce = () => (systemReduce.value = media.matches);
onMounted(() => {
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  syncReduce();
  media.addEventListener("change", syncReduce);
});
onBeforeUnmount(() => media?.removeEventListener("change", syncReduce));
</script>

<template>
  <!-- Shared gold-leaf gradient for every glyph on the page. -->
  <svg class="svg-defs" aria-hidden="true" focusable="false" width="0" height="0">
    <defs>
      <linearGradient id="gold-leaf" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="48" y2="48">
        <stop offset="0" stop-color="#f8de94" />
        <stop offset="0.45" stop-color="#ecbc52" />
        <stop offset="0.75" stop-color="#d4a443" />
        <stop offset="1" stop-color="#f1cd72" />
      </linearGradient>
    </defs>
  </svg>

  <div class="app" :class="{ 'reduce-motion': reduceMotion }">
    <header class="app-header">
      <h1>Astra: God mode and glyph slate</h1>
      <p class="intro">Prototype with mock data. Use the controls to compare Dan's three open questions live.</p>
    </header>

    <section class="controls" aria-label="Prototype controls">
      <button type="button" class="god-toggle" :aria-pressed="godMode" @click="toggleGodMode">
        God mode: <strong>{{ godMode ? "On" : "Off" }}</strong>
      </button>

      <fieldset>
        <legend>1. The Eye</legend>
        <label><input v-model="eyeMode" type="radio" name="eye" value="replace" /> Replaces the sun</label>
        <label><input v-model="eyeMode" type="radio" name="eye" value="beside" /> Sits beside the sun</label>
      </fieldset>

      <fieldset>
        <legend>2. The slate</legend>
        <label><input v-model="slateMode" type="radio" name="slate" value="own" /> Its own panel</label>
        <label><input v-model="slateMode" type="radio" name="slate" value="skin" /> Skin for "On your plate"</label>
      </fieldset>

      <fieldset>
        <legend>3. Sound and motion</legend>
        <label><input v-model="chimeOn" type="checkbox" /> Chime on toggle</label>
        <label>
          <input
            type="checkbox"
            :checked="reduceMotion"
            :disabled="systemReduce"
            @change="forceReduce = $event.target.checked"
          />
          Reduce motion
          <span v-if="systemReduce" class="hint">(your system already asks for this)</span>
        </label>
      </fieldset>

      <button type="button" class="add-event" @click="addMockEvent">Add a mock event</button>
    </section>

    <main class="stage">
      <MockOrb
        :god-mode="godMode"
        :sessions="SESSIONS"
        :eye-mode="eyeMode"
        @open="(s) => showToast(`Opening ${s.name}…`)"
        @sun="showToast('Sun glyph: Astra\'s usual status (mock).')"
        @eye="showToast(`God mode is on, commanding ${SESSIONS.length} sessions.`)"
      />

      <div class="panels">
        <Slate v-if="slateMode === 'own'" :entries="entries" />
        <PlatePanel :entries="entries" :skin="slateMode === 'skin'" />
      </div>
    </main>

    <div class="toast-region" role="status" aria-live="polite">
      <Transition name="fade">
        <p v-if="toast" class="toast">{{ toast }}</p>
      </Transition>
    </div>
  </div>
</template>
