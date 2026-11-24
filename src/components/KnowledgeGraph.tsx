"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
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

function getNoteExcerpt(content: string): string {
  const cleanContent = content
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/[`*_~#|]/g, " ")
    .replace(/[\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleanContent.length > 180
    ? `${cleanContent.slice(0, 177).trimEnd()}…`
    : cleanContent;
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hideOrphans, setHideOrphans] = useState(false);
  const [viewBox, setViewBox] = useState({
    x: 0,
    y: 0,
    width: 900,
    height: 600,
  });
  const [renderedNodes, setRenderedNodes] = useState<GraphNode[]>([]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const simNodesRef = useRef<GraphNode[]>([]);
  const draggingIdRef = useRef<string | null>(null);
  const activePointersRef = useRef(
    new Map<number, { x: number; y: number }>()
  );
  const pinchStartRef = useRef<{
    distance: number;
    centerX: number;
    centerY: number;
    viewBox: typeof viewBox;
  } | null>(null);
  const viewBoxRef = useRef(viewBox);
  const nodePointerStartRef = useRef<{
    id: string;
    pointerId: number;
    clientX: number;
    clientY: number;
    dragged: boolean;
  } | null>(null);
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
        if (n.id === draggingIdRef.current) continue;
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
  }, [initialNodes, edges]);

  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  const connectedToHovered = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const set = new Set<string>([hoveredId]);
    edges.forEach((e) => {
      if (e.source === hoveredId) set.add(e.target);
      if (e.target === hoveredId) set.add(e.source);
    });
    return set;
  }, [hoveredId, edges]);

  const visibleNodes = useMemo(
    () =>
      hideOrphans
        ? renderedNodes.filter((node) => node.degree > 0)
        : renderedNodes,
    [hideOrphans, renderedNodes]
  );
  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes]
  );
  const visibleEdges = useMemo(
    () =>
      edges.filter(
        (edge) =>
          visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
      ),
    [edges, visibleNodeIds]
  );
  const hasCanvas = !loading && !loadError && visibleNodes.length > 0;
  useEffect(() => {
    if (!hasCanvas) return;
    const graphSvg = svgRef.current;
    if (!graphSvg) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pointerX = (event.clientX - rect.left) / rect.width;
      const pointerY = (event.clientY - rect.top) / rect.height;
      const current = viewBoxRef.current;
      const zoomFactor = event.deltaY < 0 ? 0.9 : 1.1;
      const width = Math.min(1800, Math.max(180, current.width * zoomFactor));
      const height = Math.min(1200, Math.max(120, current.height * zoomFactor));
      const graphX = current.x + pointerX * current.width;
      const graphY = current.y + pointerY * current.height;
      const nextViewBox = {
        x: graphX - pointerX * width,
        y: graphY - pointerY * height,
        width,
        height,
      };

      viewBoxRef.current = nextViewBox;
      setViewBox(nextViewBox);
    }

    graphSvg.addEventListener("wheel", handleWheel, { passive: false });
    return () => graphSvg.removeEventListener("wheel", handleWheel);
  }, [hasCanvas]);

  const selectedNode =
    visibleNodes.find((node) => node.id === selectedNodeId) ?? null;
  const connectedNodes = useMemo(() => {
    if (!selectedNode) return [];
    const connectedIds = edges.flatMap((edge) => {
      if (edge.source === selectedNode.id) return [edge.target];
      if (edge.target === selectedNode.id) return [edge.source];
      return [];
    });
    return connectedIds
      .map((id) => visibleNodes.find((node) => node.id === id))
      .filter((node): node is GraphNode => node !== undefined);
  }, [edges, selectedNode, visibleNodes]);

  function focusNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    const node = simNodesRef.current.find((item) => item.id === nodeId);
    if (node) {
      const current = viewBoxRef.current;
      const nextViewBox = {
        ...current,
        x: node.x - current.width / 2,
        y: node.y - current.height / 2,
      };
      viewBoxRef.current = nextViewBox;
      setViewBox(nextViewBox);
    }
  }

  function beginPointer(
    e: React.PointerEvent<SVGSVGElement | SVGGElement>,
    nodeId: string | null
  ) {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (activePointersRef.current.size >= 2 && svgRef.current) {
      const [first, second] = Array.from(activePointersRef.current.values());
      const rect = svgRef.current.getBoundingClientRect();
      const current = viewBoxRef.current;
      pinchStartRef.current = {
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        centerX: ((first.x + second.x) / 2 - rect.left) / rect.width,
        centerY: ((first.y + second.y) / 2 - rect.top) / rect.height,
        viewBox: { ...current },
      };
      panStartRef.current = null;
      nodePointerStartRef.current = null;
      draggingIdRef.current = null;
      setDraggingId(null);
      setPanning(false);
      return;
    }

    if (nodeId) {
      nodePointerStartRef.current = {
        id: nodeId,
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
        dragged: false,
      };
      draggingIdRef.current = nodeId;
      setDraggingId(nodeId);
      return;
    }

    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const current = viewBoxRef.current;
    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      x: current.x,
      y: current.y,
      width: current.width,
      height: current.height,
      scaleX: current.width / rect.width,
      scaleY: current.height / rect.height,
    };
    setPanning(true);
  }

  function handleCanvasPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return;
    beginPointer(e, null);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pinchStart = pinchStartRef.current;
    if (pinchStart && activePointersRef.current.size >= 2 && svgRef.current) {
      const [first, second] = Array.from(activePointersRef.current.values());
      const rect = svgRef.current.getBoundingClientRect();
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midpointX = ((first.x + second.x) / 2 - rect.left) / rect.width;
      const midpointY = ((first.y + second.y) / 2 - rect.top) / rect.height;
      const zoom = distance / pinchStart.distance;
      const width = Math.min(1800, Math.max(180, pinchStart.viewBox.width / zoom));
      const height = Math.min(1200, Math.max(120, pinchStart.viewBox.height / zoom));
      const anchorX =
        pinchStart.viewBox.x + pinchStart.centerX * pinchStart.viewBox.width;
      const anchorY =
        pinchStart.viewBox.y + pinchStart.centerY * pinchStart.viewBox.height;
      const nextViewBox = {
        x: anchorX - midpointX * width,
        y: anchorY - midpointY * height,
        width,
        height,
      };
      viewBoxRef.current = nextViewBox;
      setViewBox(nextViewBox);
      return;
    }

    if (activePointersRef.current.size !== 1) return;
    const nodePointerStart = nodePointerStartRef.current;
    if (nodePointerStart?.pointerId === e.pointerId && draggingIdRef.current) {
      const distance = Math.hypot(
        e.clientX - nodePointerStart.clientX,
        e.clientY - nodePointerStart.clientY
      );
      if (distance > 4) nodePointerStart.dragged = true;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const current = viewBoxRef.current;
      const x = current.x + ((e.clientX - rect.left) / rect.width) * current.width;
      const y = current.y + ((e.clientY - rect.top) / rect.height) * current.height;
      const node = simNodesRef.current.find(
        (item) => item.id === draggingIdRef.current
      );
      if (node) {
        node.x = Math.max(40, Math.min(860, x));
        node.y = Math.max(40, Math.min(560, y));
        node.vx = 0;
        node.vy = 0;
      }
      return;
    }

    const panStart = panStartRef.current;
    if (panStart) {
      const nextViewBox = {
        x: panStart.x - (e.clientX - panStart.clientX) * panStart.scaleX,
        y: panStart.y - (e.clientY - panStart.clientY) * panStart.scaleY,
        width: panStart.width,
        height: panStart.height,
      };
      viewBoxRef.current = nextViewBox;
      setViewBox(nextViewBox);
    }
  }

  function handlePointerEnd(
    e: React.PointerEvent<SVGSVGElement>,
    cancelled = false
  ) {
    const nodePointerStart = nodePointerStartRef.current;
    if (
      !cancelled &&
      activePointersRef.current.size === 1 &&
      nodePointerStart?.pointerId === e.pointerId &&
      !nodePointerStart.dragged
    ) {
      focusNode(nodePointerStart.id);
    }
    activePointersRef.current.delete(e.pointerId);
    pinchStartRef.current = null;
    panStartRef.current = null;
    if (nodePointerStart?.pointerId === e.pointerId) {
      nodePointerStartRef.current = null;
      draggingIdRef.current = null;
      setDraggingId(null);
    }
    if (activePointersRef.current.size === 0) setPanning(false);
  }

  function zoomBy(factor: number) {
    const current = viewBoxRef.current;
    const width = Math.min(1800, Math.max(180, current.width * factor));
    const height = Math.min(1200, Math.max(120, current.height * factor));
    const centerX = current.x + current.width / 2;
    const centerY = current.y + current.height / 2;
    const nextViewBox = {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    };
    viewBoxRef.current = nextViewBox;
    setViewBox(nextViewBox);
  }

  function resetView() {
    const initialViewBox = { x: 0, y: 0, width: 900, height: 600 };
    viewBoxRef.current = initialViewBox;
    setViewBox(initialViewBox);
  }

  const nodeById = useMemo(
    () => new Map(visibleNodes.map((n) => [n.id, n])),
    [visibleNodes]
  );
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const selectedArea = selectedNode
    ? areaBySlug.get(selectedNode.area)
    : undefined;

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Network className="size-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-zinc-100">
            Mapa de Conocimiento
          </h2>
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
            {visibleNodes.length} notas · {visibleEdges.length} conexiones
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <label className="flex h-8 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-zinc-500 focus-within:border-zinc-600">
            <Search className="size-3.5 shrink-0" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar nodo…"
              aria-label="Buscar nodo"
              className="w-28 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600 sm:w-36"
            />
          </label>

          <button
            type="button"
            aria-pressed={hideOrphans}
            onClick={() => setHideOrphans((current) => !current)}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition ${
              hideOrphans
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {hideOrphans ? (
              <Eye className="size-3.5" />
            ) : (
              <EyeOff className="size-3.5" />
            )}
            {hideOrphans ? "Mostrar huérfanas" : "Ocultar huérfanas"}
          </button>

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
        ) : visibleNodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <Sparkles className="size-7 text-zinc-700" />
            <p className="mt-2 text-sm text-zinc-300">
              {hideOrphans
                ? "No hay notas conectadas para mostrar"
                : "Todavía no hay notas para graficar"}
            </p>
            <p className="mt-1 max-w-xs text-xs text-zinc-500">
              {hideOrphans
                ? "Desactivá «Ocultar huérfanas» para ver todas las notas."
                : "Usá [[Nombre de otra nota]] dentro de tus apuntes para conectar ideas automáticamente."}
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={(e) => handlePointerEnd(e, true)}
            onPointerLeave={() => {
              if (!panStartRef.current && !nodePointerStartRef.current) {
                setHoveredId(null);
              }
            }}
            className={`h-full w-full select-none ${
              panning || draggingId ? "cursor-grabbing" : "cursor-grab"
            }`}
            style={{ touchAction: "none" }}
          >
            {visibleEdges.map((edge, idx) => {
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
              if (!visibleNodeIds.has(node.id)) return null;
              const radius = 6 + Math.min(node.degree * 2.5, 10);
              const isHovered = hoveredId === node.id;
              const isConnected = connectedToHovered.has(node.id);
              const isSearchMatch =
                normalizedSearch.length > 0 &&
                node.title.toLocaleLowerCase().includes(normalizedSearch);
              const isSelected = selectedNodeId === node.id;
              const isDimmed =
                (Boolean(hoveredId) && !isConnected) ||
                (normalizedSearch.length > 0 && !isSearchMatch);
              const isEmphasized = isHovered || isSearchMatch || isSelected;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    beginPointer(e, node.id);
                  }}
                  onDoubleClick={() => onSelectNote(node.note)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="cursor-pointer transition-opacity duration-150"
                  style={{ opacity: isDimmed ? 0.2 : 1 }}
                >
                  {isSearchMatch || isSelected ? (
                    <circle
                      r={radius + 6}
                      fill="none"
                      stroke="#34d399"
                      strokeWidth={2}
                      strokeOpacity={isSelected ? 0.85 : 0.65}
                    />
                  ) : null}
                  <circle
                    r={isEmphasized ? radius + 3 : radius}
                    fill={areaBySlug.get(node.area)?.color ?? "#71717a"}
                    stroke={isSearchMatch || isSelected ? "#34d399" : "#09090b"}
                    strokeWidth={isSearchMatch || isSelected ? 3 : 2}
                  />
                  <text
                    y={radius + 14}
                    textAnchor="middle"
                    fill={isEmphasized ? "#ffffff" : "#a1a1aa"}
                    fontSize={isEmphasized ? 12 : 11}
                    fontWeight={isEmphasized ? 600 : 400}
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

        {selectedNode ? (
          <aside className="absolute right-4 top-4 z-20 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Inspección rápida
                </p>
                <h3 className="mt-1 truncate text-sm font-semibold text-zinc-100">
                  {selectedNode.title}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Cerrar inspección"
                onClick={() => setSelectedNodeId(null)}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 px-2 py-1 text-[10px] text-zinc-300">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{
                    backgroundColor: selectedArea?.color ?? "#71717a",
                  }}
                />
                {selectedArea?.name ?? selectedNode.area}
              </span>
              <span className="text-[10px] text-zinc-500">
                {selectedNode.degree}{" "}
                {selectedNode.degree === 1 ? "conexión" : "conexiones"}
              </span>
            </div>

            <p className="mt-3 text-xs leading-5 text-zinc-400">
              {getNoteExcerpt(selectedNode.note.content) ||
                "Esta nota todavía no tiene contenido."}
            </p>

            <div className="mt-4">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Notas conectadas
              </p>
              {connectedNodes.length > 0 ? (
                <ul className="max-h-28 space-y-1 overflow-y-auto">
                  {connectedNodes.map((connectedNode) => {
                    const area = areaBySlug.get(connectedNode.area);
                    return (
                      <li key={connectedNode.id}>
                        <button
                          type="button"
                          onClick={() => focusNode(connectedNode.id)}
                          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
                        >
                          <span className="min-w-0 truncate">
                            {connectedNode.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-zinc-500">
                            {area?.name ?? connectedNode.area}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-zinc-600">Sin conexiones.</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => onSelectNote(selectedNode.note)}
              className="mt-4 flex w-full items-center justify-center rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-300"
            >
              Abrir nota en editor
            </button>
          </aside>
        ) : null}

        <div className="absolute bottom-3 right-4 z-20 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/90 p-1 shadow-xl">
          <button
            type="button"
            aria-label="Alejar"
            title="Alejar"
            onClick={() => zoomBy(1.15)}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Acercar"
            title="Acercar"
            onClick={() => zoomBy(0.87)}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Plus className="size-3.5" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-zinc-800" />
          <button
            type="button"
            onClick={resetView}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <RotateCcw className="size-3.5" />
            Centrar
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-3 left-4 rounded-lg border border-zinc-800/80 bg-zinc-950/90 px-3 py-1.5 text-[11px] text-zinc-500">
          Rueda para zoom · Arrastrá el fondo para mover el lienzo · Arrastrá nodos para moverlos · Doble clic para abrir · Usá{" "}
          <span className="text-zinc-300">[[Título]]</span>
        </div>
      </div>
    </div>
  );
}