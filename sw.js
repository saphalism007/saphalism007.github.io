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
const CACHE = PREFIX + "v10";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

/* True only for files that belong to the dictionary itself: the page at the
   root, anything under icons/, and root level files such as the manifest.
   A path with a directory of its own (/nepal-fs-compiler/...) is a different
   project sharing this origin and is left entirely alone. */
function ownsPath(pathname) {
  if (pathname === "/" || pathname === "/index.html") return true;
  const rest = pathname.slice(1);
  if (rest.startsWith("icons/")) return true;
  /* A root level name with no dot, such as /saphal-music without its closing
     slash, is a sibling project's folder that GitHub is about to redirect.
     Claiming it would store that project's page as the dictionary. */
  return rest.indexOf("/") === -1 && rest.indexOf(".") !== -1;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // no-store, so the copy kept is the one on GitHub now and not one the
      // browser was told to hold on to for ten minutes.
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "no-store" }))))
      .then(() => self.skipWaiting())
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
      // No message to open pages any more. It used to tell them to reload,
      // so every update ran the opening twice, and on a phone with updates
      // going out several times a day that was most openings.
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!ownsPath(url.pathname)) return;   // another project's file - do not intercept

  if (request.mode === "navigate") {
    // The copy on this device opens at once, with no wait for the network.
    //
    // It used to be the other way round: the page was fetched from GitHub on
    // every opening and the copy here only used with no signal at all. The
    // whole book is in that one page, about 800 KB, so on a phone that was a
    // wait of seconds every time, and longer on a weak signal, because a slow
    // connection is not a failed one and the copy here was never reached for.
    //
    // A fresh copy is fetched behind the one on screen (no-store skips the ten
    // minutes GitHub asks browsers to keep it) and saved for the next opening.
    // So a new batch of words shows the time after it is published, never
    // half way through using the app.
    const fresh = fetch(request.url, { cache: "no-store" }).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
      }
      return response;
    });
    event.respondWith(
      caches.match("./index.html").then((hit) => hit || caches.match("./")).then((saved) => {
        if (saved) {
          event.waitUntil(fresh.catch(() => {}));
          return saved;
        }
        return fresh.catch(() => Response.error());
      })
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
