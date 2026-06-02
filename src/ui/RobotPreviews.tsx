import { useHexapodStore } from "../store/useHexapodStore";
import { useProjectStore } from "../store/useProjectStore";
import { computeLegMounts, segmentWidthsOf, segmentHeightsOf, LEG_NAMES, type LegMount, type Pt2 } from "../model/hexapod";
import { findServoType } from "../model/servoTypes";
import { Robot3DPreview } from "../three/Robot3DPreview";

/** Point du profil de patte : u = le long de la patte, v = vertical (haut positif). */
type UV = { u: number; v: number };

/** Rectangle d'un segment p→q, épaisseur t centrée sur l'axe (plan u,v). */
function bandUV(p: UV, q: UV, t: number): UV[] {
  const du = q.u - p.u, dv = q.v - p.v, len = Math.hypot(du, dv) || 1;
  const nu = (-dv / len) * (t / 2), nv = (du / len) * (t / 2);
  return [
    { u: p.u + nu, v: p.v + nv }, { u: q.u + nu, v: q.v + nv },
    { u: q.u - nu, v: q.v - nv }, { u: p.u - nu, v: p.v - nv },
  ];
}

/** Bande conique p→q : épaisseur t0 (départ) → t1 (arrivée). Forme du tibia. */
function taperedBandUV(p: UV, q: UV, t0: number, t1: number): UV[] {
  const du = q.u - p.u, dv = q.v - p.v, len = Math.hypot(du, dv) || 1;
  const nu = -dv / len, nv = du / len;
  return [
    { u: p.u + nu * t0 / 2, v: p.v + nv * t0 / 2 }, { u: q.u + nu * t1 / 2, v: q.v + nv * t1 / 2 },
    { u: q.u - nu * t1 / 2, v: q.v - nv * t1 / 2 }, { u: p.u - nu * t0 / 2, v: p.v - nv * t0 / 2 },
  ];
}

/** Ajuste des anneaux (u,v) dans une boîte écran ; v positif = vers le haut. */
function fitUV(rings: UV[][], w: number, h: number, pad: number) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.u < minU) minU = p.u; if (p.u > maxU) maxU = p.u;
    if (p.v < minV) minV = p.v; if (p.v > maxV) maxV = p.v;
  }
  if (!isFinite(minU)) return null;
  const spanU = maxU - minU || 0.001, spanV = maxV - minV || 0.001;
  const scale = Math.min((w - 2 * pad) / spanU, (h - 2 * pad) / spanV);
  const ox = pad + (w - 2 * pad - spanU * scale) / 2;
  const oy = pad + (h - 2 * pad - spanV * scale) / 2;
  return (p: UV) => ({ x: ox + (p.u - minU) * scale, y: oy + (maxV - p.v) * scale });
}

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

// Pose schématique de profil (angles vers le bas, depuis l'horizontale) :
// coxa horizontal, fémur à 35°, tibia à (90−35)=55°.
const LEG_TILE_ANGLES_DEG = [0, -35, -55];

function LegTile({ m }: { m: LegMount }) {
  const geometry = useHexapodStore((s) => s.geometry);
  const hardware = useProjectStore((s) => s.activeProject?.hardware);
  const W = 110;
  const seg = geometry.segments;
  const segW = segmentWidthsOf(geometry, m.index);
  const sh = segmentHeightsOf(geometry, m.index);
  const lens = [seg.coxa, seg.femur, seg.tibia];
  // Tibia conique : genou (segmentHeights.tibia, défaut = largeur servo) → pied (tibiaFoot).
  const servoWm = (findServoType(hardware?.servoTypeId, hardware?.customServoTypes ?? [])?.dimensionsMm.w ?? 20) / 1000;
  const tibiaKnee = geometry.segmentHeights?.[m.index]?.tibia ?? servoWm;
  // Articulations du profil, fléchies aux angles donnés.
  const joints: UV[] = [{ u: 0, v: 0 }];
  let cur: UV = { u: 0, v: 0 };
  for (let i = 0; i < 3; i++) {
    const a = (LEG_TILE_ANGLES_DEG[i] * Math.PI) / 180;
    cur = { u: cur.u + lens[i] * Math.cos(a), v: cur.v + lens[i] * Math.sin(a) };
    joints.push(cur);
  }
  // Pattes de gauche (z < 0) : miroir horizontal pour pointer vers la gauche.
  const flip = m.position[2] < 0;
  const jts = flip ? joints.map((p) => ({ u: -p.u, v: p.v })) : joints;
  const bands = [
    bandUV(jts[0], jts[1], segW.coxa),
    bandUV(jts[1], jts[2], segW.femur),
    taperedBandUV(jts[2], jts[3], tibiaKnee, sh.tibiaFoot),
  ];
  const map = fitUV(bands, W, TILE_H, 12);
  if (!map) return null;
  const ring = (r: UV[]) => r.map((p, i) => { const s = map(p); return `${i === 0 ? "M" : "L"}${s.x.toFixed(1)} ${s.y.toFixed(1)}`; }).join(" ") + " Z";
  const a0 = map(jts[0]), foot = map(jts[3]);
  return (
    <div className="robot-preview-tile">
      <svg className="robot-preview-svg" viewBox={`0 0 ${W} ${TILE_H}`} width={W} height={TILE_H}>
        {bands.map((b, i) => <path key={i} d={ring(b)} className="robot-preview-band" />)}
        <circle cx={a0.x} cy={a0.y} r={3.5} className="robot-preview-anchor" />
        <circle cx={foot.x} cy={foot.y} r={2.5} className="robot-preview-foot" />
      </svg>
      <span className="robot-preview-tile-name">{LEG_NAMES[m.index]}</span>
    </div>
  );
}

/** Bande d'aperçus : pattes gauches · châssis · pattes droites. */
function LegStrip() {
  const geometry = useHexapodStore((s) => s.geometry);
  const mounts = computeLegMounts(geometry);
  const left = mounts.filter((m) => m.index < 3);
  const right = mounts.filter((m) => m.index >= 3);
  return (
    <div className="robot-preview-strip">
      {left.map((m) => <LegTile key={m.index} m={m} />)}
      <ChassisTile />
      {right.map((m) => <LegTile key={m.index} m={m} />)}
    </div>
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
        <LegStrip />
      </div>
    </div>
  );
}
