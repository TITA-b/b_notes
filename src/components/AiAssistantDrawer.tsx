"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Check,
  Copy,
  Mic,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { AreaId, Note } from "@/types/note";
import type { Task } from "@/types/task";

interface AiActionsPayload {
  createdNotes: Note[];
  createdTasks: Task[];
  updatedNote: Note | null;
}

interface AiAssistantDrawerProps {
  open: boolean;
  onClose: () => void;
  activeArea: AreaId;
  activeNoteId: string | null;
  activeNoteTitle?: string | null;
  onActionsExecuted?: (payload: AiActionsPayload) => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isAudio?: boolean;
}

const QUICK_PROMPTS = [
  "¿Qué entregas tengo pendientes y cómo viene mi semana?",
  "Resumí los puntos clave de mis notas de esta área",
  "Armame un checklist accionable basado en mi nota actual",
];

export function AiAssistantDrawer({
  open,
  onClose,
  activeArea,
  activeNoteId,
  activeNoteTitle,
  onActionsExecuted,
}: AiAssistantDrawerProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  if (!open) return null;

  async function sendPayload(options: {
    text?: string;
    audioBase64?: string;
    audioMimeType?: string;
  }) {
    if (loading) return;

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
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMsgId
              ? { ...m, content: `🎤 "${data.transcript}"` }
              : m
          )
        );
      }

      const executedList: string[] = Array.isArray(data.executedActions)
        ? data.executedActions
        : [];

      if (res.ok && executedList.length > 0) {
        router.refresh();
        onActionsExecuted?.({
          createdNotes: data.createdNotes ?? [],
          createdTasks: data.createdTasks ?? [],
          updatedNote: data.updatedNote ?? null,
        });
      }

      const actionsBadge =
        executedList.length > 0
          ? `\n\n---\n✅ ${executedList.join("\n✅ ")}`
          : "";

      const replyText = res.ok
        ? `${data.reply}${actionsBadge}`
        : `Error: ${data.error ?? "No se pudo conectar con n8n."}`;

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: replyText,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Error de red al consultar el webhook de n8n.",
        },
      ]);
    } finally {
      setLoading(false);
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
                Contexto: {activeArea}
                {activeNoteTitle ? ` · ${activeNoteTitle}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 ? (
              <button
                type="button"
                onClick={() => setMessages([])}
                title="Limpiar conversación"
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
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
          {messages.length === 0 ? (
            <div className="flex h-full flex-col justify-center space-y-5 px-2">
              <div className="text-center">
                <Bot className="mx-auto size-8 text-zinc-600" />
                <p className="mt-3 text-sm font-medium text-zinc-200">
                  Escribí o mandá un audio sobre tus apuntes
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Conectado a n8n + Groq. Lee tus notas de{" "}
                  <span className="capitalize text-zinc-300">{activeArea}</span>,
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
          ) : (
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
                  {msg.content}
                </div>

                {msg.role === "assistant" ? (
                  <button
                    type="button"
                    onClick={() => handleCopy(msg.id, msg.content)}
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
                ) : null}
              </div>
            ))
          )}

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
              disabled={loading}
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
              disabled={!input.trim() || loading || recording}
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