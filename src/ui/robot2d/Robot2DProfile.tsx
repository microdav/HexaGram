import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useHexapodStore } from "../../store/useHexapodStore";
import { useProjectStore } from "../../store/useProjectStore";
import { useRobot2DStore, type Robot2DFace } from "../../store/useRobot2DStore";
import { defaultAnchorsFromGeometry, segmentHeightsOf, type LegAnchor } from "../../model/hexapod";
import { coxaServoDimsM, findServoType } from "../../model/servoTypes";
import { coxaServoGeom, worldToScreen, yawToDir, type View } from "./canvas2d";

/**
 * Vue PROFIL (Avant / Côté) de la maquette.
 *
 * Projection orthographique du robot « à plat » (pattes au plan y = 0) sur le
 * plan choisi. On réutilise {@link worldToScreen} en mappant l'axe horizontal du
 * profil sur `z` et l'axe vertical (hauteur Y) sur `x`.
 *   - front (Avant, depuis +X) : horizontal = Z (droite), vertical = Y (hauteur).
 *   - side  (Côté,  depuis +Z) : horizontal = X (avant),  vertical = Y (hauteur).
 *
 * Chaque partie de patte est tracée distinctement, à sa hauteur de profil
 * (`segmentHeights`, éditable dans le panneau de droite) :
 *   - coxa  : bloc de **matière** (porte le servo coxa et relie le servo fémur),
 *     hauteur bornée [hauteur servo, hauteur châssis] ; les deux **servos**
 *     (coxa à l'ancrage, fémur au joint) sont dessinés par-dessus.
 *   - fémur / tibia : bloc à leur hauteur de profil.
 * Le châssis est tracé à sa hauteur réelle (`chassis.height`).
 */

type Pt = { h: number; v: number }; // h = horizontal profil, v = vertical (hauteur Y)
type Box = { index: number; cls: string; pts: Pt[] };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function Robot2DProfile({ face }: { face: Exclude<Robot2DFace, "top"> }) {
  const geometry = useHexapodStore((s) => s.geometry);
  const selected = useRobot2DStore((s) => s.selected);
  const select = useRobot2DStore((s) => s.select);
  const servoTypeId = useProjectStore((s) => s.activeProject?.hardware.servoTypeId);
  const customServoTypes = useProjectStore((s) => s.activeProject?.hardware.customServoTypes);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const chassis = geometry.chassis;
  const segments = geometry.segments;
  const anchors: LegAnchor[] = useMemo(() => {
    const a = geometry.body2D?.anchors;
    return a && a.length === 6 ? [...a].sort((p, q) => p.index - q.index) : defaultAnchorsFromGeometry(geometry);
  }, [geometry]);

  const spec = useMemo(() => findServoType(servoTypeId, customServoTypes ?? []), [servoTypeId, customServoTypes]);
  const coxaDims = useMemo(() => coxaServoDimsM(spec), [spec]);
  const servoHm = (spec?.dimensionsMm.h ?? 38) / 1000;
  const servoWm = (spec?.dimensionsMm.w ?? 20) / 1000; // défaut hauteur tibia au genou

  const projH = (x: number, z: number): number => (face === "front" ? z : x);

  // Contour du châssis (rectangle dim × hauteur, centré).
  const halfH = (face === "front" ? chassis.width : chassis.length) / 2;
  const halfV = chassis.height / 2;
  const chassisPts: Pt[] = [
    { h: +halfH, v: +halfV }, { h: -halfH, v: +halfV },
    { h: -halfH, v: -halfV }, { h: +halfH, v: -halfV },
  ];

  const rect = (index: number, cls: string, h0: number, h1: number, vHalf: number): Box => ({
    index, cls, pts: [
      { h: h1, v: +vHalf }, { h: h0, v: +vHalf }, { h: h0, v: -vHalf }, { h: h1, v: -vHalf },
    ],
  });

  // Boîtes de toutes les pattes (matière + servos + fémur + tibia).
  const boxes: Box[] = useMemo(() => {
    const out: Box[] = [];
    for (const a of anchors) {
      const sh = segmentHeightsOf(geometry, a.index);
      const coxaH = clamp(sh.coxa, servoHm, chassis.height); // [servo, châssis]
      const { dx, dz } = yawToDir(a.yawDeg);
      const at = (len: number) => projH(a.x + dx * len, a.z + dz * len);
      const lf = segments.coxa, le = lf + segments.femur, lt = le + segments.tibia;

      // Largeur projetée du footprint servo (pour les boîtes servo).
      const ang = geometry.body2D?.coxaServos?.find((c) => c.legIndex === a.index)?.angleOffsetDeg ?? 0;
      const cg = coxaServoGeom(a, coxaDims, ang);
      let scMin = Infinity, scMax = -Infinity;
      for (const c of cg.corners) { const h = projH(c.x, c.z); if (h < scMin) scMin = h; if (h > scMax) scMax = h; }
      const servoW = Math.max(0.005, scMax - scMin);

      // Coxa : matière (relie servo coxa ↔ servo fémur), puis les deux servos.
      out.push(rect(a.index, "r2dp-coxa-mat", at(0), at(lf), coxaH / 2));
      const sCoxa = at(0), sFemur = at(lf);
      out.push(rect(a.index, "r2dp-servo", sCoxa - servoW / 2, sCoxa + servoW / 2, servoHm / 2));
      out.push(rect(a.index, "r2dp-servo", sFemur - servoW / 2, sFemur + servoW / 2, servoHm / 2));

      // Fémur : bloc à sa hauteur de profil.
      out.push(rect(a.index, "r2dp-seg femur", at(lf), at(le), sh.femur / 2));
      // Tibia : trapèze conique — hauteur genou (au joint) → hauteur pied (au sol).
      // Genou par défaut = largeur du servo (si non explicitement réglé).
      const kneeH = geometry.segmentHeights?.[a.index]?.tibia ?? servoWm;
      const kHalf = kneeH / 2, fHalf = sh.tibiaFoot / 2;
      const hk = at(le), hfoot = at(lt);
      out.push({ index: a.index, cls: "r2dp-seg tibia", pts: [
        { h: hk, v: +kHalf }, { h: hfoot, v: +fHalf }, { h: hfoot, v: -fHalf }, { h: hk, v: -kHalf },
      ] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, segments, face, geometry, coxaDims, servoHm, servoWm, chassis.height]);

  // Étendue du contenu (m) pour l'ajustement automatique.
  const contentHalf = useMemo(() => {
    let hh = halfH, hv = halfV;
    for (const b of boxes) for (const p of b.pts) { hh = Math.max(hh, Math.abs(p.h)); hv = Math.max(hv, Math.abs(p.v)); }
    return { hh: hh + 0.03, hv: hv + 0.03 };
  }, [boxes, halfH, halfV]);

  const fitScale = useMemo(() => {
    const margin = 28;
    const availW = Math.max(50, size.w - margin * 2);
    const availH = Math.max(50, size.h - margin * 2);
    return Math.min(availW / (contentHalf.hh * 2), availH / (contentHalf.hv * 2));
  }, [size, contentHalf]);

  const view: View = useMemo(
    () => ({ cx: size.w / 2 + pan.x, cy: size.h / 2 + pan.y, scale: fitScale * zoom }),
    [size, fitScale, zoom, pan]
  );
  const toScreen = (p: Pt) => worldToScreen(p.v, p.h, view); // x=v, z=h
  const polyStr = (pts: Pt[]) => pts.map((p) => { const s = toScreen(p); return `${s.sx.toFixed(1)},${s.sy.toFixed(1)}`; }).join(" ");

  const onWheel = (e: React.WheelEvent) => setZoom((z) => Math.max(0.2, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  const onDown = (e: React.PointerEvent) => {
    if (e.button === 0 && (e.target as Element).closest(".r2dp-leg")) return; // laisse le clic patte
    panRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };
  useEffect(() => {
    const mv = (e: PointerEvent) => { const d = panRef.current; if (d) setPan({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }); };
    const up = () => { panRef.current = null; };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
  });

  // Grille hiérarchique simple en cm (alignée sur l'origine).
  const pxPerCm = view.scale / 100;
  const STEPS = [0.5, 1, 2, 5, 10, 20, 50];
  const minorCm = STEPS.find((s) => s * pxPerCm >= 9) ?? 50;
  const grid: JSX.Element[] = [];
  if (pxPerCm > 0.05 && isFinite(pxPerCm)) {
    const cls = (c: number) => (Math.abs(c / 5 - Math.round(c / 5)) < 1e-4 ? "r2d-grid-major" : Math.abs(c - Math.round(c)) < 1e-4 ? "r2d-grid-medium" : "r2d-grid-line");
    const hMin = ((0 - view.cx) / view.scale) * 100, hMax = ((size.w - view.cx) / view.scale) * 100;
    const vMin = ((view.cy - size.h) / view.scale) * 100, vMax = ((view.cy - 0) / view.scale) * 100;
    for (let c = Math.ceil(hMin / minorCm) * minorCm, i = 0; c <= hMax && i < 1000; c += minorCm, i++) {
      const sx = view.cx + (c / 100) * view.scale;
      grid.push(<line key={`v${c.toFixed(2)}`} x1={sx} y1={0} x2={sx} y2={size.h} className={cls(c)} />);
    }
    for (let c = Math.ceil(vMin / minorCm) * minorCm, i = 0; c <= vMax && i < 1000; c += minorCm, i++) {
      const sy = view.cy - (c / 100) * view.scale;
      grid.push(<line key={`h${c.toFixed(2)}`} x1={0} y1={sy} x2={size.w} y2={sy} className={cls(c)} />);
    }
  }

  const horizLabel = face === "front" ? "droite →" : "avant →";

  return (
    <div className="r2d-canvas-wrap r2dp-wrap" ref={wrapRef}>
      <svg ref={svgRef} className="r2d-canvas" width={size.w} height={size.h}
        onWheel={onWheel} onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()}>
        <g>{grid}</g>
        <line x1={view.cx} y1={0} x2={view.cx} y2={size.h} className="r2d-axis" />
        <line x1={0} y1={view.cy} x2={size.w} y2={view.cy} className="r2d-axis" />

        {/* Châssis — rectangle dim × hauteur réelle */}
        <polygon points={polyStr(chassisPts)} className="r2dp-chassis" />

        {/* Pattes : un groupe par patte, sélectionnable */}
        {anchors.map((a) => {
          const isSel = selected?.type === "leg" && selected.index === a.index;
          return (
            <g key={a.index} className={`r2dp-leg${isSel ? " selected" : ""}`}
              onPointerDown={(e) => { e.stopPropagation(); select({ type: "leg", index: a.index }); }}>
              {boxes.filter((b) => b.index === a.index).map((b, i) => (
                <polygon key={i} points={polyStr(b.pts)} className={b.cls} />
              ))}
            </g>
          );
        })}

        {/* Repères d'axes */}
        {(() => {
          const top = worldToScreen(contentHalf.hv, 0, view);
          return (<>
            <text x={view.cx} y={top.sy - 6} className="r2d-front-label" textAnchor="middle">haut ↑</text>
            <text x={size.w - 8} y={view.cy - 6} className="r2d-front-label" textAnchor="end">{horizLabel}</text>
          </>);
        })()}
      </svg>
    </div>
  );
}
