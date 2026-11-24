const SHELL_CACHE = "bnotes-shell-v2";
const RUNTIME_CACHE = "bnotes-runtime-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon", "/apple-icon"];
const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !CURRENT_CACHES.includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_RUNTIME_CACHE") return;

  event.waitUntil(
    caches.delete(RUNTIME_CACHE)
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === "navigate";
  const isStaticAsset = requestUrl.pathname.startsWith("/_next/static/");
  if (!isNavigation && !isStaticAsset) return;

  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response.ok) {
          const responseToCache = response.clone();
          await caches
            .open(RUNTIME_CACHE)
            .then((cache) => cache.put(event.request, responseToCache));
        }
        return response;
      })
      .catch(async () => {
        const runtimeCache = await caches.open(RUNTIME_CACHE);
        const cached = await runtimeCache.match(event.request);
        if (cached) return cached;
        if (isNavigation) {
          const shellCache = await caches.open(SHELL_CACHE);
          const appShell = await shellCache.match("/");
          if (appShell) return appShell;
        }
        return Response.error();
      })
  );
});
