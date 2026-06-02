import type { Pt2 } from "./hexapod";

export interface RingIssues {
  /** Index des arêtes (i → i+1) impliquées dans un croisement. */
  edges: number[];
  /** Index des sommets confondus avec leur voisin. */
  verts: number[];
}

const EPS = 1e-4; // 0,1 mm

function orient(a: Pt2, b: Pt2, c: Pt2): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function onSeg(a: Pt2, b: Pt2, c: Pt2): boolean {
  return (
    Math.min(a.x, b.x) - EPS <= c.x && c.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.z, b.z) - EPS <= c.z && c.z <= Math.max(a.z, b.z) + EPS
  );
}

/** Vrai si les segments [p1,p2] et [p3,p4] se croisent (y compris en se touchant). */
function segmentsIntersect(p1: Pt2, p2: Pt2, p3: Pt2, p4: Pt2): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (Math.abs(d1) < EPS && onSeg(p3, p4, p1)) return true;
  if (Math.abs(d2) < EPS && onSeg(p3, p4, p2)) return true;
  if (Math.abs(d3) < EPS && onSeg(p1, p2, p3)) return true;
  if (Math.abs(d4) < EPS && onSeg(p1, p2, p4)) return true;
  return false;
}

/**
 * Détecte les problèmes d'un anneau fermé : arêtes qui se chevauchent/croisent
 * et sommets confondus avec leur voisin.
 */
export function ringIssues(pts: Pt2[]): RingIssues {
  const n = pts.length;
  const edges = new Set<number>();
  const verts = new Set<number>();
  if (n < 3) return { edges: [], verts: [] };

  // Sommets confondus (avec le suivant).
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (Math.hypot(a.x - b.x, a.z - b.z) < EPS) { verts.add(i); verts.add((i + 1) % n); }
  }

  // Croisements entre arêtes non adjacentes.
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Sauter les arêtes adjacentes (partageant un sommet) et l'arête elle-même.
      if (j === i) continue;
      if (j === (i + 1) % n || i === (j + 1) % n) continue;
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) { edges.add(i); edges.add(j); }
    }
  }
  return { edges: [...edges], verts: [...verts] };
}

/** Croisement strict (les deux segments se traversent réellement). */
function properCross(p1: Pt2, p2: Pt2, p3: Pt2, p4: Pt2): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Retire les sommets confondus consécutifs (et le bouclage). */
function dedupRing(pts: Pt2[]): Pt2[] {
  const out: Pt2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) >= EPS) out.push(p);
  }
  while (out.length >= 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].z - out[out.length - 1].z) < EPS) {
    out.pop();
  }
  return out;
}

/**
 * Dé-croise un anneau par 2-opt : tant que deux arêtes non adjacentes se croisent,
 * on inverse le sous-chemin entre elles. Chaque inversion réduit strictement le
 * périmètre → convergence garantie vers un polygone simple. Idéal pour les tracés
 * orthogonaux dont seul l'ordre des sommets pose problème.
 */
export function untangleRing(input: Pt2[]): Pt2[] {
  const p = dedupRing(input);
  const n = p.length;
  if (n < 4) return p;
  const maxIter = 4 * n * n + 50;
  for (let guard = 0; guard < maxIter; guard++) {
    let crossed = false;
    for (let i = 0; i < n && !crossed; i++) {
      const a1 = p[i], a2 = p[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === (i + 1) % n || i === (j + 1) % n) continue; // arêtes adjacentes
        if (properCross(a1, a2, p[j], p[(j + 1) % n])) {
          // Inverse les sommets i+1 .. j (décroisement 2-opt).
          let lo = i + 1, hi = j;
          while (lo < hi) { const t = p[lo]; p[lo] = p[hi]; p[hi] = t; lo++; hi--; }
          crossed = true;
          break;
        }
      }
    }
    if (!crossed) break;
  }
  return p;
}

export interface ChassisValidity {
  ok: boolean;
  /** Nombre d'arêtes en croisement (contour + trous). */
  intersections: number;
  /** Nombre de sommets confondus (contour + trous). */
  coincident: number;
}

/** Validité globale du châssis 2D (contour + trous). */
export function chassisValidity(points: Pt2[] | null | undefined, holes: Pt2[][] | undefined): ChassisValidity {
  let intersections = 0;
  let coincident = 0;
  const check = (pts: Pt2[]) => {
    const r = ringIssues(pts);
    intersections += r.edges.length;
    coincident += r.verts.length;
  };
  if (points && points.length >= 3) check(points);
  for (const h of holes ?? []) if (h.length >= 3) check(h);
  return { ok: intersections === 0 && coincident === 0, intersections, coincident };
}

/** Corrige automatiquement contour + trous (fusion des sommets confondus + dé-croisement). */
export function autoFixChassis(
  points: Pt2[] | null | undefined,
  holes: Pt2[][] | undefined
): { points: Pt2[] | null; holes: Pt2[][] } {
  const fixedPoints = points && points.length >= 3 ? untangleRing(points) : points ?? null;
  const fixedHoles = (holes ?? [])
    .map((h) => (h.length >= 3 ? untangleRing(h) : h))
    .filter((h) => h.length >= 3);
  return { points: fixedPoints, holes: fixedHoles };
}
