const SHELL_CACHE = "bnotes-shell-v4";
const RUNTIME_CACHE = "bnotes-runtime-v4";
const SHARE_DATABASE = "bnotes-share-target";
const SHARE_STORE = "attachments";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon", "/apple-icon"];
const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

function openShareDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SHARE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeSharedAttachment(file) {
  const database = await openShareDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SHARE_STORE, "readwrite");
    const id = crypto.randomUUID();
    const store = transaction.objectStore(SHARE_STORE);
    const expiredBefore = Date.now() - 24 * 60 * 60 * 1000;
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      if (
        typeof cursor.value.createdAt !== "number" ||
        cursor.value.createdAt < expiredBefore
      ) {
        cursor.delete();
      }
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
    store.put({
      id,
      file,
      name: file.name || "shared-attachment",
      type: file.type || "application/octet-stream",
      createdAt: Date.now(),
    });
    transaction.oncomplete = () => {
      database.close();
      resolve(id);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function handleShareTarget(request) {
  const target = new URL("/", self.location.origin);
  try {
    const form = await request.formData();
    for (const [field, parameter] of [
      ["share_title", "share_title"],
      ["share_text", "share_text"],
      ["share_url", "share_url"],
    ]) {
      const value = form.get(field);
      if (typeof value === "string" && value.trim()) {
        target.searchParams.set(parameter, value.trim().slice(0, 10000));
      }
    }

    const file = form.get("share_file");
    if (file && typeof file !== "string" && file.size > 0) {
      if (file.size > 24 * 1024 * 1024) {
        throw new Error("The shared attachment exceeds the 24 MB limit.");
      }
      const id = await storeSharedAttachment(file);
      target.searchParams.set("share_attachment_id", id);
    }
    return Response.redirect(target.toString(), 303);
  } catch (error) {
    console.error("Could not receive a shared file.", error);
    target.searchParams.set("share_error", "attachment");
    return Response.redirect(target.toString(), 303);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
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
    })()
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
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed;
    } else {
      payload = { body: typeof parsed === "string" ? parsed : "" };
    }
  } catch (error) {
    console.warn("Could not decode the Push notification payload.", error);
    payload = { body: event.data?.text() ?? "" };
  }

  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : "B_Notes";
  const body = typeof payload.body === "string" ? payload.body : "";
  const requestedUrl =
    typeof payload.url === "string"
      ? payload.url
      : typeof payload.data?.url === "string"
        ? payload.data.url
        : "/";
  let url = "/";
  try {
    const parsedUrl = new URL(requestedUrl, self.location.origin);
    if (parsedUrl.origin === self.location.origin) {
      url = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    }
  } catch (error) {
    console.warn("The Push notification URL is invalid; opening B_Notes home.", error);
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon",
      badge: "/icon",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl =
    typeof event.notification.data?.url === "string"
      ? event.notification.data.url
      : "/";
  let targetUrl = new URL("/", self.location.origin);
  try {
    const parsedUrl = new URL(requestedUrl, self.location.origin);
    if (parsedUrl.origin === self.location.origin) targetUrl = parsedUrl;
  } catch (error) {
    console.warn("The notification-click URL is invalid; opening B_Notes home.", error);
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      async (clients) => {
        for (const client of clients) {
          if (client.url.startsWith(self.location.origin)) {
            await client.navigate(targetUrl.toString());
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl.toString());
      }
    )
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method === "POST" &&
    requestUrl.origin === self.location.origin &&
    requestUrl.pathname === "/share"
  ) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== "GET") return;

  if (requestUrl.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === "navigate";
  const isStaticAsset = requestUrl.pathname.startsWith("/_next/static/");
  const isApiRequest = requestUrl.pathname.startsWith("/api/");

  if (isStaticAsset) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (!isNavigation && !isApiRequest) return;

  event.respondWith(
    (async () => {
      let cachedResponse;
      try {
        const runtimeCache = await caches.open(RUNTIME_CACHE);
        cachedResponse = await runtimeCache.match(event.request);
      } catch (error) {
        console.warn("Could not read a runtime cache entry.", error);
      }

      try {
        const response = await fetch(event.request);
        if (response.ok && !response.redirected) {
          try {
            const runtimeCache = await caches.open(RUNTIME_CACHE);
            await runtimeCache.put(event.request, response.clone());
          } catch (error) {
            console.warn("Could not cache a runtime resource.", error);
          }
        }
        return response;
      } catch (error) {
        if (cachedResponse) return cachedResponse;
        if (isNavigation) {
          try {
            const shellCache = await caches.open(SHELL_CACHE);
            const appShell = await shellCache.match("/");
            if (appShell) return appShell;
          } catch (cacheError) {
            console.warn("Could not read the app shell cache.", cacheError);
          }
        }
        console.warn("No cached response is available for an offline request.", error);
        return Response.error();
      }
    })()
  );
});
