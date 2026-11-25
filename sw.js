// Lets Rose's Moons open anywhere, even with no signal.
// - The lock page's own files (this folder) are kept offline; a newer copy is fetched in the background,
//   so an update appears the next time the game is opened.
// - The game's files under app/ were unscrambled on this device by unlock.js and live only in this
//   device's offline storage; they are never fetched from the web. If they are missing, the lock page opens.
// Only this page's own storage is touched (StrikeRX on the same site keeps its own).
const SHELL_CACHE = "rosesmoons-shell-20261125200009";
const APP_CACHE = "rosesmoons-app";
const SHELL = ["./", "index.html", "unlock.js", "app.enc", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("rosesmoons-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (url.pathname.startsWith(scope.pathname + "app/")) {
    event.respondWith(caches.open(APP_CACHE).then((c) => c.match(url.origin + url.pathname)).then((hit) => {
      if (hit) return hit;
      return req.mode === "navigate" ? Response.redirect(scope.href, 302) : new Response("", { status: 404 });
    }));
    return;
  }
  event.respondWith(caches.open(SHELL_CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    // "no-cache" asks the server every time; an unchanged file comes back as a tiny "not modified".
    const fresh = fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || fresh;
  }));
});
