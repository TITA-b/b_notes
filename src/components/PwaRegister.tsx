"use client";

import { useEffect } from "react";
import { syncPendingOfflineMutations } from "@/services/offlineSync";

export function PwaRegister() {
  useEffect(() => {
    const sync = () => {
      void syncPendingOfflineMutations();
    };

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js")
        .then(async (registration) => {
          const urls = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((name) => {
              const url = new URL(name, window.location.href);
              return (
                url.origin === window.location.origin &&
                url.pathname.startsWith("/_next/static/")
              );
            });
          const worker =
            registration.active ??
            (await navigator.serviceWorker.ready).active;
          worker?.postMessage({ type: "CACHE_STATIC_ASSETS", urls });
        })
        .catch((error: unknown) => {
          console.error(
            "No se pudo registrar el service worker de B_Notes.",
            error
          );
        });
    }

    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    const retryInterval = window.setInterval(sync, 30_000);
    sync();

    return () => {
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
      window.clearInterval(retryInterval);
    };
  }, []);

  return null;
}
