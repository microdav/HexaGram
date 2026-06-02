import { ExtrudeGeometry, Path, Shape, Vector2, type BufferGeometry } from "three";
import type { Pt2 } from "./hexapod";

/**
 * Construit la géométrie 3D du châssis par extrusion du contour 2D (plan XZ)
 * sur la hauteur, avec trous éventuels. Mapping cohérent avec la boîte d'origine
 * (length sur X, height sur Y, width sur Z) :
 *   - forme définie en (x, z) → extrudée le long de Y, centrée en Y.
 *
 * L'appelant est responsable de disposer la géométrie retournée.
 */
export function buildChassisGeometry(
  points: Pt2[],
  holes: Pt2[][] | undefined,
  height: number
): BufferGeometry {
  const shape = new Shape(points.map((p) => new Vector2(p.x, p.z)));
  if (holes) {
    for (const h of holes) {
      if (h.length >= 3) shape.holes.push(new Path(h.map((p) => new Vector2(p.x, p.z))));
    }
  }
  const geo = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  // localX→X, localY(z)→Z, extrude(localZ)→ -Y ; on recentre ensuite sur Y.
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height / 2, 0);
  geo.computeVertexNormals();
  return geo;
}
