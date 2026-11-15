import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/**
 * UTILITIES ▸ Travel assist as its view renders it. The travel controller
 * (src/travel/controller.js) publishes the traveller's position, the
 * country's emergency contacts, the nearest places, the trip pins and the
 * clocks; the view's buttons and fields call its actions through act().
 */
export const useTravelStore = defineStore('gev-travel', () => {
  /** The controller's latest view object, or null before it presents. */
  const travel = shallowRef(null);

  /** @param {?object} next A fresh presentation; every publish re-renders. */
  function publish(next) {
    travel.value = next && markRaw(next);
  }

  const { connect, detach, act } = createOwners();

  return { travel, publish, connect, detach, act };
});
