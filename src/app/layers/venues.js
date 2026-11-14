import { createVenuesLayer } from '../../layers/venues/index.js';
import { createOsmFeatureSource } from '../../sources/osmFeatures.js';
import {
  registerDynamicCredit,
  VENUES_CREDIT,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { overlayHost } from './overlayHost.js';

/** Wire the venues layer to the OSM feature route and the application overlay host. */
export function createApplicationVenues() {
  return createVenuesLayer({
    overlayHost,
    search: createOsmFeatureSource(),
    requestRender: governorRequestRender,
    onCredit: (viewer) => registerDynamicCredit(viewer, VENUES_CREDIT),
  });
}
