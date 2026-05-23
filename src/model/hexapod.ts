import type { ServoDef } from "./servo";

export type LegLayout = "star" | "linear";

export interface HexapodGeometry {
  chassis: { length: number; width: number; height: number };
  segments: { coxa: number; femur: number; tibia: number };
  /** Center of gravity offset relative to chassis center (body frame). */
  cog: { x: number; y: number; z: number };
  /** Disposition angulaire des coxa : étoile (angles variés) ou rectiligne (tous à ±90°). */
  legLayout?: LegLayout;
}

export interface LegMount {
  index: number;
  name: string;
  position: [number, number, number];
  yawDeg: number;
}

export const DEFAULT_GEOMETRY: HexapodGeometry = {
  chassis: { length: 0.34, width: 0.18, height: 0.065 },
  segments: { coxa: 0.05, femur: 0.08, tibia: 0.115 },
  cog: { x: 0, y: 0, z: 0 },
};

export const LEG_NAMES = [
  "Avant gauche",
  "Milieu gauche",
  "Arrière gauche",
  "Avant droite",
  "Milieu droite",
  "Arrière droite",
] as const;

export function computeLegMounts(geom: HexapodGeometry): LegMount[] {
  const halfL = geom.chassis.length / 2;
  const halfW = geom.chassis.width / 2;
  const y = 0;
  const linear = (geom.legLayout ?? "star") === "linear";

  return [
    { index: 0, name: LEG_NAMES[0], position: [+halfL, y, -halfW], yawDeg: linear ? +90 : +45 },
    { index: 1, name: LEG_NAMES[1], position: [0, y, -halfW],      yawDeg: +90 },
    { index: 2, name: LEG_NAMES[2], position: [-halfL, y, -halfW], yawDeg: linear ? +90 : +135 },
    { index: 3, name: LEG_NAMES[3], position: [+halfL, y, +halfW], yawDeg: linear ? -90 : -45 },
    { index: 4, name: LEG_NAMES[4], position: [0, y, +halfW],      yawDeg: -90 },
    { index: 5, name: LEG_NAMES[5], position: [-halfL, y, +halfW], yawDeg: linear ? -90 : -135 },
  ];
}

export function buildServos(): ServoDef[] {
  const servos: ServoDef[] = [];
  let id = 0;
  // Plage de 180° par servo (±90°) — correspond à la course standard d'un servo
  // hobby, et donne un arc 3D parfaitement symétrique pour chaque articulation.
  for (let leg = 0; leg < 6; leg++) {
    servos.push({ id: id++, legIndex: leg, joint: "coxa", minDeg: -90, maxDeg: 90, defaultDeg: 0 });
    servos.push({ id: id++, legIndex: leg, joint: "femur", minDeg: -90, maxDeg: 90, defaultDeg: -20 });
    servos.push({ id: id++, legIndex: leg, joint: "tibia", minDeg: -90, maxDeg: 90, defaultDeg: -60 });
  }
  return servos;
}

export const SERVOS = buildServos();
