// Direction physique du mouvement d'un servo, déduite du MODÈLE 3D.
//
// Sert à étiqueter les commandes de calibration (assistant + cartes patte) avec
// le sens réel : « avant/arrière » pour la coxa, « haut/bas » pour fémur/tibia.
// Comme tout dérive de la FK (computeFootTip), les libellés collent toujours à ce
// que fait la 3D ; l'inversion (`invert`) échange ensuite les deux extrémités.

import { computeLegMounts, type HexapodGeometry } from "./hexapod";
import { computeFootTip } from "./kinematics";
import { defaultPose, servoIndex } from "./pose";

export type Joint = "coxa" | "femur" | "tibia";

/** Petit incrément (deg) pour sonder la direction du mouvement dans le modèle. */
const PROBE_DEG = 30;

/**
 * Déplacement (repère châssis) du bout de patte quand on AUGMENTE l'angle modèle
 * du servo donné. Repère : +X = avant, +Z = droite, +Y = haut.
 */
export function jointFootMotion(
  geometry: HexapodGeometry,
  legIndex: number,
  joint: Joint
): { x: number; y: number; z: number } {
  const mount = computeLegMounts(geometry).find((m) => m.index === legIndex);
  if (!mount) return { x: 0, y: 0, z: 0 };
  const idx = servoIndex(legIndex, joint);
  const p0 = defaultPose();
  p0[idx] = 0;
  const p1 = defaultPose();
  p1[idx] = PROBE_DEG;
  const t0 = computeFootTip(mount, p0, geometry);
  const t1 = computeFootTip(mount, p1, geometry);
  return { x: t1.x - t0.x, y: t1.y - t0.y, z: t1.z - t0.z };
}

const OPPOSITE: Record<string, string> = {
  avant: "arrière",
  arrière: "avant",
  haut: "bas",
  bas: "haut",
};

/** Mot décrivant la direction d'un angle modèle POSITIF (hors prise en compte de `invert`). */
export function positiveDirectionWord(
  geometry: HexapodGeometry,
  legIndex: number,
  joint: Joint
): string {
  const d = jointFootMotion(geometry, legIndex, joint);
  // Coxa = pivot vertical : balancement avant/arrière de la patte (jamais gauche/droite).
  if (joint === "coxa") return d.x >= 0 ? "avant" : "arrière";
  // Fémur/tibia = pivot horizontal : le bout de patte monte ou descend.
  return d.y >= 0 ? "haut" : "bas";
}

/**
 * Libellés des extrémités du slider de test (gauche = angle min, droite = max),
 * exprimés dans la direction du MODÈLE 3D — c'est-à-dire le comportement attendu
 * une fois la calibration correcte.
 *
 * Volontairement INDÉPENDANT de `invert` : le slider commande l'angle logique, et
 * `invert` est appliqué dans la conversion vers le servo. Donc, une fois `invert`
 * bien réglé, « slider à droite » fait toujours aller le pied vers `pos`, quel que
 * soit l'état de `invert`. Si le robot va à l'envers de ces libellés, c'est que
 * `invert` est mal réglé (il sert justement à faire coller le robot au modèle).
 */
export function sliderEndLabels(
  geometry: HexapodGeometry,
  legIndex: number,
  joint: Joint
): { low: string; high: string } {
  const pos = positiveDirectionWord(geometry, legIndex, joint);
  const neg = OPPOSITE[pos] ?? pos;
  return { low: neg, high: pos };
}
