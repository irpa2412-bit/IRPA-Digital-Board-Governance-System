/* IRPA-DBGS offline shell only. Never cache API, authentication, PDF or signature traffic. */
const BASE_URL = new URL("./", self.registration.scope);
const basePath = BASE_URL.pathname;
const resource = (path) => new URL(path, BASE_URL).pathname;
const CACHE_NAME = "irpa-dbgs-shell-v1-" + basePath.replace(/[^a-z0-9]/gi, "_");
const OFFLINE_URL = resource("offline.html");
const APP_SHELL = [
  resource("./"),
  resource("index.html"),
  OFFLINE_URL,
  resource("manifest.webmanifest"),
  resource("install.js"),
  resource("icons/irpa-192.svg"),
  resource("icons/irpa-512.svg"),
  resource("icons/irpa-maskable.svg")
];

function excluded(url) {
  const p = url.pathname.toLowerCase();
  return p.includes("/api/") || p.includes("/worker/") ||
    p.includes("auth") || p.includes("sign") || p.includes("signature") ||
    p.endsWith(".pdf") || p.includes("/pdf/") || p.includes("token");
}
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("irpa-dbgs-shell-v1-") && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(basePath) || excluded(url)) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || (await caches.match(req, {ignoreSearch:true})) || Response.error()));
    return;
  }
  // Only explicitly listed shell resources and hashed static build assets are cacheable.
  const shell = APP_SHELL.includes(url.pathname) || url.pathname.startsWith(resource("assets/"));
  if (!shell) return;
  event.respondWith((async () => {
    const cached = await caches.match(req);
    try {
      const response = await fetch(req);
      if (response.ok && response.type === "basic" && !excluded(url)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(req, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return cached || Response.error();
    }
  })());
});
