"use client";

/* eslint-disable @next/next/no-img-element -- Google Drive thumbnails load directly from their public URL. */

import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import {
  getDriveImagePreviewUrl,
  getDriveVideoEmbedUrl,
  getDriveViewUrl,
} from "@/lib/driveMedia";

export interface LightboxMedia {
  type: "image" | "video";
  src: string;
  title: string;
  driveUrl: string;
}

interface MediaLightboxModalProps {
  media: LightboxMedia | null;
  onClose: () => void;
}

export function MediaLightboxModal({
  media,
  onClose,
}: MediaLightboxModalProps) {
  useEffect(() => {
    if (!media) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [media, onClose]);

  if (!media) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={media.title}
      className="fixed inset-0 z-[80] flex flex-col bg-black/85 p-4 backdrop-blur-sm sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-sm font-medium text-zinc-100">
          {media.title}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={getDriveViewUrl(media.driveUrl)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition hover:bg-white"
          >
            <ExternalLink className="size-3.5" />
            Abrir en Drive
          </a>
          <button
            type="button"
            aria-label="Cerrar visor"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center justify-center py-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {media.type === "image" ? (
          <img
            src={getDriveImagePreviewUrl(media.src)}
            alt={media.title}
            className="max-h-[82vh] max-w-[90vw] rounded-lg object-contain"
          />
        ) : (
          <iframe
            src={getDriveVideoEmbedUrl(media.src)}
            title={media.title}
            allow="autoplay; fullscreen"
            allowFullScreen
            className="aspect-video w-full max-w-4xl rounded-xl border border-zinc-800"
          />
        )}
      </div>
    </div>
  );
}
