"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Network, Sparkles } from "lucide-react";
import { getAllNotes } from "@/services/notesService";
import type { AreaId, Note } from "@/types/note";

interface KnowledgeGraphProps {
  activeArea: AreaId;
  onSelectNote: (note: Note) => void;
}

interface GraphNode {
  id: string;
  title: string;
  area: AreaId;
  note: Note;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

interface GraphEdge {
  source: string;
  target: string;
}

const AREA_COLORS: Record<AreaId, string> = {
  facultad: "#38bdf8", // sky-400
  weedo: "#a855f7",    // purple-500
  personal: "#34d399", // emerald-400
  finanzas: "#fbbf24", // amber-400
};

const AREA_LABELS: Record<AreaId, string> = {
  facultad: "Facultad",
  weedo: "Weedo",
  personal: "Personal",
  finanzas: "Finanzas",
};

function extractWikiLinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1].trim().toLowerCase());
  }
  return matches;
}

export function KnowledgeGraph({
  activeArea,
  onSelectNote,
}: KnowledgeGraphProps) {
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | "area">("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);

  useEffect(() => {
    setLoading(true);
    getAllNotes()
      .then((data) => setAllNotes(data))
      .finally(() => setLoading(false));
  }, []);

  const filteredNotes = useMemo(() => {
    return scope === "all"
      ? allNotes
      : allNotes.filter((n) => n.area === activeArea);
  }, [allNotes, scope, activeArea]);

  const { edges } = useMemo(() => {
    const byTitle = new Map<string, Note>();
    filteredNotes.forEach((n) => {
      byTitle.set(n.title.trim().toLowerCase(), n);
    });

    const computedEdges: GraphEdge[] = [];
    const degreeMap = new Map<string, number>();

    filteredNotes.forEach((sourceNote) => {
      const links = extractWikiLinks(sourceNote.content);
      links.forEach((targetTitle) => {
        const targetNote = byTitle.get(targetTitle);
        if (targetNote && targetNote.id !== sourceNote.id) {
          computedEdges.push({
            source: sourceNote.id,
            target: targetNote.id,
          });
          degreeMap.set(sourceNote.id, (degreeMap.get(sourceNote.id) ?? 0) + 1);
          degreeMap.set(targetNote.id, (degreeMap.get(targetNote.id) ?? 0) + 1);
        }
      });
    });

    const width = 900;
    const height = 600;
    nodesRef.current = filteredNotes.map((note, idx) => {
      const angle = (idx / Math.max(filteredNotes.length, 1)) * Math.PI * 2;
      const radius = 140 + (idx % 3) * 45;
      return {
        id: note.id,
        title: note.title || "Sin título",
        area: note.area,
        note,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        degree: degreeMap.get(note.id) ?? 0,
      };
    });

    return { edges: computedEdges };
  }, [filteredNotes]);

  // Simulación física de fuerzas (repulsión + resortes + gravedad al centro)
  useEffect(() => {
    let animId: number;
    const width = 900;
    const height = 600;

    function step() {
      const nodes = nodesRef.current;
      if (nodes.length === 0) return;

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // 1. Repulsión entre todos los nodos
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = Math.max(dx * dx + dy * dy, 400);
          const force = 3200 / distSq;
          const dist = Math.sqrt(distSq);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // 2. Atracción en los enlaces [[wikilinks]]
      for (const edge of edges) {
        const s = nodeMap.get(edge.source);
        const t = nodeMap.get(edge.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const idealDist = 140;
        const force = (dist - idealDist) * 0.015;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      }

      // 3. Gravedad suave al centro y fricción
      for (const n of nodes) {
        if (n.id === draggingId) continue;
        n.vx += (width / 2 - n.x) * 0.004;
        n.vy += (height / 2 - n.y) * 0.004;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x = Math.max(50, Math.min(width - 50, n.x + n.vx));
        n.y = Math.max(50, Math.min(height - 50, n.y + n.vy));
      }

      setTick((t) => (t + 1) % 10000);
      animId = requestAnimationFrame(step);
    }

    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [edges, draggingId]);

  const connectedToHovered = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const set = new Set<string>([hoveredId]);
    edges.forEach((e) => {
      if (e.source === hoveredId) set.add(e.target);
      if (e.target === hoveredId) set.add(e.source);
    });
    return set;
  }, [hoveredId, edges]);

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingId || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = 900 / rect.width;
    const scaleY = 600 / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const node = nodesRef.current.find((n) => n.id === draggingId);
    if (node) {
      node.x = Math.max(40, Math.min(860, x));
      node.y = Math.max(40, Math.min(560, y));
      node.vx = 0;
      node.vy = 0;
    }
  }

  const nodes = nodesRef.current;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Barra superior del grafo */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Network className="size-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-zinc-100">
            Mapa de Conocimiento
          </h2>
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
            {nodes.length} notas · {edges.length} conexiones
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Leyenda de colores */}
          <div className="hidden items-center gap-3 sm:flex">
            {(Object.keys(AREA_COLORS) as AreaId[]).map((areaKey) => (
              <span
                key={areaKey}
                className="flex items-center gap-1.5 text-[11px] text-zinc-400"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: AREA_COLORS[areaKey] }}
                />
                {AREA_LABELS[areaKey]}
              </span>
            ))}
          </div>

          {/* Selector Todas vs Área actual */}
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`rounded-md px-2.5 py-1 transition ${
                scope === "all"
                  ? "bg-zinc-800 font-medium text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Todo el sistema
            </button>
            <button
              type="button"
              onClick={() => setScope("area")}
              className={`rounded-md px-2.5 py-1 capitalize transition ${
                scope === "area"
                  ? "bg-zinc-800 font-medium text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Solo {activeArea}
            </button>
          </div>
        </div>
      </div>

      {/* Lienzo interactivo */}
      <div className="relative flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            Construyendo red de nodos…
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <Sparkles className="size-7 text-zinc-700" />
            <p className="mt-2 text-sm text-zinc-300">
              Todavía no hay notas para graficar
            </p>
            <p className="mt-1 max-w-xs text-xs text-zinc-500">
              Usá <code className="text-zinc-300">[[Nombre de otra nota]]</code>{" "}
              dentro de tus apuntes para conectar ideas automáticamente.
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox="0 0 900 600"
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDraggingId(null)}
            onPointerLeave={() => setDraggingId(null)}
            className="h-full w-full cursor-grab active:cursor-grabbing select-none"
          >
            {/* Aristas / Conexiones */}
            {edges.map((edge, idx) => {
              const s = nodeById.get(edge.source);
              const t = nodeById.get(edge.target);
              if (!s || !t) return null;

              const isHighlighted =
                hoveredId &&
                (edge.source === hoveredId || edge.target === hoveredId);
              const isDimmed = hoveredId && !isHighlighted;

              return (
                <line
                  key={`${edge.source}-${edge.target}-${idx}`}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke={isHighlighted ? "#34d399" : "#3f3f46"}
                  strokeWidth={isHighlighted ? 2 : 1.2}
                  strokeOpacity={isDimmed ? 0.15 : isHighlighted ? 0.95 : 0.55}
                />
              );
            })}

            {/* Nodos */}
            {nodes.map((node) => {
              const radius = 6 + Math.min(node.degree * 2.5, 10);
              const isHovered = hoveredId === node.id;
              const isConnected = connectedToHovered.has(node.id);
              const isDimmed = hoveredId && !isConnected;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setDraggingId(node.id);
                  }}
                  onClick={() => onSelectNote(node.note)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="cursor-pointer transition-opacity duration-150"
                  style={{ opacity: isDimmed ? 0.2 : 1 }}
                >
                  <circle
                    r={isHovered ? radius + 3 : radius}
                    fill={AREA_COLORS[node.area]}
                    stroke="#09090b"
                    strokeWidth={2}
                  />
                  <text
                    y={radius + 14}
                    textAnchor="middle"
                    fill={isHovered ? "#ffffff" : "#a1a1aa"}
                    fontSize={isHovered ? 12 : 11}
                    fontWeight={isHovered ? 600 : 400}
                  >
                    {node.title.length > 26
                      ? `${node.title.slice(0, 26)}…`
                      : node.title}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        <div className="pointer-events-none absolute bottom-3 left-4 rounded-lg border border-zinc-800/80 bg-zinc-950/90 px-3 py-1.5 text-[11px] text-zinc-500">
          Arrastrá los nodos para moverlos · Clic para abrir la nota · Conectá ideas con{" "}
          <span className="text-zinc-300">[[Título]]</span>
        </div>
      </div>
    </div>
  );
}