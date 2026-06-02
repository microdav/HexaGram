import polygonClipping from "polygon-clipping";
import type { ChassisPiece, Pt2, Shape2D } from "./hexapod";

type Pair = [number, number];
type Ring = Pair[];
type Polygon = Ring[];

const toRing = (poly: Pt2[]): Ring => poly.map((p) => [p.x, p.z] as Pair);

function fromRing(ring: ReadonlyArray<ReadonlyArray<number>>): Pt2[] {
  const pts: Pt2[] = ring.map((c) => ({ x: c[0], z: c[1] }));
  // polygon-clipping referme les anneaux (1er point répété en fin) → on l'enlève.
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9) pts.pop();
  }
  return pts;
}

/** Cercle approché par un polygone régulier (plan XZ). */
export function tessellateCircle(cx: number, cz: number, r: number, segs = 48): Pt2[] {
  const out: Pt2[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    out.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
  }
  return out;
}

function boundsOf(pieces: ChassisPiece[]): { length: number; width: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const pc of pieces) for (const p of pc.outer) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  if (!isFinite(minX)) return { length: 0, width: 0 };
  return { length: maxX - minX, width: maxZ - minZ };
}

/**
 * Fusionne les formes RÉELLES en morceaux de châssis : union des `add` puis
 * différence des `subtract` (découpes/trous). Renvoie les morceaux + la boîte
 * englobante (utilisée par la cinématique / le CoG).
 */
export function bakeRealShapes(shapes: Shape2D[]): { pieces: ChassisPiece[]; bbox: { length: number; width: number } } {
  const reals = shapes.filter((s) => s.layer === "real" && s.poly.length >= 3);
  const adds = reals.filter((s) => s.op === "add").map((s) => [toRing(s.poly)] as Polygon);
  const subs = reals.filter((s) => s.op === "subtract").map((s) => [toRing(s.poly)] as Polygon);
  if (adds.length === 0) return { pieces: [], bbox: { length: 0, width: 0 } };
  try {
    let result = polygonClipping.union(adds[0], ...adds.slice(1));
    if (subs.length > 0) result = polygonClipping.difference(result, ...subs);
    const pieces: ChassisPiece[] = result
      .filter((poly) => poly.length > 0 && poly[0].length >= 3)
      .map((poly) => ({ outer: fromRing(poly[0]), holes: poly.slice(1).map(fromRing) }));
    return { pieces, bbox: boundsOf(pieces) };
  } catch {
    return { pieces: [], bbox: { length: 0, width: 0 } };
  }
}

/** Vrai si deux formes RÉELLES « matière » se chevauchent (proposition de fusion). */
export function realShapesOverlap(shapes: Shape2D[]): boolean {
  const adds = shapes.filter((s) => s.layer === "real" && s.op === "add" && s.poly.length >= 3);
  for (let i = 0; i < adds.length; i++) {
    for (let j = i + 1; j < adds.length; j++) {
      try {
        const inter = polygonClipping.intersection([toRing(adds[i].poly)], [toRing(adds[j].poly)]);
        if (inter.length > 0) return true;
      } catch { /* ignore */ }
    }
  }
  return false;
}

/**
 * Fusionne les formes « matière » réelles en leur union (contours tracés auto),
 * en CONSERVANT les formes d'origine : elles sont archivées sur le calque
 * **virtuel** (gabarits gris, récupérables) pour pouvoir revenir/modifier plus tard.
 * Pour annuler la fusion : remettre les originaux en « réel » et supprimer le contour fusionné.
 */
export function fuseRealShapes(shapes: Shape2D[], makeId: () => string): Shape2D[] {
  const adds = shapes.filter((s) => s.layer === "real" && s.op === "add" && s.poly.length >= 3);
  if (adds.length < 2) return shapes;
  const others = shapes.filter((s) => !(s.layer === "real" && s.op === "add"));
  try {
    const merged = polygonClipping.union(
      [toRing(adds[0].poly)] as Polygon,
      ...adds.slice(1).map((s) => [toRing(s.poly)] as Polygon)
    );
    const fused: Shape2D[] = [];
    for (const poly of merged) {
      // Le contour extérieur devient une forme « matière » ; chaque trou d'union
      // devient une « découpe ».
      if (poly[0]?.length >= 3) fused.push({ id: makeId(), layer: "real", op: "add", poly: fromRing(poly[0]) });
      for (const hole of poly.slice(1)) {
        if (hole.length >= 3) fused.push({ id: makeId(), layer: "real", op: "subtract", poly: fromRing(hole) });
      }
    }
    // Archive des formes d'origine sur le calque virtuel (conservées, non bakées).
    const archived: Shape2D[] = adds.map((s) => ({ ...s, layer: "virtual" }));
    return [...others, ...archived, ...fused];
  } catch {
    return shapes;
  }
}
