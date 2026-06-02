import { BoxGeometry, BufferGeometry } from "three";

/**
 * Boîte **conique** le long de X : x ∈ [0, length], section Z = width, hauteur Y
 * variant linéairement de `hStart` (au genou, x=0) à `hEnd` (au pied, x=length),
 * centrée sur Y = 0. Réutilise une BoxGeometry (winding/UV corrects) dont on
 * déforme les sommets, puis recalcule les normales.
 */
export function makeTaperedBox(length: number, width: number, hStart: number, hEnd: number): BufferGeometry {
  const g = new BoxGeometry(length, 1, width); // x ∈ [-L/2, L/2], y ∈ [-0.5, 0.5]
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const t = length > 1e-9 ? (x + length / 2) / length : 0; // 0 (genou) → 1 (pied)
    const h = hStart + (hEnd - hStart) * t;
    pos.setY(i, pos.getY(i) * h);
    pos.setX(i, x + length / 2); // décale vers x ∈ [0, length]
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
