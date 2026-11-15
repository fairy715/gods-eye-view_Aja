import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { admitSameSite } from './common/same-site.js';
import { providerUserAgent } from './common/userAgent.js';

const USER_AGENT = providerUserAgent('travel');
const MAX_HOPS = 5;
const TIMEOUT_MS = 10_000;
/** Bytes of a landing page read when its URL carries no position. */
const MAX_PAGE_BYTES = 512 * 1024;

/** The short links a phone's Google Maps "share" produces. */
function isShortMapLink(url) {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.port &&
    (url.hostname === 'maps.app.goo.gl' ||
      (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/')))
  );
}

/** Where such a link may lead: Google's own hosts only, over https. */
function isGoogleHost(url) {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.port &&
    /(^|\.)(google\.[a-z.]{2,6}|goo\.gl|app\.goo\.gl)$/.test(url.hostname)
  );
}

/**
 * Follow a Google Maps short link and report every URL on the way, so the
 * browser can read the position out of them. It follows redirects by hand,
 * only between Google hosts, and never returns page content.
 * @param {string} link
 * @param {{fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<string[]>} The URLs visited, the short link first.
 */
export async function resolveMapLink(
  link,
  { fetchImpl = (...args) => globalThis.fetch(...args) } = {},
) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw Object.assign(new Error('bad_link'), { status: 400 });
  }
  if (!isShortMapLink(url))
    throw Object.assign(new Error('unsupported_link'), { status: 400 });
  const urls = [url.href];
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      let next;
      try {
        next = new URL(location, url);
      } catch {
        break;
      }
      if (!isGoogleHost(next)) break;
      url = next;
      urls.push(url.href);
      continue;
    }
    // A place link may end on a page whose URL has no position; the page
    // then names the map it draws (`center=lat%2Clon`, `/@lat,lon`).
    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (size < MAX_PAGE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
      await reader.cancel().catch(() => {});
      const page = Buffer.concat(chunks).toString('latin1');
      const found =
        /center=(-?\d{1,3}\.\d+)%2C(-?\d{1,3}\.\d+)/.exec(page) ||
        /\/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(page);
      if (found) urls.push(`geo:${found[1]},${found[2]}`);
    } else {
      await response.body?.cancel();
    }
    break;
  }
  return urls;
}

/**
 * `GET /api/travel/resolve?url=` — follow a Google Maps short link for the
 * travel panel. Same-site only: the route makes outbound requests.
 * @param {{fetchImpl?: typeof fetch}} [options]
 */
export function travelProxy({ fetchImpl } = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 20, globalMax: 120 });

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    if (admitSameSite(req, res)) return undefined;
    const request = new URL(req.url || '/', 'http://localhost');
    if (request.pathname !== '/resolve')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      const urls = await resolveMapLink(
        request.searchParams.get('url') || '',
        fetchImpl ? { fetchImpl } : {},
      );
      return json(200, { urls });
    } catch (error) {
      return json(error?.status === 400 ? 400 : 502, {
        error: error?.status === 400 ? error.message : 'link_unavailable',
      });
    }
  }

  return {
    name: 'travel',
    configureServer({ middlewares }) {
      middlewares.use('/api/travel', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/travel', handler);
    },
  };
}
