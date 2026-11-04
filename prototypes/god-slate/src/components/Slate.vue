<script setup>
import { computed, ref } from "vue";
import Glyph from "./Glyph.vue";
import { GLYPHS } from "../data/glyphs.js";

/**
 * The basalt slate, laid out like a trilingual stone: cartouches, a
 * plain-English line under each, and a detail band for the one you hover,
 * focus or select.
 */
const props = defineProps({ entries: { type: Array, required: true } });

const hoverId = ref(null);
const focusId = ref(null);
const pinnedId = ref(null);

const activeId = computed(() => hoverId.value ?? focusId.value ?? pinnedId.value);
const active = computed(() => props.entries.find((e) => e.id === activeId.value));

/** Click or Enter/Space pins a cartouche's detail; again unpins it. */
function togglePin(id) {
  pinnedId.value = pinnedId.value === id ? null : id;
}
</script>

<template>
  <section class="slate basalt" aria-labelledby="slate-title">
    <h2 id="slate-title" class="panel-title">The slate</h2>

    <TransitionGroup tag="ol" name="carve" class="band band-glyphs" aria-label="Sessions and loops">
      <li v-for="entry in entries" :key="entry.id" class="column" :class="{ fresh: entry.fresh }">
        <button
          type="button"
          class="cartouche"
          :class="{ pinned: pinnedId === entry.id }"
          :aria-pressed="pinnedId === entry.id"
          aria-controls="slate-detail"
          :aria-describedby="`line-${entry.id}`"
          @click="togglePin(entry.id)"
          @mouseenter="hoverId = entry.id"
          @mouseleave="hoverId = null"
          @focus="focusId = entry.id"
          @blur="focusId = null"
        >
          <Glyph :name="entry.glyph" carved :chisel="entry.fresh" :size="44" />
          <span class="cartouche-status">{{ GLYPHS[entry.glyph].label }}</span>
          <span class="cartouche-title">{{ entry.title }}</span>
        </button>
        <p :id="`line-${entry.id}`" class="plain-line">{{ entry.line }}</p>
      </li>
    </TransitionGroup>

    <div id="slate-detail" class="band band-detail" aria-live="polite">
      <template v-if="active">
        <p class="detail-head">
          <strong>{{ active.title }}</strong> · {{ GLYPHS[active.glyph].label }}
          <span v-if="pinnedId === active.id" class="pin-note">(pinned)</span>
        </p>
        <dl class="detail-list">
          <div><dt>Time</dt><dd>{{ active.time }}</dd></div>
          <div><dt>Last action</dt><dd>{{ active.lastAction }}</dd></div>
          <div><dt>Needs from you</dt><dd>{{ active.needs }}</dd></div>
        </dl>
      </template>
      <p v-else class="detail-hint">Hover, focus or select a cartouche to read its detail.</p>
    </div>
  </section>
</template>
