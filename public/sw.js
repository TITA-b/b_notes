const SHELL_CACHE = "bnotes-shell-v3";
const RUNTIME_CACHE = "bnotes-runtime-v3";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon", "/apple-icon"];
const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map(async (path) => {
          try {
            const response = await fetch(
              new Request(new URL(path, self.location.origin), {
                credentials: "include",
                cache: "no-store",
              })
            );
            if (response.ok && !response.redirected) {
              await cache.put(path, response);
            }
          } catch (error) {
            console.warn(`Could not pre-cache the app shell resource ${path}.`, error);
          }
        })
      );
      await self.skipWaiting();
    })
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
  if (event.data?.type === "CLEAR_RUNTIME_CACHE") {
    event.waitUntil(caches.delete(RUNTIME_CACHE));
    return;
  }

  if (
    event.data?.type !== "CACHE_STATIC_ASSETS" ||
    !Array.isArray(event.data.urls)
  ) {
    return;
  }

  event.waitUntil(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const urls = event.data.urls
        .filter((value) => typeof value === "string")
        .map((value) => new URL(value, self.location.origin))
        .filter(
          (url) =>
            url.origin === self.location.origin &&
            url.pathname.startsWith("/_next/static/")
        )
        .slice(0, 200);

      await Promise.all(
        urls.map(async (url) => {
          try {
            const request = new Request(url, {
              credentials: "include",
              cache: "no-store",
            });
            const response = await fetch(request);
            if (response.ok && !response.redirected) {
              await cache.put(request, response);
            }
          } catch (error) {
            console.warn("Could not cache a loaded static asset.", error);
          }
        })
      );
    })()
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
    (async () => {
      const runtimeCache = await caches.open(RUNTIME_CACHE);
      const cachedResponse = await runtimeCache.match(event.request);
      try {
        const response = await fetch(event.request);
        if (response.ok && !response.redirected) {
          try {
            await runtimeCache.put(event.request, response.clone());
          } catch (error) {
            console.warn("Could not cache a runtime resource.", error);
          }
        } else if (
          response.status < 500 &&
          !(isStaticAsset && !response.ok)
        ) {
          return response;
        }

        if (cachedResponse) return cachedResponse;
        if (isNavigation) {
          const shellCache = await caches.open(SHELL_CACHE);
          const appShell = await shellCache.match("/");
          if (appShell) return appShell;
        }
        return response;
      } catch (error) {
        if (cachedResponse) return cachedResponse;
        if (isNavigation) {
          const shellCache = await caches.open(SHELL_CACHE);
          const appShell = await shellCache.match("/");
          if (appShell) return appShell;
        }
        console.warn("No cached response is available for an offline request.", error);
        return Response.error();
      }
    })()
  );
});
