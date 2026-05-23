import { SERVOS } from "./hexapod";

export type Pose = number[];

export const defaultPose = (): Pose => SERVOS.map((s) => s.defaultDeg);

export const servoIndex = (legIndex: number, joint: "coxa" | "femur" | "tibia"): number => {
  const offset = joint === "coxa" ? 0 : joint === "femur" ? 1 : 2;
  return legIndex * 3 + offset;
};

export interface Keyframe {
  id: string;
  name: string;
  pose: Pose;
  createdAt: number;
}
