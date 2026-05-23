import { create } from "zustand";
import { DEFAULT_GEOMETRY, SERVOS, type HexapodGeometry } from "../model/hexapod";
import { clampAngle } from "../model/servo";
import { defaultPose, servoIndex, type Keyframe, type Pose } from "../model/pose";
import { useToastStore } from "./useToastStore";

const PREFS_KEY = "hexagram.prefs";

function readPrefs(): { mirrorEnabled?: boolean; gravityEnabled?: boolean; bodyTransparent?: boolean } {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}"); } catch { return {}; }
}

const _prefs = readPrefs();

export interface RobotProfileData {
  version: 1;
  geometry: HexapodGeometry;
  keyframes: Keyframe[];
  prefs: {
    mirrorEnabled: boolean;
    gravityEnabled: boolean;
    bodyTransparent: boolean;
    cogAxisLock: { x: boolean; y: boolean; z: boolean };
  };
  servoCalibration?: Record<number, { minDeg: number; maxDeg: number; invert: boolean; zeroOffsetDeg: number }>;
}

interface HexapodState {
  geometry: HexapodGeometry;
  pose: Pose;
  keyframes: Keyframe[];
  gravityEnabled: boolean;
  bodyTransparent: boolean;
  mirrorEnabled: boolean;
  cameraDirection: [number, number, number];
  compassLocked: boolean;
  /** Bitmask of servo IDs whose arc is directly hovered (one bit per servo, 0-17). */
  arcShownMask: number;
  /** True while the user is dragging the CoG handle in the 3D view. */
  cogDragging: boolean;
  /** Per-axis drag lock for the CoG handle. */
  cogAxisLock: { x: boolean; y: boolean; z: boolean };
  setServoAngle: (id: number, deg: number) => void;
  resetPose: () => void;
  setGeometry: (partial: Partial<HexapodGeometry>) => void;
  captureKeyframe: (name?: string) => void;
  applyKeyframe: (id: string) => void;
  deleteKeyframe: (id: string) => void;
  exportKeyframesJson: () => string;
  setGravityEnabled: (enabled: boolean) => void;
  setBodyTransparent: (enabled: boolean) => void;
  setMirrorEnabled: (enabled: boolean) => void;
  setCameraDirection: (dir: [number, number, number]) => void;
  toggleCompassLocked: () => void;
  setArcShown: (servoId: number, shown: boolean) => void;
  setCogDragging: (v: boolean) => void;
  toggleCogAxisLock: (axis: "x" | "y" | "z") => void;
  serializeProfile: () => RobotProfileData;
  applyProfile: (data: unknown) => void;
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
  gravityEnabled: _prefs.gravityEnabled ?? true,
  bodyTransparent: _prefs.bodyTransparent ?? true,
  mirrorEnabled: _prefs.mirrorEnabled ?? false,
  cameraDirection: INITIAL_CAM_DIR,
  compassLocked: false,
  arcShownMask: 0,
  cogDragging: false,
  cogAxisLock: { x: false, y: false, z: false },

  setServoAngle: (id, deg) =>
    set((state) => {
      const def = SERVOS[id];
      if (!def) return state;
      const next = state.pose.slice();
      next[id] = clampAngle(deg, def.minDeg, def.maxDeg);

      if (state.mirrorEnabled) {
        const mirrorLeg = mirrorLegOf(def.legIndex);
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
        cog: { ...state.geometry.cog, ...(partial.cog ?? {}) },
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

  setBodyTransparent: (enabled) => set({ bodyTransparent: enabled }),

  setMirrorEnabled: (enabled) => set({ mirrorEnabled: enabled }),

  setCameraDirection: (dir) => set({ cameraDirection: dir }),

  toggleCompassLocked: () => set((s) => ({ compassLocked: !s.compassLocked })),

  setCogDragging: (v) => set({ cogDragging: v }),

  toggleCogAxisLock: (axis) =>
    set((s) => ({ cogAxisLock: { ...s.cogAxisLock, [axis]: !s.cogAxisLock[axis] } })),

  setArcShown: (servoId, shown) =>
    set((s) => {
      if (servoId < 0 || servoId > 31) return s;
      const bit = 1 << servoId;
      const next = shown ? s.arcShownMask | bit : s.arcShownMask & ~bit;
      return next === s.arcShownMask ? s : { arcShownMask: next };
    }),

  serializeProfile: (): RobotProfileData => {
    const s = get();
    return {
      version: 1,
      geometry: s.geometry,
      keyframes: s.keyframes,
      prefs: {
        mirrorEnabled: s.mirrorEnabled,
        gravityEnabled: s.gravityEnabled,
        bodyTransparent: s.bodyTransparent,
        cogAxisLock: { ...s.cogAxisLock },
      },
    };
  },

  applyProfile: (data: unknown) => {
    const d = data as RobotProfileData;
    if (!d || d.version !== 1) return;
    set({
      geometry: d.geometry,
      keyframes: d.keyframes,
      mirrorEnabled: d.prefs.mirrorEnabled,
      gravityEnabled: d.prefs.gravityEnabled,
      bodyTransparent: d.prefs.bodyTransparent,
      cogAxisLock: d.prefs.cogAxisLock ?? { x: false, y: false, z: false },
      pose: defaultPose(),
    });
  },
}));

// Leg 0↔3, 1↔4, 2↔5 — exposed so UI can compute mirrored arcs/servos.
export function mirrorLegOf(leg: number): number {
  return leg < 3 ? leg + 3 : leg - 3;
}

let _savedPrefs = { ..._prefs };
let _prefsToastTimer: ReturnType<typeof setTimeout> | null = null;

useHexapodStore.subscribe((s) => {
  if (
    s.mirrorEnabled === _savedPrefs.mirrorEnabled &&
    s.gravityEnabled === _savedPrefs.gravityEnabled &&
    s.bodyTransparent === _savedPrefs.bodyTransparent
  ) return;
  _savedPrefs = { mirrorEnabled: s.mirrorEnabled, gravityEnabled: s.gravityEnabled, bodyTransparent: s.bodyTransparent };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(_savedPrefs)); } catch {}
  // Debounced toast — avoid flooding if user clicks rapidly
  if (_prefsToastTimer) clearTimeout(_prefsToastTimer);
  _prefsToastTimer = setTimeout(() => {
    _prefsToastTimer = null;
    useToastStore.getState().show("Préférences enregistrées");
  }, 400);
});
