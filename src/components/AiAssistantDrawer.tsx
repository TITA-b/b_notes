"use client";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Bot,
  Check,
  CircleAlert,
  Copy,
  FileText,
  Mic,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  clearAiMessages,
  getAiMessages,
  saveAiMessage,
} from "@/services/aiMessagesService";
import { getAllNotes } from "@/services/notesService";
import type { AreaId, Note } from "@/types/note";
import type { Task } from "@/types/task";

interface AiActionsPayload {
  createdNotes: Note[];
  createdTasks: Task[];
  updatedNote: Note | null;
  calendarChanged: boolean;
}

interface AiAssistantDrawerProps {
  open: boolean;
  onClose: () => void;
  activeArea: AreaId;
  activeAreaName: string;
  activeNoteId: string | null;
  activeNoteTitle?: string | null;
  onOpenNote: (noteId: string) => void | Promise<void>;
  onActionsExecuted?: (payload: AiActionsPayload) => void;
}

interface RelevantNote {
  id: string;
  title: string;
  areaId: string;
  updatedAt: string;
  excerpt: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isAudio?: boolean;
  sources?: RelevantNote[];
  actions?: string[];
}

interface NoteCitation {
  id: string;
  title: string;
}

const QUICK_PROMPTS = [
  "¿Qué entregas tengo pendientes y cómo viene mi semana?",
  "Resumí los puntos clave de mis notas de esta área",
  "Armame un checklist accionable basado en mi nota actual",
];

function isRelevantNote(value: unknown): value is RelevantNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<RelevantNote>;
  return (
    typeof note.id === "string" &&
    typeof note.title === "string" &&
    typeof note.areaId === "string" &&
    typeof note.updatedAt === "string" &&
    typeof note.excerpt === "string"
  );
}

function isWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}_]/u.test(character);
}

function renderCitedContent(
  content: string,
  candidates: NoteCitation[],
  onOpenNote: (noteId: string) => void
): ReactNode[] {
  const byTitle = new Map<string, NoteCitation>();
  for (const candidate of candidates) {
    const title = candidate.title.trim();
    if (title && !byTitle.has(title.toLocaleLowerCase("es"))) {
      byTitle.set(title.toLocaleLowerCase("es"), { ...candidate, title });
    }
  }

  const matches: Array<{
    start: number;
    end: number;
    citation: NoteCitation;
  }> = [];
  const explicitLinks = /\[\[([^\]]+)\]\]/g;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = explicitLinks.exec(content)) !== null) {
    const citation = byTitle.get(linkMatch[1].trim().toLocaleLowerCase("es"));
    if (citation) {
      matches.push({
        start: linkMatch.index,
        end: linkMatch.index + linkMatch[0].length,
        citation,
      });
    }
  }

  const lowerContent = content.toLocaleLowerCase("es");
  const titles = Array.from(byTitle.values()).sort(
    (a, b) => b.title.length - a.title.length
  );
  for (const citation of titles) {
    const title = citation.title.toLocaleLowerCase("es");
    let from = 0;
    let index = lowerContent.indexOf(title, from);
    while (index >= 0) {
      const end = index + title.length;
      const before = content.slice(0, index).slice(-1);
      const after = content.slice(end, end + 1);
      const overlaps = matches.some(
        (match) => index < match.end && end > match.start
      );
      if (
        !overlaps &&
        !isWordCharacter(before) &&
        !isWordCharacter(after)
      ) {
        matches.push({ start: index, end, citation });
      }
      from = index + Math.max(title.length, 1);
      index = lowerContent.indexOf(title, from);
    }
  }

  matches.sort((a, b) => a.start - b.start);
  const rendered: ReactNode[] = [];
  let position = 0;
  for (const [index, match] of matches.entries()) {
    if (match.start < position) continue;
    if (match.start > position) {
      rendered.push(content.slice(position, match.start));
    }
    rendered.push(
      <button
        key={`${match.citation.id}-${match.start}-${index}`}
        type="button"
        onClick={() => onOpenNote(match.citation.id)}
        className="inline-flex items-center gap-1 rounded-md border border-sky-800/70 bg-sky-950/50 px-1.5 py-0.5 align-baseline text-sky-200 transition hover:border-sky-600 hover:bg-sky-900/60"
      >
        <FileText className="size-3 shrink-0" />
        {match.citation.title}
      </button>
    );
    position = match.end;
  }
  if (position < content.length) rendered.push(content.slice(position));
  return rendered;
}

function splitStoredAssistantMessage(content: string): {
  content: string;
  actions: string[];
} {
  const marker = "\n\n---\n✅ ";
  const markerIndex = content.lastIndexOf(marker);
  if (markerIndex < 0) return { content, actions: [] };
  const actions = content
    .slice(markerIndex + marker.length)
    .split("\n✅ ")
    .map((action) => action.trim())
    .filter(Boolean);
  return { content: content.slice(0, markerIndex), actions };
}

export function AiAssistantDrawer({
  open,
  onClose,
  activeArea,
  activeAreaName,
  activeNoteId,
  activeNoteTitle,
  onOpenNote,
  onActionsExecuted,
}: AiAssistantDrawerProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [citationError, setCitationError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [availableNotes, setAvailableNotes] = useState<Note[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return [];
        setHistoryLoading(true);
        setPersistenceError(null);
        return getAiMessages();
      })
      .then((history) => {
        if (!cancelled) {
          setMessages(
            history.map((message) => {
              const parsed =
                message.role === "assistant"
                  ? splitStoredAssistantMessage(message.content)
                  : { content: message.content, actions: [] };
              return {
                id: message.id,
                role: message.role,
                content: parsed.content,
                actions: parsed.actions,
              };
            })
          );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPersistenceError(
            error instanceof Error
              ? `No se pudo cargar el historial: ${error.message}`
              : "No se pudo cargar el historial."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getAllNotes()
      .then((notes) => {
        if (!cancelled) {
          setAvailableNotes(notes);
          setCitationError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCitationError(
            error instanceof Error
              ? `No se pudieron cargar las notas para las citas: ${error.message}`
              : "No se pudieron cargar las notas para las citas."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  if (!open) return null;

  async function sendPayload(options: {
    text?: string;
    audioBase64?: string;
    audioMimeType?: string;
  }) {
    if (loading || historyLoading) return;

    const isVoice = Boolean(options.audioBase64);
    const displayContent = isVoice
      ? "🎤 Mensaje de voz enviado..."
      : (options.text ?? "").trim();

    if (!displayContent) return;

    const userMsgId = crypto.randomUUID();
    const userMsg: Message = {
      id: userMsgId,
      role: "user",
      content: displayContent,
      isAudio: isVoice,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      if (!isVoice) {
        await persistMessage(userMsg.role, userMsg.content);
      }

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(-12).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          activeArea,
          activeNoteId,
          audioBase64: options.audioBase64 ?? null,
          audioMimeType: options.audioMimeType ?? null,
        }),
      });

      const data = await res.json();

      // Si n8n devuelve la transcripción de Whisper, actualizamos el mensaje del usuario
      if (res.ok && data.transcript && isVoice) {
        const transcriptContent = `🎤 "${data.transcript}"`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMsgId
              ? { ...m, content: transcriptContent }
              : m
          )
        );
        await persistMessage(userMsg.role, transcriptContent);
      } else if (isVoice) {
        await persistMessage(userMsg.role, userMsg.content);
      }

      const executedList: string[] = Array.isArray(data.executedActions)
        ? data.executedActions
        : [];

      const relevantNotes = Array.isArray(data.relevantNotes)
        ? data.relevantNotes.filter(isRelevantNote)
        : [];
      if (res.ok && executedList.length > 0) {
        router.refresh();
        const createdNotes: Note[] = Array.isArray(data.createdNotes)
          ? data.createdNotes
          : [];
        onActionsExecuted?.({
          createdNotes,
          createdTasks: Array.isArray(data.createdTasks) ? data.createdTasks : [],
          updatedNote: data.updatedNote ?? null,
          calendarChanged: data.calendarChanged === true,
        });
        if (createdNotes.length > 0) {
          setAvailableNotes((current) => [
            ...createdNotes,
            ...current.filter(
              (note) => !createdNotes.some((created) => created.id === note.id)
            ),
          ]);
        }
      }

      const replyText = res.ok
        ? data.reply
        : `Error: ${data.error ?? "No se pudo conectar con n8n."}`;

      await appendAssistantMessage(
        replyText,
        res.ok ? relevantNotes : [],
        res.ok ? executedList : []
      );
    } catch {
      if (isVoice) await persistMessage(userMsg.role, userMsg.content);
      await appendAssistantMessage("Error de red al consultar el webhook de n8n.");
    } finally {
      setLoading(false);
    }
  }

  async function persistMessage(role: "user" | "assistant", content: string) {
    try {
      await saveAiMessage(role, content, activeArea);
    } catch (error) {
      setPersistenceError(
        error instanceof Error
          ? `No se pudo guardar el mensaje: ${error.message}`
          : "No se pudo guardar el mensaje."
      );
    }
  }

  async function appendAssistantMessage(
    content: string,
    sources: RelevantNote[] = [],
    actions: string[] = []
  ) {
    const persistedContent = actions.length
      ? `${content}\n\n---\n✅ ${actions.join("\n✅ ")}`
      : content;
    await persistMessage("assistant", persistedContent);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        sources,
        actions,
      },
    ]);
  }

  async function handleOpenCitation(noteId: string) {
    setCitationError(null);
    try {
      await onOpenNote(noteId);
    } catch (error: unknown) {
      setCitationError(
        error instanceof Error
          ? error.message
          : "No se pudo abrir la nota citada."
      );
    }
  }

  async function handleClearMessages() {
    setClearing(true);
    setPersistenceError(null);
    try {
      await clearAiMessages();
      setMessages([]);
    } catch (error) {
      setPersistenceError(
        error instanceof Error
          ? `No se pudo limpiar la conversación: ${error.message}`
          : "No se pudo limpiar la conversación."
      );
    } finally {
      setClearing(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendPayload({ text: input });
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(",")[1];
          if (base64) {
            sendPayload({ audioBase64: base64, audioMimeType: mimeType });
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "No se pudo acceder al micrófono. Verificá los permisos del navegador.",
        },
      ]);
    }
  }

  async function handleCopy(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[1px]">
      <div className="flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-emerald-400">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Asistente B_Notes
              </h3>
              <p className="text-[11px] text-zinc-500 capitalize">
                Contexto: {activeAreaName}
                {activeNoteTitle ? ` · ${activeNoteTitle}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 ? (
              <button
                type="button"
                onClick={handleClearMessages}
                disabled={clearing || loading}
                title="Limpiar conversación"
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-40"
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar asistente"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Historial de chat */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {persistenceError ? (
            <p
              role="alert"
              className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
            >
              {persistenceError}
            </p>
          ) : null}
          {citationError ? (
            <p
              role="alert"
              className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
            >
              {citationError}
            </p>
          ) : null}
          {historyLoading && messages.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-zinc-500">
              <Sparkles className="size-3.5 animate-pulse text-emerald-400" />
              Cargando historial…
            </div>
          ) : null}
          {!historyLoading && messages.length === 0 ? (
            <div className="flex h-full flex-col justify-center space-y-5 px-2">
              <div className="text-center">
                <Bot className="mx-auto size-8 text-zinc-600" />
                <p className="mt-3 text-sm font-medium text-zinc-200">
                  Escribí o mandá un audio sobre tus apuntes
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Conectado a n8n + Groq. Lee tus notas de{" "}
                  <span className="text-zinc-300">{activeAreaName}</span>,
                  tus entregas pendientes y puede crear notas o tareas por vos.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Sugerencias rápidas
                </p>
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendPayload({ text: prompt })}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-3.5 py-2.5 text-left text-xs text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : messages.length > 0 ? (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-zinc-100 font-medium text-zinc-950"
                      : "border border-zinc-800 bg-zinc-900/80 text-zinc-200"
                  }`}
                >
                  {msg.role === "assistant"
                    ? renderCitedContent(
                        msg.content,
                        [
                          ...(msg.sources ?? []).map(({ id, title }) => ({
                            id,
                            title,
                          })),
                          ...availableNotes.map(({ id, title }) => ({
                            id,
                            title,
                          })),
                        ],
                        (noteId) => void handleOpenCitation(noteId)
                      )
                    : msg.content}
                </div>

                {msg.role === "assistant" ? (
                  <>
                    {msg.sources && msg.sources.length > 0 ? (
                      <details className="mt-2 w-[88%] rounded-lg border border-zinc-800 bg-zinc-950/80">
                        <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-zinc-400 hover:text-zinc-200">
                          Fuentes consultadas ({msg.sources.length})
                        </summary>
                        <ul className="space-y-1 border-t border-zinc-800 p-2">
                          {msg.sources.map((source) => (
                            <li key={source.id}>
                              <button
                                type="button"
                                onClick={() => void handleOpenCitation(source.id)}
                                className="flex w-full items-start gap-2 rounded-md p-2 text-left transition hover:bg-zinc-900"
                              >
                                <FileText className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
                                <span className="min-w-0">
                                  <span className="block truncate text-xs text-zinc-200">
                                    {source.title}
                                  </span>
                                  {source.excerpt ? (
                                    <span className="mt-1 block text-[10px] leading-4 text-zinc-500">
                                      {source.excerpt}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}

                    {msg.actions && msg.actions.length > 0 ? (
                      <div className="mt-2 flex w-[88%] flex-wrap gap-1.5">
                        {msg.actions.map((action, index) => {
                          const failed = action.startsWith("Evento no creado:");
                          const StatusIcon = failed ? CircleAlert : BadgeCheck;
                          return (
                            <span
                              key={`${msg.id}-action-${index}`}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${
                                failed
                                  ? "border-amber-900/70 bg-amber-950/40 text-amber-200"
                                  : "border-emerald-900/70 bg-emerald-950/40 text-emerald-200"
                              }`}
                            >
                              <StatusIcon className="size-3 shrink-0" />
                              {action}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          msg.id,
                          [
                            msg.content,
                            ...(msg.actions ?? []).map((action) => `✅ ${action}`),
                          ]
                            .filter(Boolean)
                            .join("\n\n")
                        )
                      }
                      className="mt-1 flex items-center gap-1 px-1 text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="size-3 text-emerald-400" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          Copiar Markdown
                        </>
                      )}
                    </button>
                  </>
                ) : null}
              </div>
            ))
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Sparkles className="size-3.5 animate-pulse text-emerald-400" />
              Procesando en n8n…
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        {/* Input + Micrófono */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-zinc-800 bg-zinc-950 p-3"
        >
          <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 focus-within:border-zinc-600">
            <button
              type="button"
              onClick={toggleRecording}
              disabled={loading || historyLoading}
              title={recording ? "Detener y enviar audio" : "Grabar nota de voz"}
              aria-label={recording ? "Detener grabación" : "Grabar audio"}
              className={`flex size-7 shrink-0 items-center justify-center rounded-lg transition ${
                recording
                  ? "animate-pulse bg-red-500 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              {recording ? (
                <Square className="size-3 fill-current" />
              ) : (
                <Mic className="size-3.5" />
              )}
            </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={recording}
              placeholder={
                recording
                  ? "Grabando audio… tocá el cuadrado para enviar"
                  : "Escribí una consulta o grabá un audio…"
              }
              className="h-8 flex-1 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none disabled:text-red-300"
            />

            <button
              type="submit"
              disabled={!input.trim() || loading || historyLoading || recording}
              aria-label="Enviar mensaje"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 transition hover:bg-white disabled:opacity-40"
            >
              <Send className="size-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}