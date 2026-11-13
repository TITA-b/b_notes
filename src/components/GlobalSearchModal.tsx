"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { getAllNotes } from "@/services/notesService";
import type { Note } from "@/types/note";

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelectNote: (note: Note) => void;
}

export function GlobalSearchModal({
  open,
  onClose,
  onSelectNote,
}: GlobalSearchModalProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    setNotes([]);
    setQuery("");
    setError(null);
    setLoading(true);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    inputRef.current?.focus();

    getAllNotes()
      .then((allNotes) => {
        if (!cancelled) setNotes(allNotes);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No se pudieron cargar las notas."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, handleClose]);

  if (!open) return null;

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = notes.filter((note) =>
    [note.title, note.content, note.area].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery)
    )
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Búsqueda global de notas"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4">
          <Search className="size-4 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) {
                onSelectNote(results[0]);
                handleClose();
              }
            }}
            placeholder="Buscar notas por título, contenido o área…"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <kbd className="rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            ESC
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {loading ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">
              Cargando notas…
            </p>
          ) : error ? (
            <p role="alert" className="px-3 py-8 text-center text-sm text-red-300">
              {error}
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">
              {query ? "No se encontraron notas." : "Todavía no hay notas."}
            </p>
          ) : (
            <ul className="space-y-1">
              {results.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectNote(note);
                      handleClose();
                    }}
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition hover:bg-zinc-900 focus-visible:bg-zinc-900 focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-100">
                        {note.title || "Sin título"}
                      </span>
                      <span className="mt-1 block truncate text-xs text-zinc-500">
                        {note.content || "Nota vacía"}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] capitalize text-zinc-400">
                      {note.area}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
