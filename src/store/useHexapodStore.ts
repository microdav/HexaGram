import { create } from "zustand";
import { DEFAULT_GEOMETRY, SERVOS, type HexapodGeometry } from "../model/hexapod";
import { clampAngle } from "../model/servo";
import { defaultPose, servoIndex, type Keyframe, type Pose } from "../model/pose";

interface HexapodState {
  geometry: HexapodGeometry;
  pose: Pose;
  keyframes: Keyframe[];
  gravityEnabled: boolean;
  mirrorEnabled: boolean;
  cameraDirection: [number, number, number];
  compassLocked: boolean;
  setServoAngle: (id: number, deg: number) => void;
  resetPose: () => void;
  setGeometry: (partial: Partial<HexapodGeometry>) => void;
  captureKeyframe: (name?: string) => void;
  applyKeyframe: (id: string) => void;
  deleteKeyframe: (id: string) => void;
  exportKeyframesJson: () => string;
  setGravityEnabled: (enabled: boolean) => void;
  setMirrorEnabled: (enabled: boolean) => void;
  setCameraDirection: (dir: [number, number, number]) => void;
  toggleCompassLocked: () => void;
}

// Leg 0↔3, 1↔4, 2↔5 (gauche ↔ droite, même position avant/milieu/arrière)
function mirrorLegIndex(leg: number): number {
  return leg < 3 ? leg + 3 : leg - 3;
}

const INITIAL_CAM_DIR: [number, number, number] = (() => {
  const v = [0.55, 0.4, 0.55];
  const m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
})();

export const useHexapodStore = create<HexapodState>((set, get) => ({
  geometry: DEFAULT_GEOMETRY,
  pose: defaultPose(),
  keyframes: [],
  gravityEnabled: true,
  mirrorEnabled: false,
  cameraDirection: INITIAL_CAM_DIR,
  compassLocked: false,

  setServoAngle: (id, deg) =>
    set((state) => {
      const def = SERVOS[id];
      if (!def) return state;
      const next = state.pose.slice();
      next[id] = clampAngle(deg, def.minDeg, def.maxDeg);

      if (state.mirrorEnabled) {
        const mirrorLeg = mirrorLegIndex(def.legIndex);
        const mirrorId = servoIndex(mirrorLeg, def.joint);
        const mirrorDef = SERVOS[mirrorId];
        // Coxa = rotation Y (verticale) → négation pour symétrie gauche/droite.
        // Fémur/tibia = rotation Z (locale au plan de la patte) → valeur identique.
        const mirrorDeg = def.joint === "coxa" ? -deg : deg;
        next[mirrorId] = clampAngle(mirrorDeg, mirrorDef.minDeg, mirrorDef.maxDeg);
      }

      return { pose: next };
    }),

  resetPose: () => set({ pose: defaultPose() }),

  setGeometry: (partial) =>
    set((state) => ({
      geometry: {
        chassis: { ...state.geometry.chassis, ...(partial.chassis ?? {}) },
        segments: { ...state.geometry.segments, ...(partial.segments ?? {}) },
      },
    })),

  captureKeyframe: (name) =>
    set((state) => {
      const id = `${Date.now()}`;
      const k: Keyframe = {
        id,
        name: name ?? `Pose ${state.keyframes.length + 1}`,
        pose: state.pose.slice(),
        createdAt: Date.now(),
      };
      return { keyframes: [...state.keyframes, k] };
    }),

  applyKeyframe: (id) =>
    set((state) => {
      const k = state.keyframes.find((kf) => kf.id === id);
      return k ? { pose: k.pose.slice() } : state;
    }),

  deleteKeyframe: (id) =>
    set((state) => ({ keyframes: state.keyframes.filter((k) => k.id !== id) })),

  exportKeyframesJson: () => JSON.stringify(get().keyframes, null, 2),

  setGravityEnabled: (enabled) => set({ gravityEnabled: enabled }),

  setMirrorEnabled: (enabled) => set({ mirrorEnabled: enabled }),

  setCameraDirection: (dir) => set({ cameraDirection: dir }),

  toggleCompassLocked: () => set((s) => ({ compassLocked: !s.compassLocked })),
}));
