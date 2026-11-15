<script setup>
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, ref } from 'vue';
import { t, getLocale } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import { useTravelStore } from '../../stores/travel.js';
import {
  offsetDifferenceText,
  zoneCity,
  zoneClock,
} from '../../../travel/model.js';

// UTILITIES ▸ Travel assist: the traveller's position from a pasted link, the
// country's emergency contacts, the nearest help with a walking route, the
// trip's pinned places and the clocks. The travel controller publishes what
// these show and answers them through the travel store.
const store = useTravelStore();
const { travel } = storeToRefs(store);
const act = (name, ...args) => store.act(name, ...args);

const open = ref(true);
const locationText = ref('');
const pinName = ref('');
const pinText = ref('');
const zoneText = ref('');

// The clocks read the time themselves, a few times a minute.
const tick = ref(Date.now());
const timer = setInterval(() => (tick.value = Date.now()), 15_000);
// A page that never unmounts this view must still be able to exit (tests).
timer?.unref?.();
onBeforeUnmount(() => clearInterval(timer));

const CATEGORY_LABELS = {
  police: () => t('Police'),
  hospital: () => t('Hospital'),
  pharmacy: () => t('Pharmacy'),
  taiwanOffice: () => t('Taiwan office'),
  bank: () => t('Bank'),
  atm: () => t('Cash machine'),
  station: () => t('Station or terminal'),
  water: () => t('Drinking water'),
  toilets: () => t('Toilets'),
  library: () => t('Public library'),
};
const NUMBER_LABELS = {
  // The force you call, not the station on the map (the layer's "Police").
  police: () => t('Police', { context: 'phone' }),
  ambulance: () => t('Ambulance'),
  fire: () => t('Fire brigade'),
  nonEmergencyPolice: () => t('Police, not urgent'),
  touristPolice: () => t('Tourist police'),
  nationalPolice: () => t('National police'),
  travelHotline: () => t('Travel hotline'),
  nonEmergencyHealth: () => t('Health advice, not urgent'),
  mobile: () => t('From a mobile phone'),
};

function countryName(code) {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(code);
  } catch {
    return code;
  }
}

const location = computed(() => travel.value?.location ?? null);
const status = computed(() => travel.value?.status ?? null);
const busy = computed(() => status.value?.kind === 'busy');
const emergency = computed(() => travel.value?.emergency ?? null);
const countryCode = computed(() => travel.value?.countryCode ?? '');
const countryOptions = computed(() =>
  (travel.value?.countryOptions ?? [])
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, getLocale())),
);
const placeLine = computed(() =>
  [location.value?.near, location.value?.division, location.value?.country]
    .filter(Boolean)
    .join(' · '),
);
const setTime = computed(() =>
  location.value
    ? new Date(location.value.setAt).toLocaleTimeString(getLocale(), {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '',
);
const numbers = computed(() => {
  const card = emergency.value;
  if (!card) return [];
  const main =
    card.police === card.ambulance && card.police === card.fire
      ? [{ label: t('Police, ambulance, fire'), number: card.police }]
      : [
          { label: NUMBER_LABELS.police(), number: card.police },
          { label: NUMBER_LABELS.ambulance(), number: card.ambulance },
          { label: NUMBER_LABELS.fire(), number: card.fire },
        ];
  return [
    ...main,
    ...card.other.map((entry) => ({
      label: NUMBER_LABELS[entry.type]?.() ?? entry.type,
      number: entry.number,
    })),
  ];
});
const groups = computed(() =>
  (travel.value?.nearby.groups ?? []).map((group) => ({
    ...group,
    label: CATEGORY_LABELS[group.category]?.() ?? group.category,
    empty: group.items.length === 0,
  })),
);
const nearbyState = computed(() => travel.value?.nearby.state ?? 'none');
const pins = computed(() => travel.value?.pins ?? []);
const clocks = computed(() => {
  const home = zoneClock(travel.value?.homeZone, tick.value);
  return (travel.value?.clocks ?? []).map((entry) => {
    const clock = zoneClock(entry.zone, tick.value);
    return {
      ...entry,
      city: zoneCity(entry.zone),
      time: clock?.time ?? '--:--',
      date: clock?.date ?? '',
      night: clock?.night === true,
      difference:
        clock && home
          ? offsetDifferenceText(clock.offsetMinutes, home.offsetMinutes)
          : '',
    };
  });
});
const zoneOptions = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
})();

async function setLocation() {
  if (!locationText.value.trim() || busy.value) return;
  if (await act('setTravelLocation', locationText.value)) locationText.value = '';
}
async function addPin() {
  if (!pinText.value.trim() || busy.value) return;
  if (await act('addTravelPin', pinName.value, pinText.value)) {
    pinName.value = '';
    pinText.value = '';
  }
}
function addClock() {
  if (!zoneText.value.trim()) return;
  act('addTravelClock', zoneText.value.trim());
  zoneText.value = '';
}
</script>

<template>
  <div class="pp-toggle-group travel-assist" id="travel-group">
    <UiButton class="pp-toggle-btn" :pressed="open" pressed-class="active" id="travel-toggle" @click="open = !open" :title="t('Help a traveller from here: where they are, who to call, the nearest help and how to walk there')">
      <span class="pp-icon material-symbols-outlined" aria-hidden="true">travel_explore</span>
      <span class="pp-label">{{ t('Travel assist') }}</span>
    </UiButton>
    <div v-show="open" class="travel-body">
      <section class="travel-section" :aria-label="t('Traveller location')">
        <h4 class="travel-heading">{{ t('Traveller location') }}</h4>
        <form class="travel-row" @submit.prevent="setLocation">
          <input class="gev-field travel-input" id="travel-location-input" type="text" autocomplete="off" spellcheck="false" v-model="locationText" :placeholder="t('Paste a map link or coordinates')" :aria-label="t('Paste a map link or coordinates')" />
          <button class="gev-action-button gev-action-button--compact" id="travel-location-set" type="submit" :disabled="busy">{{ t('SET') }}</button>
        </form>
        <p v-if="status" class="travel-status" :class="`travel-status--${status.kind}`" role="status">{{ t(status.text) }}</p>
        <div v-if="location" class="travel-location" id="travel-location">
          <p class="travel-coords">★ {{ location.coords }}</p>
          <p v-if="placeLine" class="travel-place">{{ placeLine }}</p>
          <p class="travel-note">{{ t('Set at {time}', { time: setTime }) }}</p>
          <div class="travel-row">
            <button class="gev-action-button gev-action-button--compact" type="button" @click="act('flyToTraveller')">{{ t('SHOW') }}</button>
            <button class="gev-action-button gev-action-button--compact gev-action-button--danger" type="button" @click="act('clearTravelLocation')">{{ t('REMOVE') }}</button>
          </div>
        </div>
        <p v-else class="travel-note">{{ t('No location yet. Ask the traveller to share their position from a map app.') }}</p>
      </section>

      <section class="travel-section" :aria-label="t('Emergency contacts')">
        <h4 class="travel-heading">{{ t('Emergency contacts') }}</h4>
        <label class="travel-row travel-country">
          <span class="travel-note">{{ t('Country or region') }}</span>
          <select class="gev-field" id="travel-country" :value="countryCode" @change="act('setTravelCountry', $event.target.value)">
            <option value="">{{ t('Follow the traveller') }}</option>
            <option v-for="option in countryOptions" :key="option.code" :value="option.code">{{ option.name }}</option>
          </select>
        </label>
        <template v-if="emergency">
          <dl class="travel-numbers" id="travel-numbers">
            <template v-for="row in numbers" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.number }}</dd>
            </template>
          </dl>
          <h5 class="travel-subheading">{{ t('Taiwan emergency hotline') }}</h5>
          <template v-if="emergency.hotline">
            <p class="travel-number">{{ emergency.hotline.dial }}</p>
            <p class="travel-note" lang="zh-Hant">{{ emergency.hotline.note }}</p>
          </template>
          <p v-else class="travel-note">{{ t('The toll-free line {number} does not work from this country.', { number: emergency.hotlineNumber }) }}</p>
          <p class="travel-number">{{ emergency.centre }}</p>
          <p class="travel-note">{{ t('Emergency centre in Taiwan, open all hours; the caller pays.') }}</p>
          <h5 class="travel-subheading">{{ t('Taiwan offices in this country') }}</h5>
          <details v-for="office in emergency.offices" :key="office.nameEn" class="travel-office">
            <summary>{{ office.city }} · <span lang="zh-Hant">{{ office.nameZh }}</span></summary>
            <p class="travel-note">{{ office.nameEn }}</p>
            <p class="travel-note">{{ office.address }}</p>
            <p v-if="office.addressZh" class="travel-note" lang="zh-Hant">{{ office.addressZh }}</p>
            <dl class="travel-numbers">
              <dt>{{ t('Office') }}</dt>
              <dd>{{ office.phone }}</dd>
              <dt>{{ t('Emergency') }}</dt>
              <dd>{{ office.emergencyPhone }}</dd>
            </dl>
          </details>
          <p v-if="emergency.offices.length === 0" class="travel-note">{{ t('No Taiwan office is listed for this country.') }}</p>
          <p class="travel-note travel-source">{{ t('Checked {date} against Wikipedia and Taiwan’s Bureau of Consular Affairs. Confirm before travelling.', { date: emergency.checkedOn }) }}</p>
        </template>
        <template v-else>
          <p class="travel-note">{{ countryCode ? t('No checked numbers for this country yet.') : t('Set a location or choose a country.') }}</p>
          <p class="travel-number">{{ travel?.centre }}</p>
          <p class="travel-note">{{ t('Emergency centre in Taiwan, open all hours; the caller pays.') }}</p>
        </template>
      </section>

      <section v-if="location" class="travel-section" :aria-label="t('Nearest help')">
        <h4 class="travel-heading">{{ t('Nearest help') }}</h4>
        <p v-if="nearbyState === 'loading'" class="travel-status travel-status--busy" role="status">{{ t('Looking around the traveller…') }}</p>
        <p v-else-if="nearbyState === 'error'" class="travel-status travel-status--error" role="status">{{ t('Nearby places could not be loaded') }}</p>
        <ul v-else class="travel-list" id="travel-nearby">
          <li v-for="group in groups" :key="group.category" class="travel-group" :data-category="group.category">
            <span class="travel-group-label">{{ group.label }}</span>
            <span v-if="group.empty" class="travel-note">{{ t('None within {distance}', { distance: travel.nearby.radius }) }}</span>
            <div v-for="item in group.items" :key="item.id" class="travel-item">
              <span class="travel-item-name">{{ item.name || group.label }}</span>
              <span class="travel-item-meta">{{ item.arrow }} {{ item.distance }} · {{ t('about {minutes} min on foot', { minutes: item.walkMinutes }) }}</span>
              <span class="travel-row">
                <button class="gev-action-button gev-action-button--compact" type="button" @click="act('routeToTravelPlace', item.id)" :title="t('Draw the walking route from the traveller')">{{ t('WALK') }}</button>
                <button class="gev-action-button gev-action-button--compact" type="button" @click="act('flyToTravelPlace', item.id)">{{ t('SHOW') }}</button>
              </span>
            </div>
          </li>
        </ul>
      </section>

      <section class="travel-section" :aria-label="t('Trip places')">
        <h4 class="travel-heading">{{ t('Trip places') }}</h4>
        <form class="travel-pin-form" @submit.prevent="addPin">
          <input class="gev-field travel-input" type="text" autocomplete="off" maxlength="60" v-model="pinName" :placeholder="t('Name, such as the hotel')" :aria-label="t('Name, such as the hotel')" />
          <span class="travel-row">
            <input class="gev-field travel-input" type="text" autocomplete="off" spellcheck="false" v-model="pinText" :placeholder="t('Paste a map link or coordinates')" :aria-label="t('Paste a map link or coordinates')" />
            <button class="gev-action-button gev-action-button--compact" type="submit" :disabled="busy">{{ t('ADD') }}</button>
          </span>
        </form>
        <ul class="travel-list" id="travel-pins">
          <li v-for="pin in pins" :key="pin.id" class="travel-item">
            <span class="travel-item-name">{{ pin.name }}</span>
            <span class="travel-item-meta">{{ pin.distance ? `${pin.arrow} ${pin.distance}` : pin.coords }}<template v-if="pin.walkMinutes"> · {{ t('about {minutes} min on foot', { minutes: pin.walkMinutes }) }}</template></span>
            <span class="travel-row">
              <button v-if="location" class="gev-action-button gev-action-button--compact" type="button" @click="act('routeToTravelPlace', `pin:${pin.id}`)" :title="t('Draw the walking route from the traveller')">{{ t('WALK') }}</button>
              <button class="gev-action-button gev-action-button--compact" type="button" @click="act('flyToTravelPlace', `pin:${pin.id}`)">{{ t('SHOW') }}</button>
              <button class="gev-action-button gev-action-button--compact gev-action-button--danger" type="button" @click="act('removeTravelPin', pin.id)">{{ t('REMOVE') }}</button>
            </span>
          </li>
        </ul>
      </section>

      <section class="travel-section" :aria-label="t('Clocks')">
        <h4 class="travel-heading">{{ t('Clocks') }}</h4>
        <ul class="travel-list travel-clocks" id="travel-clocks">
          <li v-for="clock in clocks" :key="clock.zone" class="travel-clock" :class="{ 'travel-clock--traveller': clock.traveller }">
            <span class="travel-clock-city">{{ clock.traveller ? '★ ' : '' }}{{ clock.city }}</span>
            <span class="travel-clock-time">{{ clock.night ? '☾' : '☀' }} {{ clock.time }}</span>
            <span class="travel-item-meta">{{ clock.date }} · {{ clock.difference }}</span>
            <button v-if="!clock.auto" class="gev-action-button gev-action-button--compact gev-action-button--danger" type="button" @click="act('removeTravelClock', clock.zone)" :aria-label="t('Remove {name}', { name: clock.city })">×</button>
          </li>
        </ul>
        <form class="travel-row" @submit.prevent="addClock">
          <input class="gev-field travel-input" type="text" list="travel-zone-options" autocomplete="off" spellcheck="false" v-model="zoneText" :placeholder="t('Add a time zone, such as Asia/Tokyo')" :aria-label="t('Add a time zone, such as Asia/Tokyo')" />
          <datalist id="travel-zone-options"><option v-for="zone in zoneOptions" :key="zone" :value="zone"></option></datalist>
          <button class="gev-action-button gev-action-button--compact" type="submit">{{ t('ADD') }}</button>
        </form>
      </section>
    </div>
  </div>
</template>
