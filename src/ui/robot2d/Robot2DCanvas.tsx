import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useHexapodStore } from "../../store/useHexapodStore";
import { useProjectStore } from "../../store/useProjectStore";
import { useRobot2DStore, newShapeId } from "../../store/useRobot2DStore";
import { defaultAnchorsFromGeometry, segmentWidthsOf, type LegAnchor, type MeasureRef, type Pt2, type Shape2D } from "../../model/hexapod";
import { coxaServoDimsM, findServoType } from "../../model/servoTypes";
import { tessellateCircle } from "../../model/chassisBake";
import { commitHistory } from "../../store/useRobot2DHistory";
import { ringIssues } from "../../model/polygon";
import {
  bandPoly,
  circleInfo,
  coxaServoGeom,
  dirToYaw,
  legJointPoints,
  measureGeom,
  offsetFromPointer,
  pointInPoly,
  projectToSegment,
  resolveMeasureRef,
  screenToWorld,
  snapMeters,
  snapToVertices,
  worldToScreen,
  yawToDir,
  type MeasureCtx,
  type View,
} from "./canvas2d";

type Drag =
  | { kind: "anchor"; index: number }
  | { kind: "yaw"; index: number }
  | { kind: "servo"; servoId: number }
  | { kind: "coxaRot"; index: number }
  | { kind: "coxaMove"; index: number }
  | { kind: "measureOffset"; id: string }
  | { kind: "shapeMove"; id: string; ox: number; oz: number }
  | { kind: "shapeVertex"; id: string; i: number }
  | { kind: "draft" }
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number; button: number };

const JOINT_LABEL: Record<string, string> = { coxa: "C", femur: "F", tibia: "T" };
const DRAW_TOOLS = new Set(["pen", "rect", "circle", "measure"]);

/** Champ de dimension éditable : affiche la valeur live hors focus, applique à Entrée/blur. */
function DimField({ valueCm, onApply, title }: { valueCm: number; onApply: (cm: number) => void; title: string }) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");
  const apply = () => { const v = parseFloat(text.replace(",", ".")); if (v > 0) onApply(v); };
  return (
    <input
      className="r2d-dimedit-input"
      title={title}
      value={focused ? text : valueCm.toFixed(2)}
      onFocus={() => { setFocused(true); setText(valueCm.toFixed(2)); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { setFocused(false); apply(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { apply(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

export function Robot2DCanvas() {
  const geometry = useHexapodStore((s) => s.geometry);
  const setShapes = useHexapodStore((s) => s.setShapes);
  const setLegAnchor = useHexapodStore((s) => s.setLegAnchor);
  const setServoMarker = useHexapodStore((s) => s.setServoMarker);
  const setCoxaServoAngle = useHexapodStore((s) => s.setCoxaServoAngle);
  const addMeasurement = useHexapodStore((s) => s.addMeasurement);
  const updateMeasurement = useHexapodStore((s) => s.updateMeasurement);
  const removeMeasurement = useHexapodStore((s) => s.removeMeasurement);

  const tool = useRobot2DStore((s) => s.tool);
  const selected = useRobot2DStore((s) => s.selected);
  const select = useRobot2DStore((s) => s.select);
  const activeLayer = useRobot2DStore((s) => s.activeLayer);
  const selectedShapeId = useRobot2DStore((s) => s.selectedShapeId);
  const selectShape = useRobot2DStore((s) => s.selectShape);
  const selectedMeasureId = useRobot2DStore((s) => s.selectedMeasureId);
  const selectMeasure = useRobot2DStore((s) => s.selectMeasure);
  const setTool = useRobot2DStore((s) => s.setTool);
  const penPoints = useRobot2DStore((s) => s.penPoints);
  const setPenPoints = useRobot2DStore((s) => s.setPenPoints);
  const snapEnabled = useRobot2DStore((s) => s.snapEnabled);
  const snapStepCm = useRobot2DStore((s) => s.snapStepCm);
  const keyboardStepCm = useRobot2DStore((s) => s.keyboardStepCm);
  const showServos = useRobot2DStore((s) => s.showServos);
  const zoom = useRobot2DStore((s) => s.zoom);
  const setZoom = useRobot2DStore((s) => s.setZoom);
  const pan = useRobot2DStore((s) => s.pan);
  const setPan = useRobot2DStore((s) => s.setPan);
  const fitEpoch = useRobot2DStore((s) => s.fitEpoch);
  const pendingMeasure = useRobot2DStore((s) => s.pendingMeasure);
  const setPendingMeasure = useRobot2DStore((s) => s.setPendingMeasure);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const [snapHit, setSnapHit] = useState<{ x: number; z: number } | null>(null);
  const [axisLock, setAxisLock] = useState<"h" | "v" | null>(null);
  // Patte en cours de déplacement (servo coxa) → affiche les guides d'aimantation en croix.
  const [coxaDragIndex, setCoxaDragIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; shapeId: string } | null>(null);
  const [hoverShapeId, setHoverShapeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ a: Pt2; b: Pt2 } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // Liaison du 1er point de la cote en cours (le 2e est connu au clic de validation).
  const pendingRefRef = useRef<MeasureRef | undefined>(undefined);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const shapes = geometry.body2D?.shapes ?? [];
  const pieces = geometry.body2D?.pieces ?? [];
  const measurements = geometry.body2D?.measurements ?? [];
  const segments = geometry.segments;
  const markers = geometry.body2D?.servoMarkers;
  const coxaServos = geometry.body2D?.coxaServos;
  const anchors: LegAnchor[] = useMemo(() => {
    const a = geometry.body2D?.anchors;
    return a && a.length === 6 ? [...a].sort((p, q) => p.index - q.index) : defaultAnchorsFromGeometry(geometry);
  }, [geometry]);

  // Dimensions vue de dessus du servo coxa : déduites du type de servo du projet
  // (sinon gabarit générique). Le pignon = l'ancrage de la patte (axe coxa).
  const servoTypeId = useProjectStore((s) => s.activeProject?.hardware.servoTypeId);
  const customServoTypes = useProjectStore((s) => s.activeProject?.hardware.customServoTypes);
  const coxaDims = useMemo(
    () => coxaServoDimsM(findServoType(servoTypeId, customServoTypes ?? [])),
    [servoTypeId, customServoTypes]
  );
  const coxaAngle = (index: number) =>
    coxaServos?.find((c) => c.legIndex === index)?.angleOffsetDeg ?? 0;

  // Cibles d'accroche pour le déplacement d'un servo coxa : sommets, milieux
  // d'arêtes (= centres des bords) et centre de chaque forme/morceau de châssis.
  const coxaSnapPoints = useMemo(() => {
    const out: Pt2[] = [];
    const addRing = (ring: Pt2[]) => {
      const n = ring.length;
      if (!n) return;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < n; i++) {
        const p = ring[i], q = ring[(i + 1) % n];
        out.push(p);
        out.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
      out.push({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 });
    };
    for (const s of shapes) addRing(s.poly);
    for (const pc of pieces) { addRing(pc.outer); for (const h of pc.holes) addRing(h); }
    return out;
  }, [shapes, pieces]);

  // Zones (formes réelles) pour l'aimantation au centre vertical de la barre survolée.
  const coxaRegions = useMemo(
    () =>
      shapes
        .filter((s) => s.layer === "real" && s.poly.length >= 3)
        .map((s) => {
          const xs = s.poly.map((p) => p.x);
          return { poly: s.poly, cx: (Math.min(...xs) + Math.max(...xs)) / 2 };
        }),
    [shapes]
  );

  // Étendue du contenu (m) pour l'ajustement automatique.
  const contentHalf = useMemo(() => {
    let hx = 0.1, hz = 0.1;
    const acc = (p: Pt2) => { hx = Math.max(hx, Math.abs(p.x)); hz = Math.max(hz, Math.abs(p.z)); };
    for (const s of shapes) for (const p of s.poly) acc(p);
    const reach = segments.coxa + segments.femur + segments.tibia;
    for (const a of anchors) {
      const { dx, dz } = yawToDir(a.yawDeg);
      hx = Math.max(hx, Math.abs(a.x) + Math.abs(dx) * reach);
      hz = Math.max(hz, Math.abs(a.z) + Math.abs(dz) * reach);
    }
    return { hx: hx + 0.04, hz: hz + 0.04 };
  }, [shapes, anchors, segments]);

  const contentHalfRef = useRef(contentHalf);
  contentHalfRef.current = contentHalf;
  const [fitScale, setFitScale] = useState(1);
  useEffect(() => {
    const margin = 24;
    const availW = Math.max(50, size.w - margin * 2);
    const availH = Math.max(50, size.h - margin * 2);
    const ch = contentHalfRef.current;
    setFitScale(Math.min(availW / (ch.hz * 2), availH / (ch.hx * 2)));
  }, [size, fitEpoch]);

  const view: View = useMemo(
    () => ({ cx: size.w / 2 + pan.x, cy: size.h / 2 + pan.y, scale: fitScale * zoom }),
    [size, fitScale, zoom, pan]
  );

  // Sommets de toutes les formes (aimantation point-à-point).
  const allVerts = useMemo(() => shapes.flatMap((s) => s.poly), [shapes]);

  // Cibles d'accroche ponctuelles de l'outil mesure, chacune porteuse de sa liaison
  // (le point de cote s'y rattache) : sommets de formes, pignon coxa, articulations
  // fémur/tibia, pied. Les extrémités d'autres cotes restent des points libres.
  const snapPoints = useMemo(() => {
    const pts: { x: number; z: number; ref?: MeasureRef }[] = [];
    for (const s of shapes) s.poly.forEach((p, i) => pts.push({ x: p.x, z: p.z, ref: { kind: "shapeVertex", shapeId: s.id, index: i } }));
    for (const a of anchors) {
      pts.push({ x: a.x, z: a.z, ref: { kind: "coxaPinion", leg: a.index } });
      const { joints, foot } = legJointPoints(a, segments, markers);
      pts.push({ x: joints[1].x, z: joints[1].z, ref: { kind: "legJoint", leg: a.index, joint: "femur" } });
      pts.push({ x: joints[2].x, z: joints[2].z, ref: { kind: "legJoint", leg: a.index, joint: "tibia" } });
      pts.push({ x: foot.x, z: foot.z, ref: { kind: "legFoot", leg: a.index } });
    }
    for (const m of measurements) { pts.push({ x: m.a.x, z: m.a.z }); pts.push({ x: m.b.x, z: m.b.z }); }
    return pts;
  }, [shapes, anchors, segments, markers, measurements]);

  const rawWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return screenToWorld(clientX - rect.left, clientY - rect.top, view);
  };
  const snapWorld = (w: Pt2, excludeId?: string): Pt2 => {
    let p = w;
    if (snapEnabled) p = { x: snapMeters(p.x, snapStepCm), z: snapMeters(p.z, snapStepCm) };
    const verts = excludeId ? shapes.filter((s) => s.id !== excludeId).flatMap((s) => s.poly) : allVerts;
    return snapToVertices(p, verts, 10, view);
  };
  const toWorld = (cx: number, cy: number, excludeId?: string) => snapWorld(rawWorld(cx, cy), excludeId);

  // Accroche dédiée au déplacement d'un servo coxa : 1) point cible le plus proche
  // (sommet / milieu de bord / centre) ≤ 12 px ; 2) aimantation croisée aux autres
  // pignons coxa (X et Z indépendants) → leurs lignes-guides se superposent ; 3) sinon,
  // si le pointeur est dans une barre du châssis, on aimante le centre vertical (X) de
  // cette barre ; 4) grille. `dragIndex` = patte tirée, exclue de l'aimantation croisée.
  const COXA_ALIGN_PX = 10;
  const snapCoxa = (cx: number, cy: number, dragIndex: number): { p: Pt2; hit: boolean } => {
    const raw = rawWorld(cx, cy);
    const ps = worldToScreen(raw.x, raw.z, view);
    // 1) Point précis du châssis : verrouille les deux axes (prioritaire).
    let best: Pt2 | null = null, bestD = 12;
    for (const t of coxaSnapPoints) {
      const s = worldToScreen(t.x, t.z, view);
      const d = Math.hypot(s.sx - ps.sx, s.sy - ps.sy);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) return { p: best, hit: true };
    // 2) Point de départ : centre X de la barre survolée, sinon grille / brut.
    let out: Pt2;
    let hit = false;
    const region = coxaRegions.find((r) => pointInPoly(raw, r.poly));
    if (region) { out = { x: region.cx, z: snapEnabled ? snapMeters(raw.z, snapStepCm) : raw.z }; hit = true; }
    else if (snapEnabled) out = { x: snapMeters(raw.x, snapStepCm), z: snapMeters(raw.z, snapStepCm) };
    else out = { x: raw.x, z: raw.z };
    // 3) Aimantation croisée aux autres pignons coxa, X et Z séparément. Même X monde
    //    ⇒ lignes horizontales superposées ; même Z monde ⇒ lignes verticales superposées.
    let bestDX = COXA_ALIGN_PX, bestDZ = COXA_ALIGN_PX;
    for (const a of anchors) {
      if (a.index === dragIndex) continue;
      const s = worldToScreen(a.x, a.z, view);
      const dh = Math.abs(s.sy - ps.sy); // même X monde ⇒ même y écran
      if (dh < bestDX) { bestDX = dh; out = { x: a.x, z: out.z }; hit = true; }
      const dv = Math.abs(s.sx - ps.sx); // même Z monde ⇒ même x écran
      if (dv < bestDZ) { bestDZ = dv; out = { x: out.x, z: a.z }; hit = true; }
    }
    return { p: out, hit };
  };

  const bboxCenter = (poly: Pt2[]): Pt2 => {
    const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  };

  // Bords (segments) aimantables pour l'outil mesure : arêtes du châssis (formes +
  // morceaux bakés) et de chaque partie de patte (bandes coxa/fémur/tibia + corps
  // du servo coxa). `mkRef(edge, t)` produit la liaison du point posé sur ce bord
  // (le point suivra l'arête). Les morceaux bakés (regénérés) restent libres.
  const snapEdges = useMemo(() => {
    const edges: { a: Pt2; b: Pt2; mkRef?: (t: number) => MeasureRef }[] = [];
    const addRing = (ring: Pt2[], mk?: (edge: number, t: number) => MeasureRef) => {
      const n = ring.length;
      for (let i = 0; i < n; i++) edges.push({ a: ring[i], b: ring[(i + 1) % n], mkRef: mk ? (t) => mk(i, t) : undefined });
    };
    for (const s of shapes) addRing(s.poly, (edge, t) => ({ kind: "shapeEdge", shapeId: s.id, edge, t }));
    for (const pc of pieces) { addRing(pc.outer); for (const h of pc.holes) addRing(h); }
    for (const a of anchors) {
      const { joints, foot } = legJointPoints(a, segments, markers);
      const segW = segmentWidthsOf(geometry, a.index);
      addRing(bandPoly(joints[0], joints[1], segW.coxa), (edge, t) => ({ kind: "legEdge", leg: a.index, part: "coxa", edge, t }));
      addRing(bandPoly(joints[1], joints[2], segW.femur), (edge, t) => ({ kind: "legEdge", leg: a.index, part: "femur", edge, t }));
      addRing(bandPoly(joints[2], foot, segW.tibia), (edge, t) => ({ kind: "legEdge", leg: a.index, part: "tibia", edge, t }));
      if (showServos) addRing(coxaServoGeom(a, coxaDims, coxaAngle(a.index)).corners, (edge, t) => ({ kind: "coxaBodyEdge", leg: a.index, edge, t }));
    }
    return edges;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, pieces, anchors, segments, markers, geometry, coxaDims, coxaServos, showServos]);

  // Contexte de résolution des liaisons : recalcule la position monde d'un point lié
  // depuis l'état courant (appelé au rendu de chaque cote → suit le mouvement).
  const measureCtx = useMemo<MeasureCtx>(() => {
    const anchorOf = (leg: number) => anchors.find((a) => a.index === leg) ?? null;
    return {
      coxaPinion: (leg) => { const a = anchorOf(leg); return a ? { x: a.x, z: a.z } : null; },
      legJoint: (leg, joint) => {
        const a = anchorOf(leg);
        if (!a) return null;
        const j = legJointPoints(a, segments, markers).joints.find((x) => x.joint === joint);
        return j ? { x: j.x, z: j.z } : null;
      },
      legFoot: (leg) => { const a = anchorOf(leg); return a ? legJointPoints(a, segments, markers).foot : null; },
      legBandCorners: (leg, part) => {
        const a = anchorOf(leg);
        if (!a) return null;
        const { joints, foot } = legJointPoints(a, segments, markers);
        const segW = segmentWidthsOf(geometry, leg);
        if (part === "coxa") return bandPoly(joints[0], joints[1], segW.coxa);
        if (part === "femur") return bandPoly(joints[1], joints[2], segW.femur);
        return bandPoly(joints[2], foot, segW.tibia);
      },
      coxaBodyCorners: (leg) => { const a = anchorOf(leg); return a ? coxaServoGeom(a, coxaDims, coxaAngle(leg)).corners : null; },
      shapePoly: (shapeId) => shapes.find((s) => s.id === shapeId)?.poly ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, segments, markers, geometry, coxaDims, coxaServos, shapes]);

  // Cibles d'accroche pour le CENTRE d'une forme déplacée : sommets, milieux
  // d'arêtes (= centres des côtés d'un rectangle) et centre de chaque autre forme.
  const centerSnapTargets = (excludeId: string): Pt2[] => {
    const out: Pt2[] = [];
    for (const s of shapes) {
      if (s.id === excludeId || s.poly.length === 0) continue;
      const n = s.poly.length;
      for (let i = 0; i < n; i++) {
        out.push(s.poly[i]);
        const b = s.poly[(i + 1) % n];
        out.push({ x: (s.poly[i].x + b.x) / 2, z: (s.poly[i].z + b.z) / 2 });
      }
      out.push(bboxCenter(s.poly));
    }
    return out;
  };

  // Accroche un point candidat (centre de forme) : cible la plus proche ≤ 12 px,
  // sinon grille. Renvoie le point + si une accroche a eu lieu.
  const snapCenter = (p: Pt2, excludeId: string): { p: Pt2; hit: boolean } => {
    const ps = worldToScreen(p.x, p.z, view);
    let best: Pt2 | null = null, bestD = 12;
    for (const t of centerSnapTargets(excludeId)) {
      const s = worldToScreen(t.x, t.z, view);
      const d = Math.hypot(s.sx - ps.sx, s.sy - ps.sy);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) return { p: best, hit: true };
    if (snapEnabled) return { p: { x: snapMeters(p.x, snapStepCm), z: snapMeters(p.z, snapStepCm) }, hit: false };
    return { p, hit: false };
  };

  // Accroche mesure, par ordre de priorité : 1) point cible précis (sommet, pignon
  // coxa, articulation, extrémité de cote) ≤ 12 px ; 2) bord de châssis ou de patte
  // (accroche sur la ligne) ≤ 8 px ; 3) grille. `ref` = liaison de l'accroche, si
  // l'élément est mobile (le point de cote la suivra ensuite).
  const snapMeasure = (cx: number, cy: number): { p: Pt2; hit: boolean; ref?: MeasureRef } => {
    const raw = rawWorld(cx, cy);
    const ps = worldToScreen(raw.x, raw.z, view);
    let best: { x: number; z: number; ref?: MeasureRef } | null = null;
    let bestD = 12;
    for (const t of snapPoints) {
      const s = worldToScreen(t.x, t.z, view);
      const d = Math.hypot(s.sx - ps.sx, s.sy - ps.sy);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) return { p: { x: best.x, z: best.z }, hit: true, ref: best.ref };
    let bestEdge: Pt2 | null = null;
    let bestED = 8;
    let bestRef: MeasureRef | undefined;
    for (const e of snapEdges) {
      const f = projectToSegment(raw, e.a, e.b, view);
      if (f.dPx < bestED) { bestED = f.dPx; bestEdge = f.pt; bestRef = e.mkRef?.(f.t); }
    }
    if (bestEdge) return { p: bestEdge, hit: true, ref: bestRef };
    const step = snapEnabled ? snapStepCm : 0.1; // au moins 1 mm
    return { p: { x: snapMeters(raw.x, step), z: snapMeters(raw.z, step) }, hit: false };
  };

  // Point de mesure final : accroche point/grille puis verrouillage d'axe
  // (horizontal/vertical) par rapport au point de départ, si proche d'un axe. Le
  // verrouillage d'axe déplace le point hors de l'accroche → la liaison est levée.
  const measurePoint = (cx: number, cy: number): { p: Pt2; hit: boolean; axis: "h" | "v" | null; ref?: MeasureRef } => {
    const { p, hit, ref } = snapMeasure(cx, cy);
    if (pendingMeasure && !hit) {
      const dx = p.x - pendingMeasure.x, dz = p.z - pendingMeasure.z;
      const adx = Math.abs(dx), adz = Math.abs(dz);
      const T = Math.tan((5 * Math.PI) / 180); // tolérance ~5°
      if (adx > 1e-4 || adz > 1e-4) {
        // Horizontal écran = X monde constant ; vertical écran = Z monde constant.
        if (adx <= adz * T) return { p: { x: pendingMeasure.x, z: p.z }, hit, axis: "h" };
        if (adz <= adx * T) return { p: { x: p.x, z: pendingMeasure.z }, hit, axis: "v" };
      }
    }
    return { p, hit, axis: null, ref };
  };

  // ── Édition des formes ─────────────────────────────────────────────────────
  const replaceShape = (id: string, poly: Pt2[]) =>
    setShapes(shapes.map((s) => (s.id === id ? { ...s, poly } : s)));

  const addShape = (poly: Pt2[]) => {
    const sh: Shape2D = { id: newShapeId(), layer: activeLayer, op: "add", poly };
    setShapes([...shapes, sh]);
    selectShape(sh.id);
    commitHistory("Forme ajoutée");
  };

  // Menu contextuel d'une forme (clic droit).
  const openShapeMenu = (clientX: number, clientY: number, shapeId: string) => {
    const r = wrapRef.current?.getBoundingClientRect();
    setMenu({ x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0), shapeId });
    selectShape(shapeId);
  };
  // Ramène le centre de la boîte englobante de la forme à l'origine (0,0).
  const centerShape = (id: string) => {
    const sh = shapes.find((s) => s.id === id);
    if (sh && sh.poly.length) {
      const xs = sh.poly.map((p) => p.x), zs = sh.poly.map((p) => p.z);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      replaceShape(id, sh.poly.map((p) => ({ x: p.x - cx, z: p.z - cz })));
      commitHistory("Forme centrée");
    }
    setMenu(null);
  };
  const deleteShapeMenu = (id: string) => {
    setShapes(shapes.filter((s) => s.id !== id));
    if (selectedShapeId === id) selectShape(null);
    commitHistory("Forme supprimée");
    setMenu(null);
  };
  // Redimensionne une forme via l'étiquette : met à l'échelle l'axe demandé
  // ('w' = largeur Z, 'h' = hauteur X) autour du centre de sa boîte englobante.
  const resizeShapeDim = (id: string, axis: "w" | "h", newCm: number) => {
    const sh = shapes.find((s) => s.id === id);
    if (!sh || sh.poly.length === 0) return;
    const xs = sh.poly.map((p) => p.x), zs = sh.poly.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const target = newCm / 100;
    if (axis === "w") {
      const cur = maxZ - minZ; if (cur < 1e-5) return;
      const cz = (minZ + maxZ) / 2, f = target / cur;
      replaceShape(id, sh.poly.map((p) => ({ x: p.x, z: cz + (p.z - cz) * f })));
    } else {
      const cur = maxX - minX; if (cur < 1e-5) return;
      const cx = (minX + maxX) / 2, f = target / cur;
      replaceShape(id, sh.poly.map((p) => ({ x: cx + (p.x - cx) * f, z: p.z })));
    }
    commitHistory("Dimension forme");
  };

  // Duplique la forme avec un décalage de +5 cm à droite (Z) et 5 cm vers le bas (X−).
  const duplicateShape = (id: string) => {
    const sh = shapes.find((s) => s.id === id);
    if (sh) {
      const poly = sh.poly.map((p) => ({ x: p.x - 0.05, z: p.z + 0.05 }));
      const ns: Shape2D = { id: newShapeId(), layer: sh.layer, op: sh.op, poly };
      setShapes([...shapes, ns]);
      selectShape(ns.id);
      commitHistory("Forme dupliquée");
    }
    setMenu(null);
  };

  // Place la forme sur un calque : virtuel (arrière, gabarit gris) ou réel (avant, jaune).
  const setShapeLayer = (id: string, layer: "real" | "virtual") => {
    const sh = shapes.find((s) => s.id === id);
    if (sh && sh.layer !== layer) {
      setShapes(shapes.map((s) => (s.id === id ? { ...s, layer } : s)));
      commitHistory(layer === "virtual" ? "Mise en arrière" : "Mise en avant");
    }
    setMenu(null);
  };

  // Redimensionne un cercle (mise à l'échelle uniforme autour du centre) au diamètre donné.
  const resizeCircleDiam = (id: string, newDiamCm: number) => {
    const sh = shapes.find((s) => s.id === id);
    const circ = sh && circleInfo(sh.poly);
    if (sh && circ && circ.radius > 1e-5) {
      const f = (newDiamCm / 200) / circ.radius;
      replaceShape(id, sh.poly.map((p) => ({ x: circ.cx + (p.x - circ.cx) * f, z: circ.cz + (p.z - circ.cz) * f })));
      commitHistory("Diamètre cercle");
    }
  };

  // Copie miroir de la forme par rapport à l'axe central (origine 0,0).
  // 'h' = axe horizontal (reflète X, avant/arrière) ; 'v' = axe vertical (reflète Z, gauche/droite).
  const mirrorShape = (id: string, axis: "h" | "v") => {
    const sh = shapes.find((s) => s.id === id);
    if (sh && sh.poly.length) {
      const poly = sh.poly.map((p) => (axis === "h" ? { x: -p.x, z: p.z } : { x: p.x, z: -p.z }));
      const ns: Shape2D = { id: newShapeId(), layer: sh.layer, op: sh.op, poly };
      setShapes([...shapes, ns]);
      selectShape(ns.id);
      commitHistory("Symétrie créée");
    }
    setMenu(null);
  };

  // ── Drag global ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        if (d.kind === "pan") { setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) }); return; }
        if (d.kind === "draft") { setDraft((dr) => (dr ? { ...dr, b: snapWorld(rawWorld(e.clientX, e.clientY)) } : dr)); return; }
        const w = toWorld(e.clientX, e.clientY, d.kind === "shapeVertex" ? d.id : undefined);
        if (d.kind === "anchor") {
          const { p, hit } = snapCoxa(e.clientX, e.clientY, d.index);
          setLegAnchor(d.index, { x: p.x, z: p.z });
          setSnapHit(hit ? p : null);
        }
        else if (d.kind === "yaw") {
          const a = anchors[d.index];
          const yaw = dirToYaw(w.x - a.x, w.z - a.z);
          setLegAnchor(d.index, { yawDeg: snapEnabled ? Math.round(yaw) : yaw });
        } else if (d.kind === "servo") setServoMarker(d.servoId, { x: w.x, z: w.z });
        else if (d.kind === "coxaMove") {
          const { p, hit } = snapCoxa(e.clientX, e.clientY, d.index);
          setLegAnchor(d.index, { x: p.x, z: p.z });
          setSnapHit(hit ? p : null);
        } else if (d.kind === "coxaRot") {
          const a = anchors[d.index];
          // Offset = angle (pointeur−pignon) ramené à l'orientation par défaut (yaw patte).
          let off = dirToYaw(w.x - a.x, w.z - a.z) - a.yawDeg;
          off = ((off + 180) % 360 + 360) % 360 - 180; // → [-180,180]
          setCoxaServoAngle(d.index, snapEnabled ? Math.round(off) : off);
        }
        else if (d.kind === "measureOffset") {
          const m = (useHexapodStore.getState().geometry.body2D?.measurements ?? []).find((x) => x.id === d.id);
          if (m) {
            const ra = resolveMeasureRef(m.aRef, m.a, measureCtx);
            const rb = resolveMeasureRef(m.bRef, m.b, measureCtx);
            updateMeasurement(d.id, { offset: offsetFromPointer(ra, rb, w) });
          }
        } else if (d.kind === "shapeVertex") {
          const sh = shapes.find((s) => s.id === d.id);
          if (sh) replaceShape(d.id, sh.poly.map((p, k) => (k === d.i ? w : p)));
        } else if (d.kind === "shapeMove") {
          const sh = shapes.find((s) => s.id === d.id);
          if (sh) {
            const raw = rawWorld(e.clientX, e.clientY);
            // Centre visé = pointeur − offset de saisie, puis accroche du centre.
            const { p: snapped, hit } = snapCenter({ x: raw.x - d.ox, z: raw.z - d.oz }, d.id);
            const c = bboxCenter(sh.poly);
            const dx = snapped.x - c.x, dz = snapped.z - c.z;
            if (dx || dz) replaceShape(d.id, sh.poly.map((p) => ({ x: p.x + dx, z: p.z + dz })));
            setSnapHit(hit ? snapped : null);
          }
        }
        return;
      }
      if (tool === "pen" && penPoints.length > 0) {
        setHover(snapWorld(rawWorld(e.clientX, e.clientY)));
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      // Clic droit bref (sans déplacement) en mode mesure ⇒ retour au mode sélection.
      if (d.kind === "pan" && d.button === 2 && tool === "measure"
          && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) {
        setTool("select");
        return;
      }
      if (d.kind === "draft" && draft) {
        finalizeDraft(draft);
        setDraft(null);
      } else if (d.kind === "anchor") { commitHistory("Ancrage déplacé"); setSnapHit(null); setCoxaDragIndex(null); }
      else if (d.kind === "yaw") commitHistory("Orientation patte");
      else if (d.kind === "servo") commitHistory("Servo déplacé");
      else if (d.kind === "coxaMove") { commitHistory("Servo coxa déplacé"); setSnapHit(null); setCoxaDragIndex(null); }
      else if (d.kind === "coxaRot") commitHistory("Servo coxa orienté");
      else if (d.kind === "shapeVertex") commitHistory("Sommet déplacé");
      else if (d.kind === "shapeMove") { commitHistory("Forme déplacée"); setSnapHit(null); }
      else if (d.kind === "measureOffset") commitHistory("Cote décalée");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  });

  // Raccourcis : Entrée ferme le crayon, Échap annule, Suppr supprime la forme.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Enter" && tool === "pen" && penPoints.length >= 3) { addShape(penPoints); setPenPoints([]); }
      else if (e.key === "Escape") { setPenPoints([]); setDraft(null); selectShape(null); selectMeasure(null); setMenu(null); }
      else if (e.key === "Delete" && selectedShapeId) {
        setShapes(shapes.filter((s) => s.id !== selectedShapeId));
        selectShape(null);
        commitHistory("Forme supprimée");
      }
      else if (e.key === "Delete" && selectedMeasureId) {
        removeMeasurement(selectedMeasureId);
        selectMeasure(null);
        commitHistory("Mesure supprimée");
      }
      // Déplacement fin de la forme sélectionnée aux flèches (pas clavier).
      else if (selectedShapeId && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const sh = shapes.find((s) => s.id === selectedShapeId);
        if (!sh) return;
        e.preventDefault();
        const d = keyboardStepCm / 100; // m
        // Écran : haut = +X (avant), droite = +Z.
        const dx = e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0;
        const dz = e.key === "ArrowRight" ? d : e.key === "ArrowLeft" ? -d : 0;
        setShapes(shapes.map((s) => (s.id === selectedShapeId ? { ...s, poly: s.poly.map((p) => ({ x: p.x + dx, z: p.z + dz })) } : s)));
        commitHistory("Forme déplacée (clavier)");
      }
      // Patte sélectionnée (sans forme) : les flèches déplacent son servo coxa
      // (= l'ancrage, le pignon suit). Même mapping écran que pour les formes.
      else if (selected?.type === "leg" && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const a = anchors.find((an) => an.index === selected.index);
        if (!a) return;
        e.preventDefault();
        const d = keyboardStepCm / 100;
        const dx = e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0;
        const dz = e.key === "ArrowRight" ? d : e.key === "ArrowLeft" ? -d : 0;
        setLegAnchor(selected.index, { x: a.x + dx, z: a.z + dz });
        commitHistory("Servo coxa déplacé (clavier)");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Rayon d'un cercle d'aperçu, le DIAMÈTRE étant aimanté à la grille (valeurs propres).
  const draftRadius = (a: Pt2, b: Pt2): number => {
    const r = Math.hypot(b.x - a.x, b.z - a.z);
    if (!snapEnabled) return r;
    const step = snapStepCm / 100;
    return (Math.round((2 * r) / step) * step) / 2;
  };

  const finalizeDraft = (d: { a: Pt2; b: Pt2 }) => {
    if (tool === "rect") {
      const minX = Math.min(d.a.x, d.b.x), maxX = Math.max(d.a.x, d.b.x);
      const minZ = Math.min(d.a.z, d.b.z), maxZ = Math.max(d.a.z, d.b.z);
      if (maxX - minX < 0.005 || maxZ - minZ < 0.005) return;
      addShape([{ x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }, { x: minX, z: minZ }]);
    } else if (tool === "circle") {
      const r = draftRadius(d.a, d.b);
      if (r < 0.005) return;
      addShape(tessellateCircle(d.a.x, d.a.z, r));
    }
  };

  const onWheel = (e: React.WheelEvent) => setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));

  // Clic sur le fond, selon l'outil.
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (menu) setMenu(null); // tout clic ferme le menu contextuel
    // Clic droit ou Ctrl+clic gauche = panoramique, quel que soit l'outil
    // (permet de déplacer la vue pendant le tracé au crayon).
    if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
      dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, button: e.button };
      return;
    }
    if (e.button !== 0) return;
    if (tool === "measure") {
      const { p, ref } = measurePoint(e.clientX, e.clientY);
      if (!pendingMeasure) { setPendingMeasure(p); pendingRefRef.current = ref; }
      else { addMeasurement(pendingMeasure, p, pendingRefRef.current, ref); pendingRefRef.current = undefined; setPendingMeasure(null); setAxisLock(null); commitHistory("Mesure ajoutée"); }
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (tool === "pen") {
      // Clic près du 1er point ⇒ ferme la forme.
      if (penPoints.length >= 3) {
        const f = worldToScreen(penPoints[0].x, penPoints[0].z, view);
        const s = worldToScreen(w.x, w.z, view);
        if (Math.hypot(f.sx - s.sx, f.sy - s.sy) < 12) { addShape(penPoints); setPenPoints([]); return; }
      }
      setPenPoints([...penPoints, w]);
      return;
    }
    if (tool === "rect" || tool === "circle") {
      setDraft({ a: w, b: w });
      dragRef.current = { kind: "draft" };
      return;
    }
    // select / servo : clic dans le vide = désélection + panoramique
    if (tool === "select") { selectShape(null); select(null); }
    dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, button: e.button };
  };

  const onSvgMove = (e: React.PointerEvent) => {
    if (tool === "measure") {
      const { p, hit, axis } = measurePoint(e.clientX, e.clientY);
      setHover(p); setSnapHit(hit ? p : null); setAxisLock(pendingMeasure ? axis : null);
    } else if (DRAW_TOOLS.has(tool)) {
      setHover(snapWorld(rawWorld(e.clientX, e.clientY)));
    }
  };
  const onSvgDouble = (e: React.MouseEvent) => {
    if (tool === "pen" && penPoints.length >= 3) { e.stopPropagation(); addShape(penPoints); setPenPoints([]); }
  };

  // ── Géométrie d'affichage ──────────────────────────────────────────────────
  // Étiquette de dimensions (rectangle + texte) centrée en (cx, y).
  const dimBadge = (cx: number, y: number, text: string) => {
    const w = text.length * 6.6 + 14;
    return (
      <g className="r2d-dim-badge" transform={`translate(${cx} ${y})`}>
        <rect x={-w / 2} y={-11} width={w} height={20} rx={4} />
        <text textAnchor="middle" y={3}>{text}</text>
      </g>
    );
  };

  const polyStr = (pts: Pt2[]) => pts.map((p) => { const s = worldToScreen(p.x, p.z, view); return `${s.sx.toFixed(1)},${s.sy.toFixed(1)}`; }).join(" ");
  const piecePath = (outer: Pt2[], holes: Pt2[][]) =>
    [outer, ...holes].map((r) => r.map((p, k) => { const s = worldToScreen(p.x, p.z, view); return `${k === 0 ? "M" : "L"}${s.sx.toFixed(1)} ${s.sy.toFixed(1)}`; }).join(" ") + " Z").join(" ");

  const passthrough = DRAW_TOOLS.has(tool);

  // Grille hiérarchique en centimètres : pas mineur choisi selon le zoom
  // (0,5 cm quand on zoome assez, sinon 1, 2, 5…). Emphase croissante aux
  // multiples de 1 cm (medium) puis de 5 cm (major).
  const pxPerCm = view.scale / 100;
  const STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const minorCm = STEPS.find((s) => s * pxPerCm >= 9) ?? 100;
  const gridLines: JSX.Element[] = [];
  if (pxPerCm > 0.05 && isFinite(pxPerCm)) {
    const cls = (c: number) => {
      const r = Math.round(c * 1000) / 1000;
      if (Math.abs(r / 5 - Math.round(r / 5)) < 1e-4) return "r2d-grid-major";
      if (Math.abs(r - Math.round(r)) < 1e-4) return "r2d-grid-medium";
      return "r2d-grid-line";
    };
    const CAP = 1200;
    // Lignes verticales = Z monde constant ; horizontales = X monde constant.
    const zMin = ((0 - view.cx) / view.scale) * 100, zMax = ((size.w - view.cx) / view.scale) * 100;
    const xMin = ((view.cy - size.h) / view.scale) * 100, xMax = ((view.cy - 0) / view.scale) * 100;
    const startZ = Math.ceil(zMin / minorCm) * minorCm;
    const startX = Math.ceil(xMin / minorCm) * minorCm;
    for (let i = 0; i < CAP; i++) {
      const c = startZ + i * minorCm;
      if (c > zMax + 1e-6) break;
      const sx = view.cx + (c / 100) * view.scale;
      gridLines.push(<line key={`gv${c.toFixed(2)}`} x1={sx} y1={0} x2={sx} y2={size.h} className={cls(c)} />);
    }
    for (let i = 0; i < CAP; i++) {
      const c = startX + i * minorCm;
      if (c > xMax + 1e-6) break;
      const sy = view.cy - (c / 100) * view.scale;
      gridLines.push(<line key={`gh${c.toFixed(2)}`} x1={0} y1={sy} x2={size.w} y2={sy} className={cls(c)} />);
    }
  }

  const onShapeDown = (e: React.PointerEvent, sh: Shape2D) => {
    if (tool !== "select") return;
    // Clic droit sur la forme : on bloque le panoramique, le menu s'ouvre via onContextMenu.
    if (e.button === 2) { e.stopPropagation(); return; }
    // Ctrl+clic : on laisse remonter au fond pour panoramiquer.
    if (e.ctrlKey) return;
    e.stopPropagation();
    selectShape(sh.id);
    // Offset entre le point saisi et le centre de la forme (pour snapper le centre).
    const raw = rawWorld(e.clientX, e.clientY);
    const c = bboxCenter(sh.poly);
    dragRef.current = { kind: "shapeMove", id: sh.id, ox: raw.x - c.x, oz: raw.z - c.z };
  };

  return (
    <div className="r2d-canvas-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`r2d-canvas${tool === "measure" ? " measuring" : ""}${passthrough ? " passthrough" : ""}${tool === "pen" || tool === "rect" || tool === "circle" ? " drawing" : ""}${selected?.type === "leg" ? " leg-selected" : ""}`}
        width={size.w}
        height={size.h}
        onWheel={onWheel}
        onPointerDown={onBackgroundDown}
        onPointerMove={onSvgMove}
        onDoubleClick={onSvgDouble}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <marker id="r2d-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto-start-reverse">
            <path d="M0,0 L6,3 L0,6 Z" className="r2d-dim-arrow-head" />
          </marker>
        </defs>
        <g>{gridLines}</g>
        <line x1={view.cx} y1={0} x2={view.cx} y2={size.h} className="r2d-axis" />
        <line x1={0} y1={view.cy} x2={size.w} y2={view.cy} className="r2d-axis" />

        {/* Formes virtuelles (gabarit gris, dessous) */}
        {shapes.filter((s) => s.layer === "virtual").map((s) => (
          <polygon key={s.id} points={polyStr(s.poly)}
            className={`r2d-shape virtual${selectedShapeId === s.id ? " selected" : ""}`}
            onPointerDown={(e) => onShapeDown(e, s)}
            onPointerEnter={() => tool === "select" && setHoverShapeId(s.id)}
            onPointerLeave={() => setHoverShapeId((id) => (id === s.id ? null : id))}
            onContextMenu={(e) => { if (tool === "select") { e.preventDefault(); e.stopPropagation(); openShapeMenu(e.clientX, e.clientY, s.id); } }} />
        ))}

        {/* Masque réel baké (morceaux fusionnés) */}
        {pieces.map((pc, i) => (
          <path key={`pc${i}`} d={piecePath(pc.outer, pc.holes)} fillRule="evenodd" className="r2d-piece" />
        ))}

        {/* Formes réelles (matière / découpe) — éditables */}
        {shapes.filter((s) => s.layer === "real").map((s) => (
          <polygon key={s.id} points={polyStr(s.poly)}
            className={`r2d-shape real ${s.op}${selectedShapeId === s.id ? " selected" : ""}`}
            onPointerDown={(e) => onShapeDown(e, s)}
            onPointerEnter={() => tool === "select" && setHoverShapeId(s.id)}
            onPointerLeave={() => setHoverShapeId((id) => (id === s.id ? null : id))}
            onContextMenu={(e) => { if (tool === "select") { e.preventDefault(); e.stopPropagation(); openShapeMenu(e.clientX, e.clientY, s.id); } }} />
        ))}

        {/* Indicateur de centre des cercles */}
        {shapes.map((s) => {
          const c = circleInfo(s.poly);
          if (!c) return null;
          const p = worldToScreen(c.cx, c.cz, view);
          return (
            <g key={`cc${s.id}`} className="r2d-circle-center-mark">
              <line x1={p.sx - 6} y1={p.sy} x2={p.sx + 6} y2={p.sy} />
              <line x1={p.sx} y1={p.sy - 6} x2={p.sx} y2={p.sy + 6} />
            </g>
          );
        })}

        {/* Étiquette de dimensions (lecture seule) d'une forme survolée non sélectionnée.
            La forme sélectionnée a une étiquette ÉDITABLE en HTML (hors SVG). */}
        {tool === "select" && hoverShapeId && hoverShapeId !== selectedShapeId && (() => {
          const sh = shapes.find((s) => s.id === hoverShapeId);
          if (!sh || sh.poly.length === 0) return null;
          const xs = sh.poly.map((p) => p.x), zs = sh.poly.map((p) => p.z);
          const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
          const t = worldToScreen(maxX, (minZ + maxZ) / 2, view); // sommet « haut » écran = X max
          const circ = circleInfo(sh.poly);
          const text = circ
            ? `r ${(circ.radius * 100).toFixed(2)} · Ø ${(circ.radius * 200).toFixed(2)} cm`
            : `${((maxZ - minZ) * 100).toFixed(2)} × ${((maxX - minX) * 100).toFixed(2)} cm`;
          return dimBadge(t.sx, t.sy - 14, text);
        })()}

        {/* Problèmes de tracé (par forme) */}
        {shapes.map((s) => {
          const iss = ringIssues(s.poly);
          if (!iss.edges.length && !iss.verts.length) return null;
          const n = s.poly.length;
          return (
            <g key={`iss${s.id}`} className="r2d-issue">
              {iss.edges.map((i) => { const a = worldToScreen(s.poly[i].x, s.poly[i].z, view); const b = worldToScreen(s.poly[(i + 1) % n].x, s.poly[(i + 1) % n].z, view); return <line key={i} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} className="r2d-issue-edge" />; })}
              {iss.verts.map((i) => { const p = worldToScreen(s.poly[i].x, s.poly[i].z, view); return <circle key={i} cx={p.sx} cy={p.sy} r={9} className="r2d-issue-vert" />; })}
            </g>
          );
        })}

        {/* Cotes de mesure */}
        {measurements.map((m) => {
          // Extrémités liées : recalculées depuis l'état courant (suivent l'élément).
          const a = resolveMeasureRef(m.aRef, m.a, measureCtx);
          const b = resolveMeasureRef(m.bRef, m.b, measureCtx);
          const g = measureGeom(a, b, m.offset, view);
          return (
            <g key={m.id} className={`r2d-dim${selectedMeasureId === m.id ? " selected" : ""}`}>
              <line x1={g.a.sx} y1={g.a.sy} x2={g.ao.sx} y2={g.ao.sy} className="r2d-dim-ext" />
              <line x1={g.b.sx} y1={g.b.sy} x2={g.bo.sx} y2={g.bo.sy} className="r2d-dim-ext" />
              <line x1={g.ao.sx} y1={g.ao.sy} x2={g.bo.sx} y2={g.bo.sy} className="r2d-dim-line" markerStart="url(#r2d-arrow)" markerEnd="url(#r2d-arrow)" />
              <g transform={`translate(${g.mid.sx} ${g.mid.sy})`} className="r2d-dim-label"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  // Sélectionne la cote (suppression au clavier) et amorce le décalage.
                  selectMeasure(m.id);
                  dragRef.current = { kind: "measureOffset", id: m.id };
                }}
                onDoubleClick={(e) => { e.stopPropagation(); removeMeasurement(m.id); selectMeasure(null); commitHistory("Mesure supprimée"); }}>
                <rect x={-22} y={-10} width={44} height={18} rx={4} />
                <text textAnchor="middle" y={4}>{(g.len * 100).toFixed(2)} cm</text>
              </g>
            </g>
          );
        })}

        {/* Témoin d'accroche (mesure ou centre de forme aimanté) */}
        {(tool === "measure" || tool === "select" || tool === "placeServo") && snapHit && (() => {
          const s = worldToScreen(snapHit.x, snapHit.z, view);
          return <circle cx={s.sx} cy={s.sy} r={7} className="r2d-snap-indicator" />;
        })()}

        {/* Mesure en cours : ligne élastique + longueur live + indicateur d'axe */}
        {tool === "measure" && pendingMeasure && (() => {
          const s = worldToScreen(pendingMeasure.x, pendingMeasure.z, view);
          const h = hover ? worldToScreen(hover.x, hover.z, view) : s;
          const lenCm = hover ? Math.hypot(hover.x - pendingMeasure.x, hover.z - pendingMeasure.z) * 100 : 0;
          const midx = (s.sx + h.sx) / 2, midy = (s.sy + h.sy) / 2;
          const glyph = axisLock === "h" ? "  ↔" : axisLock === "v" ? "  ↕" : "";
          return (
            <g className={`r2d-dim pending${axisLock ? " ortho" : ""}`}>
              <line x1={s.sx} y1={s.sy} x2={h.sx} y2={h.sy} className="r2d-dim-line" markerEnd="url(#r2d-arrow)" />
              <circle cx={s.sx} cy={s.sy} r={4} className="r2d-dim-pt" />
              {lenCm > 0.05 && dimBadge(midx, midy - 14, `${lenCm.toFixed(2)} cm${glyph}`)}
              {axisLock && (
                <text x={h.sx + 12} y={h.sy - 10} className="r2d-axis-flag">{axisLock === "h" ? "↔" : "↕"}</text>
              )}
            </g>
          );
        })()}

        {/* Aperçu rect/cercle + dimensions */}
        {draft && tool === "rect" && (() => {
          const a = worldToScreen(draft.a.x, draft.a.z, view), b = worldToScreen(draft.b.x, draft.b.z, view);
          const horiz = Math.abs(draft.b.z - draft.a.z) * 100; // axe Z (largeur écran)
          const vert = Math.abs(draft.b.x - draft.a.x) * 100;  // axe X (hauteur écran)
          const cx = (a.sx + b.sx) / 2, topY = Math.min(a.sy, b.sy);
          return (<>
            <rect x={Math.min(a.sx, b.sx)} y={Math.min(a.sy, b.sy)} width={Math.abs(b.sx - a.sx)} height={Math.abs(b.sy - a.sy)} className="r2d-draft" />
            {dimBadge(cx, topY - 16, `${horiz.toFixed(2)} × ${vert.toFixed(2)} cm`)}
          </>);
        })()}
        {draft && tool === "circle" && (() => {
          const a = worldToScreen(draft.a.x, draft.a.z, view);
          const rWorld = draftRadius(draft.a, draft.b);
          const rPx = rWorld * view.scale;
          return (<>
            <circle cx={a.sx} cy={a.sy} r={rPx} className="r2d-draft" />
            <circle cx={a.sx} cy={a.sy} r={3} className="r2d-circle-center" />
            {dimBadge(a.sx, a.sy - rPx - 16, `r ${(rWorld * 100).toFixed(2)} · Ø ${(rWorld * 200).toFixed(2)} cm`)}
          </>);
        })()}

        {/* Tracé crayon en cours */}
        {tool === "pen" && penPoints.length > 0 && (() => {
          const pts = penPoints.map((p) => worldToScreen(p.x, p.z, view));
          const h = hover ? worldToScreen(hover.x, hover.z, view) : pts[pts.length - 1];
          const d = pts.map((s, k) => `${k === 0 ? "M" : "L"}${s.sx} ${s.sy}`).join(" ") + ` L${h.sx} ${h.sy}`;
          const last = penPoints[penPoints.length - 1];
          const segCm = hover ? Math.hypot(hover.x - last.x, hover.z - last.z) * 100 : 0;
          return (
            <g className="r2d-pen">
              <path d={d} className="r2d-pen-line" />
              {pts.map((s, k) => <circle key={k} cx={s.sx} cy={s.sy} r={k === 0 ? 5 : 3} className={`r2d-pen-pt${k === 0 ? " first" : ""}`} />)}
              {hover && segCm > 0.05 && dimBadge(h.sx, h.sy - 16, `${segCm.toFixed(2)} cm`)}
            </g>
          );
        })()}

        {/* Poignées de sommets de la forme sélectionnée (édition directe) */}
        {tool === "select" && selectedShapeId && (() => {
          const sh = shapes.find((s) => s.id === selectedShapeId);
          if (!sh) return null;
          const n = sh.poly.length;
          return (
            <g className="r2d-vertices">
              {sh.poly.map((p, i) => {
                const s = worldToScreen(p.x, p.z, view);
                const b = sh.poly[(i + 1) % n];
                const mid = worldToScreen((p.x + b.x) / 2, (p.z + b.z) / 2, view);
                return (
                  <g key={i}>
                    <circle cx={mid.sx} cy={mid.sy} r={4} className="r2d-vertex-add"
                      onPointerDown={(e) => { e.stopPropagation(); replaceShape(sh.id, [...sh.poly.slice(0, i + 1), { x: (p.x + b.x) / 2, z: (p.z + b.z) / 2 }, ...sh.poly.slice(i + 1)]); commitHistory("Sommet ajouté"); }} />
                    <circle cx={s.sx} cy={s.sy} r={6} className="r2d-vertex"
                      onPointerDown={(e) => { e.stopPropagation(); dragRef.current = { kind: "shapeVertex", id: sh.id, i }; }}
                      onDoubleClick={(e) => { e.stopPropagation(); if (n > 3) { replaceShape(sh.id, sh.poly.filter((_, k) => k !== i)); commitHistory("Sommet supprimé"); } }} />
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Pattes */}
        {anchors.map((a) => {
          const isSel = selected?.type === "leg" && selected.index === a.index;
          const aS = worldToScreen(a.x, a.z, view);
          const { joints, foot } = legJointPoints(a, segments, markers);
          const footS = worldToScreen(foot.x, foot.z, view);
          return (
            <g key={a.index} className={`r2d-leg${isSel ? " selected" : ""}`}>
              {/* Bandes d'épaisseur (vue de dessus) : un rectangle par partie, le
                  long du tracé réel (coxa → fémur → tibia → pied). */}
              {(() => {
                const segW = segmentWidthsOf(geometry, a.index);
                const segs = [
                  { part: "coxa", a: joints[0], b: joints[1], w: segW.coxa },
                  { part: "femur", a: joints[1], b: joints[2], w: segW.femur },
                  { part: "tibia", a: joints[2], b: foot, w: segW.tibia },
                ];
                return segs.map((s) => (
                  <polygon key={s.part} className={`r2d-leg-band ${s.part}`} points={polyStr(bandPoly(s.a, s.b, s.w))} />
                ));
              })()}
              <line x1={aS.sx} y1={aS.sy} x2={footS.sx} y2={footS.sy} className="r2d-leg-line" />
              <circle cx={footS.sx} cy={footS.sy} r={3} className="r2d-foot" />
              {/* Servo coxa : empreinte vue de dessus à l'échelle + pignon (= ancrage).
                  En mode « placer servo », glisser le corps l'oriente autour du pignon ;
                  double-clic = réinitialise l'orientation (le long de la patte). */}
              {showServos && (() => {
                const cg = coxaServoGeom(a, coxaDims, coxaAngle(a.index));
                const pts = cg.corners.map((p) => { const s = worldToScreen(p.x, p.z, view); return `${s.sx.toFixed(1)},${s.sy.toFixed(1)}`; }).join(" ");
                const pin = worldToScreen(cg.pinion.x, cg.pinion.z, view);
                const pinR = Math.max(2, cg.pinion.r * view.scale);
                // Poignée de rotation : au centre de l'extrémité de sortie du corps.
                const endC = { x: (cg.corners[0].x + cg.corners[1].x) / 2, z: (cg.corners[0].z + cg.corners[1].z) / 2 };
                const endS = worldToScreen(endC.x, endC.z, view);
                const place = tool === "placeServo";
                return (
                  <g className="r2d-coxa-servo">
                    {/* Glisser le corps = déplacer le servo (le pignon = l'ancrage de la
                        patte, donc l'axe coxa suit). Double-clic = réoriente le long de la patte. */}
                    <polygon points={pts}
                      className={`r2d-coxa-body${place ? " movable" : ""}`}
                      onPointerDown={(e) => { if (!place) return; e.stopPropagation(); select({ type: "leg", index: a.index }); dragRef.current = { kind: "coxaMove", index: a.index }; setCoxaDragIndex(a.index); }}
                      onDoubleClick={(e) => { e.stopPropagation(); setCoxaServoAngle(a.index, null); }}>
                      <title>{`Servo coxa — patte ${a.index} (glisser = déplacer, poignée = pivoter)`}</title>
                    </polygon>
                    <circle cx={pin.sx} cy={pin.sy} r={pinR} className="r2d-coxa-pinion" />
                    {place && (
                      <>
                        <line x1={pin.sx} y1={pin.sy} x2={endS.sx} y2={endS.sy} className="r2d-coxa-rot-line" />
                        <circle cx={endS.sx} cy={endS.sy} r={5} className="r2d-coxa-rot"
                          onPointerDown={(e) => { e.stopPropagation(); select({ type: "leg", index: a.index }); dragRef.current = { kind: "coxaRot", index: a.index }; }} />
                      </>
                    )}
                  </g>
                );
              })()}
              {/* Fémur / tibia : marqueurs schématiques (le coxa a son empreinte réelle ci-dessus). */}
              {showServos && joints.filter((j) => j.joint !== "coxa").map((j) => {
                const jS = worldToScreen(j.x, j.z, view);
                return (
                  <g key={j.servoId}>
                    <rect x={jS.sx - 5} y={jS.sy - 5} width={10} height={10}
                      className={`r2d-servo${tool === "placeServo" ? " draggable" : ""}`}
                      onPointerDown={(e) => { if (tool !== "placeServo") return; e.stopPropagation(); select({ type: "leg", index: a.index }); dragRef.current = { kind: "servo", servoId: j.servoId }; }}
                      onDoubleClick={(e) => { e.stopPropagation(); setServoMarker(j.servoId, null); }}>
                      <title>{`Servo ${j.servoId} (${j.joint})`}</title>
                    </rect>
                    <text x={jS.sx} y={jS.sy + 3} className="r2d-servo-label" textAnchor="middle">{JOINT_LABEL[j.joint]}</text>
                  </g>
                );
              })}
              {isSel && tool === "select" && (() => {
                const { dx, dz } = yawToDir(a.yawDeg);
                const hS = worldToScreen(a.x + dx * (segments.coxa + 0.03), a.z + dz * (segments.coxa + 0.03), view);
                return (<><line x1={aS.sx} y1={aS.sy} x2={hS.sx} y2={hS.sy} className="r2d-yaw-line" /><circle cx={hS.sx} cy={hS.sy} r={6} className="r2d-handle r2d-handle-yaw" onPointerDown={(e) => { e.stopPropagation(); dragRef.current = { kind: "yaw", index: a.index }; }} /></>);
              })()}
              <circle cx={aS.sx} cy={aS.sy} r={7} className={`r2d-anchor${isSel ? " selected" : ""}`}
                onPointerDown={(e) => { e.stopPropagation(); select({ type: "leg", index: a.index }); if (tool === "select") { dragRef.current = { kind: "anchor", index: a.index }; setCoxaDragIndex(a.index); } }} />
              <text x={aS.sx} y={aS.sy - 11} className="r2d-leg-label" textAnchor="middle">{a.index}</text>
            </g>
          );
        })}

        {/* Croix rose sur l'objet aux extrémités de cote LIÉES (le point suit l'élément).
            Rendu au-dessus des pattes/formes pour rester visible sur le pignon coxa. */}
        {measurements.map((m) => {
          const ends = [m.aRef ? resolveMeasureRef(m.aRef, m.a, measureCtx) : null,
                        m.bRef ? resolveMeasureRef(m.bRef, m.b, measureCtx) : null];
          return ends.map((pt, k) => {
            if (!pt) return null;
            const s = worldToScreen(pt.x, pt.z, view);
            return (
              <g key={`${m.id}-${k}`} className="r2d-dim-link">
                <line x1={s.sx - 5} y1={s.sy} x2={s.sx + 5} y2={s.sy} />
                <line x1={s.sx} y1={s.sy - 5} x2={s.sx} y2={s.sy + 5} />
              </g>
            );
          });
        })}

        {/* Guides d'aimantation des servos coxa : pendant le déplacement d'un coxa,
            une croix bleu clair « infinie » par pignon (horizontale = X monde, verticale
            = Z monde). Les lignes superposées entre le coxa tiré et un autre s'accentuent. */}
        {coxaDragIndex !== null && (() => {
          const drag = anchors.find((a) => a.index === coxaDragIndex);
          if (!drag) return null;
          const EPS = 1e-4; // ~0,1 mm : après aimantation l'égalité est exacte
          return (
            <g className="r2d-coxa-guides">
              {anchors.map((a) => {
                const s = worldToScreen(a.x, a.z, view);
                // Superposition d'une ligne (du coxa tiré ⇄ d'un autre) ⇒ accentuation.
                const onH = anchors.some((b) => b.index !== a.index && Math.abs(b.x - a.x) < EPS
                  && (a.index === drag.index || b.index === drag.index));
                const onV = anchors.some((b) => b.index !== a.index && Math.abs(b.z - a.z) < EPS
                  && (a.index === drag.index || b.index === drag.index));
                return (
                  <g key={a.index}>
                    <line x1={0} y1={s.sy} x2={size.w} y2={s.sy} className={`r2d-coxa-guide${onH ? " matched" : ""}`} />
                    <line x1={s.sx} y1={0} x2={s.sx} y2={size.h} className={`r2d-coxa-guide${onV ? " matched" : ""}`} />
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Indication avant */}
        {(() => { const f = worldToScreen(contentHalf.hx, 0, view); return <text x={f.sx} y={f.sy} className="r2d-front-label" textAnchor="middle">avant ↑</text>; })()}
      </svg>

      {/* Étiquette de dimensions ÉDITABLE de la forme sélectionnée (redimensionne la forme) */}
      {tool === "select" && selectedShapeId && !menu && (() => {
        const sh = shapes.find((s) => s.id === selectedShapeId);
        if (!sh || sh.poly.length === 0) return null;
        const xs = sh.poly.map((p) => p.x), zs = sh.poly.map((p) => p.z);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const t = worldToScreen(maxX, (minZ + maxZ) / 2, view); // haut-centre écran
        const circ = circleInfo(sh.poly);
        return (
          <div className="r2d-dimedit" style={{ left: t.sx, top: t.sy - 30 }} onPointerDown={(e) => e.stopPropagation()}>
            {circ ? (
              <>
                <span className="r2d-dimedit-unit">Ø</span>
                <DimField valueCm={circ.radius * 200} title="Diamètre (cm)" onApply={(cm) => resizeCircleDiam(sh.id, cm)} />
                <span className="r2d-dimedit-unit">cm · r {(circ.radius * 100).toFixed(2)}</span>
              </>
            ) : (
              <>
                <DimField valueCm={(maxZ - minZ) * 100} title="Largeur (cm)" onApply={(cm) => resizeShapeDim(sh.id, "w", cm)} />
                <span className="r2d-dimedit-x">×</span>
                <DimField valueCm={(maxX - minX) * 100} title="Hauteur (cm)" onApply={(cm) => resizeShapeDim(sh.id, "h", cm)} />
                <span className="r2d-dimedit-unit">cm</span>
              </>
            )}
          </div>
        );
      })()}

      {/* Menu contextuel d'une forme (clic droit) */}
      {menu && (
        <div className="r2d-context-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
          <button type="button" onClick={() => centerShape(menu.shapeId)}>Centrer sur l'espace de travail</button>
          <button type="button" onClick={() => duplicateShape(menu.shapeId)}>Dupliquer</button>
          <button type="button" onClick={() => mirrorShape(menu.shapeId, "h")}>Créer symétrie horizontale</button>
          <button type="button" onClick={() => mirrorShape(menu.shapeId, "v")}>Créer symétrie verticale</button>
          <div className="r2d-context-sep" />
          <button type="button" onClick={() => setShapeLayer(menu.shapeId, "virtual")}>Mettre en arrière (masque virtuel)</button>
          <button type="button" onClick={() => setShapeLayer(menu.shapeId, "real")}>Mettre en avant (masque réel)</button>
          <div className="r2d-context-sep" />
          <button type="button" onClick={() => deleteShapeMenu(menu.shapeId)}>Supprimer</button>
        </div>
      )}
    </div>
  );
}
