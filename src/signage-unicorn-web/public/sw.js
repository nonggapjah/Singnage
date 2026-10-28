// Signage Unicorn app-shell service worker.
//
// v3 (27-10-2026):
//  - API responses are NEVER cached. Every successful GET under /api/ used to be stored in the
//    shell cache (authenticated inventory, logs, user lists) and could be served to a later
//    session of a different user during a network failure.
//  - Activation only deletes OLD versions of this worker's own cache (unicorn-player-*). The web
//    player keeps its downloaded media in 'signage-media-v1', which a worker update used to wipe.
//  - Responses to requests carrying credentials (Authorization / X-Device-Token) are never cached.
const CACHE_PREFIX = 'unicorn-player-';
const CACHE_NAME = CACHE_PREFIX + 'v3';
const ASSETS_TO_CACHE = [
    '/',
    '/player',
    '/manifest.json',
    '/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
            .catch((err) => console.warn('SW: app-shell pre-cache incomplete', err))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys
                .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                .map((key) => caches.delete(key))
        ))
    );
    self.clients.claim();
});

// Only same-origin, credential-free, static app-shell requests are eligible for the cache.
function isCacheable(request, url) {
    if (request.method !== 'GET') return false;
    if (url.origin !== self.location.origin) return false;
    if (url.pathname.startsWith('/api/')) return false;         // live data: network only
    if (url.pathname.startsWith('/media/')) return false;       // the player caches media itself
    if (url.pathname.startsWith('/screenshots/')) return false; // served by the API now; never public
    if (request.headers.has('authorization') || request.headers.has('x-device-token')) return false;
    return true;
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }

    // Not cacheable: do not call respondWith, so the browser performs a plain network request
    // (no stale fallback for API data).
    if (!isCacheable(request, url)) return;

    // Static assets / app shell: stale-while-revalidate for fast loads and offline support.
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            const fetchPromise = fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const cacheCopy = networkResponse.clone();
                    caches.open(CACHE_NAME)
                        .then((cache) => cache.put(request, cacheCopy))
                        .catch(() => undefined);
                }
                return networkResponse;
            }).catch(() => undefined);

            return cachedResponse || fetchPromise.then((res) => res || Response.error());
        })
    );
});
