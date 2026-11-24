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

export function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
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
