/*
 * Offline support for Saphal's Dictionary.
 *
 * The whole book lives inside index.html, so caching that one page is enough to
 * make the app work with no connection at all.
 *
 * The page itself is fetched from the network first so that a new batch of words
 * appears as soon as it is published, and falls back to the cached copy when
 * there is no signal. Icons and the manifest rarely change, so they are served
 * from the cache first.
 *
 * This worker sits at the root of the site, so it is offered every request on
 * saphalism007.github.io - including ones belonging to other projects published
 * in subdirectories. It therefore has to be careful to touch only its own files:
 * see ownsPath below. Without that guard it would save a sibling project's page
 * as this app's index.html and hand that back the next time the dictionary was
 * opened offline.
 */
const PREFIX = "saphal-dictionary-";
const CACHE = PREFIX + "v9";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

/* True only for files that belong to the dictionary itself: the page at the
   root, anything under icons/, and root level files such as the manifest.
   A path with a directory of its own (/nepal-fs-compiler/...) is a different
   project sharing this origin and is left entirely alone. */
function ownsPath(pathname) {
  if (pathname === "/" || pathname === "/index.html") return true;
  const rest = pathname.slice(1);
  if (rest.startsWith("icons/")) return true;
  return rest.indexOf("/") === -1;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      /* Cache storage is shared across the whole origin, so only ever drop this
         app's own old versions. Deleting every other key would wipe the offline
         data of any sibling project published on this account. */
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((c) => c.postMessage({ type: "sd-updated" })))
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!ownsPath(url.pathname)) return;   // another project's file - do not intercept

  if (request.mode === "navigate") {
    // The host tells browsers to keep the page for ten minutes. Left alone that
    // means a fresh publish can take ten minutes to appear even though this is
    // asking the network for it. "no-store" skips that browser copy entirely so
    // an update shows the moment it is published.
    event.respondWith(
      fetch(request.url, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html").then((hit) => hit || caches.match("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
