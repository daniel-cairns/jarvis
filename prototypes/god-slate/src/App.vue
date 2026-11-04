<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import MockOrb from "./components/MockOrb.vue";
import Slate from "./components/Slate.vue";
import { ENTRIES, MOCK_EVENTS, SESSIONS } from "./data/mock.js";
import { GLYPHS } from "./data/glyphs.js";
import { playChime } from "./chime.js";

const godMode = ref(true);
const orbSide = ref("right");
const forceReduce = ref(false);
const systemReduce = ref(false);
const reduceMotion = computed(() => systemReduce.value || forceReduce.value);
const orb = ref(null);

const entries = ref(ENTRIES.map((e) => ({ ...e, fresh: false })));
let eventIndex = 0;
let nextId = 100;

const toast = ref("");
const announcement = ref("");
let toastTimer = null;

/** Shows a one-line toast, announced politely to screen readers. */
function showToast(message) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 3200);
}

/** Flips God mode, with the chime and a toast. */
function toggleGodMode() {
  godMode.value = !godMode.value;
  playChime(godMode.value);
  showToast(godMode.value ? "God mode on: Astra is commanding your sessions." : "God mode off: your sessions are your own again.");
}

// ── The slate: pops out, holds while hovered or focused, folds away. ──
const IDLE_MS = 6000; // untouched this long, it folds away
const GRACE_MS = 450; // lets the pointer or focus cross between orb and slate
const slateOpen = ref(false);
const holds = { orbHover: false, orbFocus: false, slateHover: false, slateFocus: false };
let idleTimer = null;
let graceTimer = null;

const held = () => Object.values(holds).some(Boolean);

/** Folds the slate away if nothing is holding it open. */
function closeIfFree() {
  if (!held()) closeSlate();
}

/** (Re)starts the idle countdown; it only closes the slate if nothing holds it then. */
function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(closeIfFree, IDLE_MS);
}

/** Pops the slate out (or keeps it out) and restarts the idle countdown. */
function openSlate() {
  slateOpen.value = true;
  orb.value?.measureSide();
  armIdle();
}

function closeSlate() {
  slateOpen.value = false;
  clearTimeout(idleTimer);
  clearTimeout(graceTimer);
  holds.slateHover = holds.slateFocus = false;
}

/** Pointer or focus arrives on the orb: open and hold. */
function onOrbHold(kind) {
  holds[kind === "hover" ? "orbHover" : "orbFocus"] = true;
  clearTimeout(graceTimer);
  openSlate();
}

/** Leaving the orb gives the usual six seconds, so there's time to reach the slate. */
function onOrbRelease(kind) {
  holds[kind === "hover" ? "orbHover" : "orbFocus"] = false;
  if (slateOpen.value) armIdle();
}

function onSlateHold(kind) {
  holds[kind === "hover" ? "slateHover" : "slateFocus"] = true;
  clearTimeout(graceTimer);
}

/** Leaving the slate folds it away, after a short grace for crossing back to the orb. */
function onSlateRelease(kind) {
  holds[kind === "hover" ? "slateHover" : "slateFocus"] = false;
  clearTimeout(graceTimer);
  graceTimer = setTimeout(closeIfFree, GRACE_MS);
}

/** Escape folds the slate away; if focus was on the orb or in the slate, it returns to the orb. */
function escapeSlate() {
  if (!slateOpen.value) return;
  const active = document.activeElement;
  const fromSlate = active?.closest?.("#slate") || active?.classList?.contains("mock-orb");
  closeSlate();
  holds.orbFocus = false;
  if (fromSlate) {
    orb.value?.focusOrb();
    holds.orbFocus = true; // focus is on the orb again, just without re-opening
  }
}

/** Moves the mock orb, then re-measures which way the slate should open. */
async function placeOrb(side) {
  orbSide.value = side;
  await nextTick();
  orb.value?.measureSide();
}

/** Chisels a new mock cartouche onto the slate and pops it out. */
function addMockEvent() {
  const template = MOCK_EVENTS[eventIndex++ % MOCK_EVENTS.length];
  const id = `n${nextId++}`;
  const time = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit", hour12: false });
  entries.value = [{ ...template, id, time, fresh: true }, ...entries.value].slice(0, 10);
  announcement.value = `New on the slate: ${GLYPHS[template.glyph].label}, ${template.title}. ${template.line}.`;
  openSlate();
  setTimeout(() => {
    const entry = entries.value.find((e) => e.id === id);
    if (entry) entry.fresh = false;
  }, 6000);
}

function onDocumentKeydown(event) {
  if (event.key === "Escape") escapeSlate();
}

let media = null;
const syncReduce = () => (systemReduce.value = media.matches);
onMounted(() => {
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  syncReduce();
  media.addEventListener("change", syncReduce);
  document.addEventListener("keydown", onDocumentKeydown);
});
onBeforeUnmount(() => {
  media?.removeEventListener("change", syncReduce);
  document.removeEventListener("keydown", onDocumentKeydown);
  clearTimeout(idleTimer);
  clearTimeout(graceTimer);
});
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
      <p class="intro">
        Prototype with mock data. Hover or focus the orb, or add a mock event, and the slate unfolds from her;
        it folds away six seconds after you leave it alone, when you move off it, or on Escape.
      </p>
    </header>

    <section class="controls" aria-label="Prototype controls">
      <button type="button" class="god-toggle" :aria-pressed="godMode" @click="toggleGodMode">
        God mode: <strong>{{ godMode ? "On" : "Off" }}</strong>
      </button>

      <fieldset>
        <legend>Orb position</legend>
        <label><input :checked="orbSide === 'left'" type="radio" name="orb-side" value="left" @change="placeOrb('left')" /> Left of the screen</label>
        <label><input :checked="orbSide === 'right'" type="radio" name="orb-side" value="right" @change="placeOrb('right')" /> Right of the screen</label>
      </fieldset>

      <fieldset>
        <legend>Motion</legend>
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

    <main class="stage" :class="`orb-${orbSide}`">
      <MockOrb
        ref="orb"
        :god-mode="godMode"
        :sessions="SESSIONS"
        :slate-open="slateOpen"
        @open="(s) => showToast(`Opening ${s.name}…`)"
        @sun="showToast('Sun glyph: bringing Astra\'s panels forward (mock).')"
        @eye="showToast(`God mode is on, commanding ${SESSIONS.length} sessions.`)"
        @orb-hold="onOrbHold"
        @orb-release="onOrbRelease"
        @orb-activate="openSlate"
        @escape="escapeSlate"
      >
        <template #slate="{ side }">
          <Slate
            :entries="entries"
            :open="slateOpen"
            :side="side"
            :reduce-motion="reduceMotion"
            @hold="onSlateHold"
            @release="onSlateRelease"
            @escape="escapeSlate"
          />
        </template>
      </MockOrb>
    </main>

    <p class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</p>
    <div class="toast-region" role="status" aria-live="polite">
      <Transition name="fade">
        <p v-if="toast" class="toast">{{ toast }}</p>
      </Transition>
    </div>
  </div>
</template>
