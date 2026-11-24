const OFFLINE_CACHE_KEYS = [
  "bnotes_cache_notes",
  "bnotes_cache_tasks",
  "bnotes_cache_areas",
] as const;

export function clearOfflineCacheStorage(): void {
  if (typeof window === "undefined") return;

  for (const key of OFFLINE_CACHE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.error(`Could not clear offline cache ${key}.`, error);
    }
  }
}

export function clearServiceWorkerRuntimeCache(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const message = { type: "CLEAR_RUNTIME_CACHE" };
  const worker = navigator.serviceWorker.controller;
  if (worker) {
    worker.postMessage(message);
    return;
  }

  void navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.active?.postMessage(message))
    .catch((error: unknown) => {
      console.error("Could not notify the service worker to clear its runtime cache.", error);
    });
}

export function readOfflineCache<T>(key: string): T[] | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      console.error(`Invalid offline cache format for ${key}.`);
      return null;
    }
    return parsed as T[];
  } catch (error) {
    console.error(`Could not read offline cache ${key}.`, error);
    return null;
  }
}

export function writeOfflineCache<T>(key: string, value: T[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Could not write offline cache ${key}.`, error);
  }
}

export function upsertOfflineCacheItem<T extends { id: string }>(
  key: string,
  item: T
): void {
  const cached = readOfflineCache<T>(key) ?? [];
  writeOfflineCache(key, [item, ...cached.filter((entry) => entry.id !== item.id)]);
}

export function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (error instanceof TypeError) return true;
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 500
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|fetch failed|networkerror|network request failed/i.test(
    message
  );
}

export function notifyOfflineCacheUsed(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("bnotes:offline-cache"));
  }
}
