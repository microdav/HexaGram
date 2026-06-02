import { useHexapodStore } from "../store/useHexapodStore";
import { computeLegMounts, LEG_NAMES, type Pt2 } from "../model/hexapod";
import { legJointPoints } from "./robot2d/canvas2d";
import { Robot3DPreview } from "../three/Robot3DPreview";

/** Ajuste un ensemble d'anneaux (XZ) dans une boîte écran. Vue de dessus : X haut, Z droite. */
function fitView(rings: Pt2[][], w: number, h: number, pad: number) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  if (!isFinite(minX)) return null;
  const spanX = maxX - minX || 0.001, spanZ = maxZ - minZ || 0.001;
  const scale = Math.min((w - 2 * pad) / spanZ, (h - 2 * pad) / spanX);
  const ox = pad + (w - 2 * pad - spanZ * scale) / 2;
  const oy = pad + (h - 2 * pad - spanX * scale) / 2;
  return (p: Pt2) => ({ x: ox + (p.z - minZ) * scale, y: oy + (maxX - p.x) * scale });
}

const ringPath = (r: Pt2[], map: (p: Pt2) => { x: number; y: number }) =>
  r.map((p, i) => { const s = map(p); return `${i === 0 ? "M" : "L"}${s.x.toFixed(1)} ${s.y.toFixed(1)}`; }).join(" ") + " Z";

// Toutes les vignettes partagent la même hauteur de zone de dessin (libellé dessous).
const TILE_H = 96;

function ChassisTile() {
  const geometry = useHexapodStore((s) => s.geometry);
  const pieces = geometry.body2D?.pieces;
  const points = geometry.body2D?.points;
  const rings: Pt2[][] = pieces?.length
    ? pieces.flatMap((pc) => [pc.outer, ...pc.holes])
    : points && points.length >= 3 ? [points] : [];
  const W = 150;
  const map = fitView(rings, W, TILE_H, 10);
  return (
    <div className="robot-preview-tile">
      {rings.length && map ? (
        <svg className="robot-preview-svg" viewBox={`0 0 ${W} ${TILE_H}`} width={W} height={TILE_H}>
          {(pieces?.length ? pieces : [{ outer: points!, holes: [] }]).map((pc, i) => (
            <path key={i} d={[pc.outer, ...pc.holes].map((r) => ringPath(r, map)).join(" ")}
              fillRule="evenodd" className="robot-preview-shape" />
          ))}
        </svg>
      ) : (
        <div className="robot-preview-empty robot-preview-svg robot-preview-empty-box">non défini</div>
      )}
      <span className="robot-preview-tile-name">Châssis</span>
    </div>
  );
}

function LegTiles() {
  const geometry = useHexapodStore((s) => s.geometry);
  const mounts = computeLegMounts(geometry);
  const markers = geometry.body2D?.servoMarkers;
  const W = 110;
  return (
    <>
      {mounts.map((m) => {
        const anchor = { index: m.index, x: m.position[0], z: m.position[2], yawDeg: m.yawDeg };
        const { joints, foot } = legJointPoints(anchor, geometry.segments, markers);
        const pts: Pt2[] = [{ x: anchor.x, z: anchor.z }, foot, ...joints.map((j) => ({ x: j.x, z: j.z }))];
        const map = fitView([pts], W, TILE_H, 12);
        if (!map) return null;
        const a = map({ x: anchor.x, z: anchor.z }), f = map(foot);
        return (
          <div key={m.index} className="robot-preview-tile">
            <svg className="robot-preview-svg" viewBox={`0 0 ${W} ${TILE_H}`} width={W} height={TILE_H}>
              <line x1={a.x} y1={a.y} x2={f.x} y2={f.y} className="robot-preview-legline" />
              {joints.map((j) => { const s = map({ x: j.x, z: j.z }); return <rect key={j.servoId} x={s.x - 3} y={s.y - 3} width={6} height={6} className="robot-preview-servo" />; })}
              <circle cx={a.x} cy={a.y} r={4} className="robot-preview-anchor" />
            </svg>
            <span className="robot-preview-tile-name">{LEG_NAMES[m.index]}</span>
          </div>
        );
      })}
    </>
  );
}

/** Aperçus de la base mécanique (vue 3D + bande châssis/pattes) pour Projet › Général. */
export function BaseMecaniquePreview() {
  return (
    <div className="robot-previews">
      <div className="robot-preview-card">
        <div className="robot-preview-label">Vue 3D</div>
        <Robot3DPreview />
      </div>
      <div className="robot-preview-card">
        <div className="robot-preview-label">Châssis &amp; pattes</div>
        <div className="robot-preview-strip">
          <ChassisTile />
          <LegTiles />
        </div>
      </div>
    </div>
  );
}
