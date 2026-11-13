"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Network, Sparkles } from "lucide-react";
import { getAllNotes } from "@/services/notesService";
import { getAreas } from "@/services/areasService";
import type { Area, AreaId, Note } from "@/types/note";

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

function extractWikiLinks(content: string): string[] {
  const unescaped = content.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
  const regex = /\[\[([^\]]+)\]\]/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(unescaped)) !== null) {
    matches.push(match[1].trim().toLowerCase());
  }
  return matches;
}

export function KnowledgeGraph({
  activeArea,
  onSelectNote,
}: KnowledgeGraphProps) {
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "area">("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [viewBox, setViewBox] = useState({
    x: 0,
    y: 0,
    width: 900,
    height: 600,
  });
  const [renderedNodes, setRenderedNodes] = useState<GraphNode[]>([]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const simNodesRef = useRef<GraphNode[]>([]);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAllNotes(), getAreas()])
      .then(([notes, loadedAreas]) => {
        if (!cancelled) {
          setAllNotes(notes);
          setAreas(loadedAreas);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las áreas y notas."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredNotes = useMemo(() => {
    return scope === "all"
      ? allNotes
      : allNotes.filter((n) => n.area === activeArea);
  }, [allNotes, scope, activeArea]);

  const areaBySlug = useMemo(
    () => new Map(areas.map((area) => [area.slug, area])),
    [areas]
  );
  const activeAreaName = areaBySlug.get(activeArea)?.name ?? activeArea;

  const { initialNodes, edges } = useMemo(() => {
    const byTitle = new Map<string, Note>();
    filteredNotes.forEach((n) => {
      byTitle.set(n.title.trim().toLowerCase(), n);
    });

    const computedEdges: GraphEdge[] = [];
    const connectedPairs = new Set<string>();
    const degreeMap = new Map<string, number>();

    filteredNotes.forEach((sourceNote) => {
      const links = new Set([
        ...extractWikiLinks(sourceNote.content),
        ...(sourceNote.links ?? []).map((link) => link.trim().toLowerCase()),
      ]);
      links.forEach((targetTitle) => {
        const targetNote = byTitle.get(targetTitle);
        if (targetNote && targetNote.id !== sourceNote.id) {
          const pairKey = [sourceNote.id, targetNote.id].sort().join("::");
          if (connectedPairs.has(pairKey)) return;
          connectedPairs.add(pairKey);
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
    const nodes: GraphNode[] = filteredNotes.map((note, idx) => {
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

    return { initialNodes: nodes, edges: computedEdges };
  }, [filteredNotes]);

  useEffect(() => {
    simNodesRef.current = initialNodes.map((n) => ({ ...n }));
    let animId: number;
    const width = 900;
    const height = 600;

    function step() {
      const nodes = simNodesRef.current;
      if (nodes.length === 0) {
        setRenderedNodes([]);
        return;
      }

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

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

      for (const n of nodes) {
        if (n.id === draggingId) continue;
        n.vx += (width / 2 - n.x) * 0.004;
        n.vy += (height / 2 - n.y) * 0.004;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x = Math.max(50, Math.min(width - 50, n.x + n.vx));
        n.y = Math.max(50, Math.min(height - 50, n.y + n.vy));
      }

      setRenderedNodes(nodes.map((n) => ({ ...n })));
      animId = requestAnimationFrame(step);
    }

    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [initialNodes, edges, draggingId]);

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
    const panStart = panStartRef.current;
    if (panStart) {
      setViewBox({
        x: panStart.x - (e.clientX - panStart.clientX) * panStart.scaleX,
        y: panStart.y - (e.clientY - panStart.clientY) * panStart.scaleY,
        width: panStart.width,
        height: panStart.height,
      });
      return;
    }
    if (!draggingId || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.width;
    const y = viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.height;

    const node = simNodesRef.current.find((n) => n.id === draggingId);
    if (node) {
      node.x = Math.max(40, Math.min(860, x));
      node.y = Math.max(40, Math.min(560, y));
      node.vx = 0;
      node.vy = 0;
    }
  }

  function handleCanvasPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width,
      height: viewBox.height,
      scaleX: viewBox.width / rect.width,
      scaleY: viewBox.height / rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
  }

  function handlePointerEnd() {
    panStartRef.current = null;
    setPanning(false);
    setDraggingId(null);
  }

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const pointerX = (e.clientX - rect.left) / rect.width;
    const pointerY = (e.clientY - rect.top) / rect.height;
    const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1;
    const width = Math.min(1800, Math.max(180, viewBox.width * zoomFactor));
    const height = Math.min(1200, Math.max(120, viewBox.height * zoomFactor));
    const graphX = viewBox.x + pointerX * viewBox.width;
    const graphY = viewBox.y + pointerY * viewBox.height;

    setViewBox({
      x: graphX - pointerX * width,
      y: graphY - pointerY * height,
      width,
      height,
    });
  }

  const nodeById = useMemo(
    () => new Map(renderedNodes.map((n) => [n.id, n])),
    [renderedNodes]
  );

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Network className="size-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-zinc-100">
            Mapa de Conocimiento
          </h2>
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
            {renderedNodes.length} notas · {edges.length} conexiones
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-3 sm:flex">
            {areas.map((area) => (
              <span
                key={area.id}
                className="flex items-center gap-1.5 text-[11px] text-zinc-400"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: area.color }}
                />
                {area.name}
              </span>
            ))}
          </div>

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
              className={`rounded-md px-2.5 py-1 transition ${
                scope === "area"
                  ? "bg-zinc-800 font-medium text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Solo {activeAreaName}
            </button>
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            Construyendo red de nodos…
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="flex h-full items-center justify-center px-6 text-center text-xs text-red-300"
          >
            {loadError}
          </div>
        ) : renderedNodes.length === 0 ? (
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
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerLeave={() => {
              if (!panStartRef.current) setDraggingId(null);
            }}
            onWheel={handleWheel}
            className={`h-full w-full select-none ${
              panning || draggingId ? "cursor-grabbing" : "cursor-grab"
            }`}
            style={{ touchAction: "none" }}
          >
            {edges.map((edge, idx) => {
              const s = nodeById.get(edge.source);
              const t = nodeById.get(edge.target);
              if (!s || !t) return null;

              const isHighlighted =
                hoveredId &&
                (edge.source === hoveredId || edge.target === hoveredId);
              const isDimmed = hoveredId && !isHighlighted;

              const edgeColor = isHighlighted ? "#34d399" : "#52525b";
              const edgeOpacity = isDimmed ? 0.15 : isHighlighted ? 0.95 : 0.75;

              return (
                <g key={`${edge.source}-${edge.target}-${idx}`}>
                  <line
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={edgeColor}
                    strokeWidth={isHighlighted ? 2 : 1.5}
                    strokeOpacity={edgeOpacity}
                    pointerEvents="none"
                  />
                  <circle
                    cx={(s.x + t.x) / 2}
                    cy={(s.y + t.y) / 2}
                    r={2}
                    fill={edgeColor}
                    fillOpacity={edgeOpacity}
                    pointerEvents="none"
                  />
                </g>
              );
            })}

            {renderedNodes.map((node) => {
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
                    e.currentTarget.setPointerCapture(e.pointerId);
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
                    fill={areaBySlug.get(node.area)?.color ?? "#71717a"}
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
          Rueda para zoom · Arrastrá el fondo para mover el lienzo · Arrastrá nodos para moverlos · Clic para abrir · Usá{" "}
          <span className="text-zinc-300">[[Título]]</span>
        </div>
      </div>
    </div>
  );
}