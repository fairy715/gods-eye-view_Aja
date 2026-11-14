import { createVenuesLayer } from '../../layers/venues/index.js';
import { createOpenFreeMapVenueSource } from '../../sources/openFreeMapVenues.js';
import {
  registerDynamicCredit,
  VENUES_CREDIT,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { overlayHost } from './overlayHost.js';

/** Wire the venues layer to OpenFreeMap tiles and the application overlay host. */
export function createApplicationVenues() {
  return createVenuesLayer({
    overlayHost,
    source: createOpenFreeMapVenueSource(),
    requestRender: governorRequestRender,
    onCredit: (viewer) => registerDynamicCredit(viewer, VENUES_CREDIT),
  });
}
