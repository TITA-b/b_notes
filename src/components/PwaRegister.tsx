"use client";

import { useEffect } from "react";
import { syncPendingOfflineMutations } from "@/services/offlineSync";

export function PwaRegister() {
  useEffect(() => {
    const sync = () => {
      void syncPendingOfflineMutations();
    };

    let hasController = Boolean(
      "serviceWorker" in navigator && navigator.serviceWorker.controller
    );
    let isReloading = false;
    const handleControllerChange = () => {
      if (!hasController) {
        hasController = true;
        return;
      }
      if (isReloading) return;
      isReloading = true;
      window.location.reload();
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        handleControllerChange
      );
      void navigator.serviceWorker
        .register("/sw.js")
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
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          handleControllerChange
        );
      }
    };
  }, []);

  return null;
}
