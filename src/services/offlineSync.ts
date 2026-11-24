import { apiRequest } from "@/services/apiClient";
import {
  isNetworkFailure,
  readOfflineCache,
  writeOfflineCache,
} from "@/services/offlineCache";

const PENDING_MUTATIONS_KEY = "bnotes_pending_mutations";

export type OfflineSyncStatus = "idle" | "pending" | "syncing" | "error";
type MutationMethod = "POST" | "PATCH";

interface OfflineMutation {
  id: string;
  path: string;
  method: MutationMethod;
  body: string;
  cacheKey: string;
  localId?: string;
}

interface OfflineMutationInput {
  path: string;
  method: MutationMethod;
  body: string;
  cacheKey: string;
  localId?: string;
}

let activeScope: string | null = null;

export function setOfflineSyncScope(scope: string | null): void {
  activeScope = scope?.trim().toLowerCase() || null;
}

function getPendingMutationsKey(): string | null {
  return activeScope
    ? `${PENDING_MUTATIONS_KEY}:${encodeURIComponent(activeScope)}`
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPendingMutations(): OfflineMutation[] {
  const key = getPendingMutationsKey();
  if (typeof window === "undefined" || !key) return [];

  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (item) =>
          isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.path === "string" &&
          (item.method === "POST" || item.method === "PATCH") &&
          typeof item.body === "string" &&
          typeof item.cacheKey === "string" &&
          (item.localId === undefined || typeof item.localId === "string")
      )
    ) {
      console.error("The pending offline mutation queue has an invalid format.");
      return [];
    }
    return parsed as OfflineMutation[];
  } catch (error) {
    console.error("Could not read the pending offline mutation queue.", error);
    return [];
  }
}

function savePendingMutations(mutations: OfflineMutation[]): void {
  const key = getPendingMutationsKey();
  if (!key) {
    throw new Error("No hay una sesión activa para guardar el cambio pendiente.");
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(mutations));
  } catch (error) {
    console.error("Could not save the pending offline mutation queue.", error);
    throw new Error("No se pudo guardar el cambio pendiente en este dispositivo.");
  }
}

function dispatchSyncStatus(status: OfflineSyncStatus, pendingCount: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("bnotes:sync-status", {
      detail: { status, pendingCount },
    })
  );
}

export function getPendingOfflineMutationCount(): number {
  return readPendingMutations().length;
}

export function getPendingOfflineLocalIds(cacheKey: string): Set<string> {
  return new Set(
    readPendingMutations()
      .filter(
        (mutation): mutation is OfflineMutation & { localId: string } =>
          mutation.cacheKey === cacheKey &&
          typeof mutation.localId === "string"
      )
      .map((mutation) => mutation.localId)
  );
}

export function enqueueOfflineMutation(input: OfflineMutationInput): void {
  if (!getPendingMutationsKey()) {
    throw new Error("No hay una sesión activa para guardar el cambio pendiente.");
  }
  const mutations = readPendingMutations();
  mutations.push({
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  savePendingMutations(mutations);
  dispatchSyncStatus("pending", mutations.length);
}

function reconcileCachedItem(
  mutation: OfflineMutation,
  result: unknown
): string | null {
  if (!isRecord(result) || typeof result.id !== "string") return null;

  const cached = readOfflineCache<Record<string, unknown>>(mutation.cacheKey) ?? [];
  const previousId = mutation.localId ?? result.id;
  const next = [
    result,
    ...cached.filter(
      (item) => item.id !== previousId && item.id !== result.id
    ),
  ];
  writeOfflineCache(mutation.cacheKey, next);
  return result.id;
}

function remapQueuedIds(
  mutations: OfflineMutation[],
  previousId: string,
  nextId: string
): OfflineMutation[] {
  return mutations.map((mutation) => {
    let body = mutation.body;
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed) && parsed.id === previousId) {
        body = JSON.stringify({ ...parsed, id: nextId });
      }
    } catch (error) {
      console.error("Could not remap an offline mutation identifier.", error);
    }
    return {
      ...mutation,
      body,
      localId: mutation.localId === previousId ? nextId : mutation.localId,
    };
  });
}

let activeSync: Promise<void> | null = null;

export function syncPendingOfflineMutations(): Promise<void> {
  if (activeSync) return activeSync;
  activeSync = flushPendingMutations().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function flushPendingMutations(): Promise<void> {
  if (typeof window === "undefined" || !getPendingMutationsKey()) return;

  let mutations = readPendingMutations();
  if (mutations.length === 0) {
    dispatchSyncStatus("idle", 0);
    return;
  }
  if (!navigator.onLine) {
    dispatchSyncStatus("pending", mutations.length);
    return;
  }

  dispatchSyncStatus("syncing", mutations.length);
  while (mutations.length > 0) {
    if (!navigator.onLine) {
      dispatchSyncStatus("pending", mutations.length);
      return;
    }

    const mutation = mutations[0];
    try {
      const result = await apiRequest<unknown>(mutation.path, {
        method: mutation.method,
        body: mutation.body,
      });
      const serverId = reconcileCachedItem(mutation, result);
      mutations = mutations.slice(1);
      if (mutation.localId && serverId && mutation.localId !== serverId) {
        mutations = remapQueuedIds(mutations, mutation.localId, serverId);
      }
      savePendingMutations(mutations);
      dispatchSyncStatus(
        mutations.length === 0 ? "idle" : "syncing",
        mutations.length
      );
    } catch (error) {
      if (isNetworkFailure(error)) {
        dispatchSyncStatus("pending", mutations.length);
      } else {
        console.error("Could not synchronize a pending offline change.", error);
        dispatchSyncStatus("error", mutations.length);
      }
      return;
    }
  }
}
