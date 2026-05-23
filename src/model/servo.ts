export type ServoJoint = "coxa" | "femur" | "tibia";

export interface ServoDef {
  id: number;
  legIndex: number;
  joint: ServoJoint;
  minDeg: number;
  maxDeg: number;
  defaultDeg: number;
}

export const clampAngle = (deg: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, deg));

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
