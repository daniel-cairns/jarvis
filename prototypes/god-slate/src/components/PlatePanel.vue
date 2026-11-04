<script setup>
import Glyph from "./Glyph.vue";
import { GLYPHS } from "../data/glyphs.js";

/**
 * A simple stand-in for Astra's "On your plate" panel. With `skin` on it
 * takes the slate's basalt and carved glyph look.
 */
defineProps({
  entries: { type: Array, required: true },
  skin: Boolean,
});

const needsYou = (entry) => !/^nothing/i.test(entry.needs);
</script>

<template>
  <section class="plate" :class="{ basalt: skin }" aria-labelledby="plate-title">
    <h2 id="plate-title" class="panel-title">On your plate</h2>
    <TransitionGroup tag="ul" name="carve" class="plate-list">
      <li v-for="entry in entries" :key="entry.id" class="plate-row" :class="{ fresh: entry.fresh }">
        <Glyph v-if="skin" :name="entry.glyph" carved :chisel="entry.fresh" :size="32" />
        <span v-else class="plate-dot" :class="entry.glyph" aria-hidden="true"></span>
        <div class="plate-text">
          <p class="plate-title">
            {{ entry.title }} <span class="plate-status">{{ GLYPHS[entry.glyph].label }}</span>
          </p>
          <p class="plate-line">{{ entry.line }}</p>
          <p v-if="needsYou(entry)" class="plate-needs">Needs from you: {{ entry.needs }}</p>
        </div>
        <span class="plate-time">{{ entry.time }}</span>
      </li>
    </TransitionGroup>
  </section>
</template>
