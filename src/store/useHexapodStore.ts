import { create } from "zustand";
import { DEFAULT_GEOMETRY, SERVOS, defaultAnchorsFromGeometry, polygonBounds, segmentWidthsOf, segmentHeightsOf, type Body2D, type HexapodGeometry, type LegAnchor, type Measurement2D, type MeasureRef, type Shape2D } from "../model/hexapod";
import { bakeRealShapes } from "../model/chassisBake";
import { findServoType } from "../model/servoTypes";
import { useProjectStore } from "./useProjectStore";

/** Largeur (m) du servo du projet — défaut de la hauteur de tibia au genou. */
function projectServoWidthM(): number {
  const hw = useProjectStore.getState().activeProject?.hardware;
  const spec = findServoType(hw?.servoTypeId, hw?.customServoTypes ?? []);
  return (spec?.dimensionsMm.w ?? 20) / 1000;
}

/** Hauteurs de profil effectives d'une patte, genou par défaut = largeur servo. */
function resolvedHeights(g: HexapodGeometry, i: number, kneeDefault: number) {
  const base = segmentHeightsOf(g, i);
  const rawTibia = Array.isArray(g.segmentHeights) ? g.segmentHeights[i]?.tibia : undefined;
  return { ...base, tibia: rawTibia ?? kneeDefault };
}

/**
 * (Re)construit un Body2D complet à partir de l'existant + un patch. Centralise
 * la fusion pour qu'AUCUN champ (shapes, pieces, anchors, mesures…) ne soit
 * perdu lors d'une mise à jour partielle.
 */
function mergeBody2D(g: HexapodGeometry, patch: Partial<Omit<Body2D, "version">>): Body2D {
  const p = g.body2D;
  return {
    version: 1,
    outline: p?.outline ?? { length: g.chassis.length, width: g.chassis.width },
    shapes: p?.shapes,
    pieces: p?.pieces,
    points: p?.points ?? null,
    holes: p?.holes,
    anchors: p?.anchors,
    servoMarkers: p?.servoMarkers,
    coxaServos: p?.coxaServos,
    measurements: p?.measurements,
    ...patch,
  };
}

let _measSeq = 0;
// Date.now() + compteur : reste unique même après un rechargement (un simple
// compteur repart de 0 et collisionne avec les mesures déjà chargées → plusieurs
// cotes glissent ensemble car elles partagent le même id). Cf. newShapeId.
function newMeasurementId(): string { return `m${Date.now().toString(36)}${(++_measSeq).toString(36)}`; }
import { clampAngle } from "../model/servo";
import { defaultPose, servoIndex, type Keyframe, type Pose } from "../model/pose";
import { DEFAULT_COLLISION_PREFS, type CollisionPrefs } from "../model/collisions";
import { useToastStore } from "./useToastStore";
import { useToolboxStore, type ToolboxConfig, type UiPrefs } from "./useToolboxStore";

const PREFS_KEY = "hexagram.prefs";

function readPrefs(): { mirrorEnabled?: boolean; gravityEnabled?: boolean; bodyTransparent?: boolean } {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}"); } catch { return {}; }
}

const _prefs = readPrefs();

export interface ServoCalibration {
  zeroOffsetDeg: number;
  hardMinDeg: number;
  hardMaxDeg: number;
  softMinDeg: number;
  softMaxDeg: number;
  invert: boolean;
}

export const DEFAULT_SERVO_CALIB: ServoCalibration = {
  zeroOffsetDeg: 0,
  hardMinDeg: -90,
  hardMaxDeg: 90,
  softMinDeg: -90,
  softMaxDeg: 90,
  invert: false,
};

export interface WeightConfig {
  emptyWeightG?: number;
  totalWeightG?: number;
}

/**
 * Legacy v1 — le matériel (servo global + électronique) est désormais
 * porté par le projet (useProjectStore). Conservé en lecture pour les
 * profils existants ; toujours sérialisé pour ne rien perdre.
 */
export interface ElectronicsConfig {
  servoControllerId?: string;
  commandElectronicsId?: string;
}

export interface RobotProfileData {
  /** v1 : matériel dans le profil ; v2 : matériel au niveau projet. */
  version: 1 | 2;
  description?: string;
  /** Legacy v1 — conservé pour rétro-compat lecture ; nouveau code n'utilise plus ce champ. */
  globalServoTypeId?: string | null;
  geometry: HexapodGeometry;
  keyframes: Keyframe[];
  prefs: {
    mirrorEnabled: boolean;
    gravityEnabled: boolean;
    bodyTransparent: boolean;
    cogAxisLock: { x: boolean; y: boolean; z: boolean };
    collisionPrefs?: CollisionPrefs;
  };
  servoCalibration?: Record<number, ServoCalibration>;
  toolboxLayout?: Record<string, ToolboxConfig>;
  uiPrefs?: UiPrefs;
  weightConfig?: WeightConfig;
  /** Legacy v1 — conservé pour rétro-compat lecture. */
  electronics?: ElectronicsConfig;
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
  /** True while the user is dragging a foot tip in the 3D view. */
  footDragging: boolean;
  /** Per-axis drag lock for the CoG handle. */
  cogAxisLock: { x: boolean; y: boolean; z: boolean };
  description: string;
  servoCalibration: Record<number, ServoCalibration>;
  collisionPrefs: CollisionPrefs;
  weightConfig: WeightConfig;
  torqueEnabled: boolean;
  setServoAngle: (id: number, deg: number) => void;
  resetPose: () => void;
  setGeometry: (partial: Partial<HexapodGeometry>) => void;
  /** Remplace la géométrie entière (utilisé par l'annulation/rétablissement). */
  replaceGeometry: (geometry: HexapodGeometry) => void;
  /** Règle l'épaisseur (vue de dessus, m) d'une partie d'une patte donnée. */
  setSegmentWidth: (legIndex: number, part: "coxa" | "femur" | "tibia", value: number) => void;
  /** Recopie les épaisseurs de la patte `legIndex` sur les 6 pattes. */
  applySegmentWidthsToAll: (legIndex: number) => void;
  /** Règle la hauteur de profil (m) d'une partie d'une patte donnée. */
  setSegmentHeight: (legIndex: number, part: "coxa" | "femur" | "tibia" | "tibiaFoot", value: number) => void;
  /** Recopie les hauteurs de profil de la patte `legIndex` sur les 6 pattes. */
  applySegmentHeightsToAll: (legIndex: number) => void;
  /** Déplace/oriente un ancrage de patte (maquette 2D). Crée body2D au besoin. */
  setLegAnchor: (index: number, patch: Partial<Pick<LegAnchor, "x" | "z" | "yawDeg">>) => void;
  /** Modifie le contour du châssis (maquette 2D) ET la boîte chassis 3D (length/width). */
  setChassisOutline: (patch: Partial<Body2D["outline"]>) => void;
  /** Pose/déplace (pos) ou retire (null) le marqueur de servo dans la maquette 2D. */
  setServoMarker: (servoId: number, pos: { x: number; z: number } | null) => void;
  /** Oriente le corps du servo coxa autour de son pignon (offset deg), ou réinitialise (null). */
  setCoxaServoAngle: (legIndex: number, deg: number | null) => void;
  /** Fusionne un patch dans body2D (contour polygonal, trous…). Recalcule la
   *  boîte chassis 3D quand le contour change. */
  setBody2D: (patch: Partial<Omit<Body2D, "version">>) => void;
  /** Remplace la composition de formes : rebake les morceaux + la bbox chassis. */
  setShapes: (shapes: Shape2D[]) => void;
  /** Cotes de mesure (persistées dans body2D). */
  addMeasurement: (a: { x: number; z: number }, b: { x: number; z: number }, aRef?: MeasureRef, bRef?: MeasureRef) => void;
  updateMeasurement: (id: string, patch: Partial<Pick<Measurement2D, "offset">>) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;
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
  setFootDragging: (v: boolean) => void;
  toggleCogAxisLock: (axis: "x" | "y" | "z") => void;
  setDescription: (d: string) => void;
  setServoCalibrationAll: (calib: Record<number, ServoCalibration>) => void;
  setCollisionPrefs: (prefs: Partial<CollisionPrefs>) => void;
  setWeightConfig: (cfg: Partial<WeightConfig>) => void;
  setTorqueEnabled: (v: boolean) => void;
  applyPose: (pose: Pose) => void;
  serializeProfile: () => RobotProfileData;
  /**
   * Signature JSON de la config "robot" du profil, hors layout des panneaux
   * (toolboxLayout/uiPrefs, éphémères et auto-sauvegardés séparément). Sert à
   * détecter les modifications non enregistrées du profil.
   */
  profileCoreSignature: () => string;
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
  footDragging: false,
  cogAxisLock: { x: false, y: false, z: false },
  description: "",
  servoCalibration: {},
  collisionPrefs: { ...DEFAULT_COLLISION_PREFS },
  weightConfig: {},
  torqueEnabled: false,

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
        legLayout: partial.legLayout ?? state.geometry.legLayout,
        // Préservé sur toute maj partielle (sinon supprimé silencieusement).
        segmentWidths: partial.segmentWidths ?? state.geometry.segmentWidths,
        segmentHeights: partial.segmentHeights ?? state.geometry.segmentHeights,
        // body2D doit survivre aux maj partielles, sinon une édition 2D serait
        // silencieusement perdue par tout setGeometry ultérieur (chassis, etc.).
        body2D: partial.body2D !== undefined ? partial.body2D : state.geometry.body2D,
      },
    })),

  replaceGeometry: (geometry) => set({ geometry }),

  setSegmentWidth: (legIndex, part, value) =>
    set((state) => {
      const g = state.geometry;
      // Matérialise les 6 entrées (en repartant des valeurs effectives) puis modifie celle visée.
      const arr = Array.from({ length: 6 }, (_, i) => ({ ...segmentWidthsOf(g, i) }));
      arr[legIndex] = { ...arr[legIndex], [part]: Math.max(0.001, value) };
      return { geometry: { ...g, segmentWidths: arr } };
    }),

  applySegmentWidthsToAll: (legIndex) =>
    set((state) => {
      const g = state.geometry;
      const src = segmentWidthsOf(g, legIndex);
      const arr = Array.from({ length: 6 }, () => ({ ...src }));
      return { geometry: { ...g, segmentWidths: arr } };
    }),

  setSegmentHeight: (legIndex, part, value) =>
    set((state) => {
      const g = state.geometry;
      const knee = projectServoWidthM();
      const arr = Array.from({ length: 6 }, (_, i) => resolvedHeights(g, i, knee));
      arr[legIndex] = { ...arr[legIndex], [part]: Math.max(0.001, value) };
      return { geometry: { ...g, segmentHeights: arr } };
    }),

  applySegmentHeightsToAll: (legIndex) =>
    set((state) => {
      const g = state.geometry;
      const src = resolvedHeights(g, legIndex, projectServoWidthM());
      const arr = Array.from({ length: 6 }, () => ({ ...src }));
      return { geometry: { ...g, segmentHeights: arr } };
    }),

  setLegAnchor: (index, patch) =>
    set((state) => {
      const g = state.geometry;
      // Démarre depuis les ancrages existants ou, à défaut, la sortie paramétrique
      // courante (garantit une maquette cohérente avec la 3D dès la 1re édition).
      const base: LegAnchor[] = g.body2D?.anchors && g.body2D.anchors.length === 6
        ? g.body2D.anchors
        : defaultAnchorsFromGeometry(g);
      const anchors = base.map((a) =>
        a.index === index ? { ...a, ...patch } : a
      );
      return { geometry: { ...g, body2D: mergeBody2D(g, { anchors }) } };
    }),

  setChassisOutline: (patch) =>
    set((state) => {
      const g = state.geometry;
      const outline = {
        length: g.chassis.length,
        width: g.chassis.width,
        ...(g.body2D?.outline ?? {}),
        ...patch,
      };
      // La boîte chassis 3D lit chassis.length/width → on les garde synchronisés.
      return {
        geometry: {
          ...g,
          chassis: { ...g.chassis, length: outline.length, width: outline.width },
          body2D: mergeBody2D(g, { outline }),
        },
      };
    }),

  setShapes: (shapes) =>
    set((state) => {
      const g = state.geometry;
      const { pieces, bbox } = bakeRealShapes(shapes);
      // bbox des morceaux ⇒ boîte chassis 3D (cohérence legmounts/CoG/appuis).
      const chassis = bbox.length > 0.001 && bbox.width > 0.001
        ? { ...g.chassis, length: bbox.length, width: bbox.width }
        : g.chassis;
      return { geometry: { ...g, chassis, body2D: mergeBody2D(g, { shapes, pieces }) } };
    }),

  setServoMarker: (servoId, pos) =>
    set((state) => {
      const g = state.geometry;
      const prev = g.body2D?.servoMarkers ?? [];
      const others = prev.filter((m) => m.servoId !== servoId);
      const servoMarkers = pos === null ? others : [...others, { servoId, x: pos.x, z: pos.z }];
      return { geometry: { ...g, body2D: mergeBody2D(g, { servoMarkers }) } };
    }),

  setCoxaServoAngle: (legIndex, deg) =>
    set((state) => {
      const g = state.geometry;
      const prev = g.body2D?.coxaServos ?? [];
      const others = prev.filter((c) => c.legIndex !== legIndex);
      const coxaServos = deg === null ? others : [...others, { legIndex, angleOffsetDeg: deg }];
      return { geometry: { ...g, body2D: mergeBody2D(g, { coxaServos }) } };
    }),

  setBody2D: (patch) =>
    set((state) => {
      const g = state.geometry;
      const body2D = mergeBody2D(g, patch);
      // Le contour polygonal fait foi pour la boîte englobante 3D (CoG, appuis sol).
      const chassis = body2D.points && body2D.points.length >= 3
        ? { ...g.chassis, ...polygonBounds(body2D.points) }
        : g.chassis;
      return { geometry: { ...g, chassis, body2D } };
    }),

  addMeasurement: (a, b, aRef, bRef) =>
    set((state) => {
      const g = state.geometry;
      const measurements = [...(g.body2D?.measurements ?? []), { id: newMeasurementId(), a, b, offset: 0, aRef, bRef }];
      return { geometry: { ...g, body2D: mergeBody2D(g, { measurements }) } };
    }),

  updateMeasurement: (id, patch) =>
    set((state) => {
      const g = state.geometry;
      const measurements = (g.body2D?.measurements ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
      return { geometry: { ...g, body2D: mergeBody2D(g, { measurements }) } };
    }),

  removeMeasurement: (id) =>
    set((state) => {
      const g = state.geometry;
      const measurements = (g.body2D?.measurements ?? []).filter((m) => m.id !== id);
      return { geometry: { ...g, body2D: mergeBody2D(g, { measurements }) } };
    }),

  clearMeasurements: () =>
    set((state) => {
      const g = state.geometry;
      return { geometry: { ...g, body2D: mergeBody2D(g, { measurements: [] }) } };
    }),

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

  applyPose: (pose) => set({ pose: pose.slice() }),

  exportKeyframesJson: () => JSON.stringify(get().keyframes, null, 2),

  setGravityEnabled: (enabled) => set({ gravityEnabled: enabled }),

  setBodyTransparent: (enabled) => set({ bodyTransparent: enabled }),

  setMirrorEnabled: (enabled) => set({ mirrorEnabled: enabled }),

  setCameraDirection: (dir) => set({ cameraDirection: dir }),

  toggleCompassLocked: () => set((s) => ({ compassLocked: !s.compassLocked })),

  setCogDragging: (v) => set({ cogDragging: v }),

  setFootDragging: (v) => set({ footDragging: v }),

  toggleCogAxisLock: (axis) =>
    set((s) => ({ cogAxisLock: { ...s.cogAxisLock, [axis]: !s.cogAxisLock[axis] } })),

  setDescription: (d) => set({ description: d }),

  setServoCalibrationAll: (calib) => set({ servoCalibration: calib }),

  setCollisionPrefs: (prefs) =>
    set((s) => ({ collisionPrefs: { ...s.collisionPrefs, ...prefs } })),

  setWeightConfig: (cfg) =>
    set((s) => ({ weightConfig: { ...s.weightConfig, ...cfg } })),

  setTorqueEnabled: (v) => set({ torqueEnabled: v }),

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
      version: 2,
      description: s.description || undefined,
      geometry: s.geometry,
      keyframes: s.keyframes,
      prefs: {
        mirrorEnabled: s.mirrorEnabled,
        gravityEnabled: s.gravityEnabled,
        bodyTransparent: s.bodyTransparent,
        cogAxisLock: { ...s.cogAxisLock },
        collisionPrefs: { ...s.collisionPrefs },
      },
      servoCalibration: Object.keys(s.servoCalibration).length > 0
        ? { ...s.servoCalibration }
        : undefined,
      toolboxLayout: { ...useToolboxStore.getState().configs },
      uiPrefs: { ...useToolboxStore.getState().uiPrefs },
      weightConfig: Object.keys(s.weightConfig).length > 0 ? { ...s.weightConfig } : undefined,
    };
  },

  profileCoreSignature: (): string => {
    const core = get().serializeProfile() as unknown as Record<string, unknown>;
    delete core.toolboxLayout;
    delete core.uiPrefs;
    return JSON.stringify(core);
  },

  applyProfile: (data: unknown) => {
    const d = data as RobotProfileData;
    if (!d || (d.version !== 1 && d.version !== 2)) return;
    // Migration : ancien body2D (contour unique points/holes) → composition de
    // formes + morceaux bakés, sans perdre le tracé existant.
    const b2 = d.geometry?.body2D;
    if (b2 && !b2.shapes && b2.points && b2.points.length >= 3) {
      b2.shapes = [{ id: "legacy", layer: "real", op: "add", poly: b2.points }];
      b2.pieces = [{ outer: b2.points, holes: b2.holes ?? [] }];
    }
    // Dé-duplication des ids de formes : d'anciennes sessions (compteur remis à 0
    // au reload) ont pu enregistrer des ids identiques → sélectionner l'une
    // surlignait les deux. On réattribue un id unique aux doublons.
    if (b2?.shapes) {
      const seen = new Set<string>();
      b2.shapes = b2.shapes.map((s, i) => {
        if (!seen.has(s.id)) { seen.add(s.id); return s; }
        let id = `${s.id}_${i}`;
        while (seen.has(id)) id += "_";
        seen.add(id);
        return { ...s, id };
      });
    }
    // Même dé-duplication pour les cotes de mesure : d'anciens profils (compteur
    // remis à 0 au reload) ont pu enregistrer des ids identiques → déplacer une
    // cote en déplaçait plusieurs (updateMeasurement matche tous les ids égaux).
    if (b2?.measurements) {
      const seen = new Set<string>();
      b2.measurements = b2.measurements.map((m, i) => {
        if (!seen.has(m.id)) { seen.add(m.id); return m; }
        let id = `${m.id}_${i}`;
        while (seen.has(id)) id += "_";
        seen.add(id);
        return { ...m, id };
      });
    }
    const calib: Record<number, ServoCalibration> = {};
    if (d.servoCalibration) {
      for (const [k, v] of Object.entries(d.servoCalibration)) {
        const raw = v as unknown as Record<string, number | boolean>;
        calib[Number(k)] = {
          zeroOffsetDeg: (raw.zeroOffsetDeg as number) ?? 0,
          hardMinDeg: (raw.hardMinDeg as number) ?? (raw.minDeg as number) ?? -90,
          hardMaxDeg: (raw.hardMaxDeg as number) ?? (raw.maxDeg as number) ?? 90,
          softMinDeg: (raw.softMinDeg as number) ?? (raw.minDeg as number) ?? -90,
          softMaxDeg: (raw.softMaxDeg as number) ?? (raw.maxDeg as number) ?? 90,
          invert: (raw.invert as boolean) ?? false,
        };
      }
    }
    set({
      geometry: {
        ...DEFAULT_GEOMETRY,
        ...d.geometry,
        cog: d.geometry.cog ?? DEFAULT_GEOMETRY.cog,
        // Maquette 2D : présente => source de vérité ; absente (anciens profils)
        // => undefined => computeLegMounts retombe sur le calcul paramétrique.
        body2D: d.geometry.body2D,
      },
      keyframes: d.keyframes,
      mirrorEnabled: d.prefs.mirrorEnabled,
      gravityEnabled: d.prefs.gravityEnabled,
      bodyTransparent: d.prefs.bodyTransparent,
      cogAxisLock: d.prefs.cogAxisLock ?? { x: false, y: false, z: false },
      collisionPrefs: { ...DEFAULT_COLLISION_PREFS, ...(d.prefs.collisionPrefs ?? {}) },
      description: d.description ?? "",
      servoCalibration: calib,
      pose: defaultPose(),
      weightConfig: d.weightConfig ?? {},
    });
    if (d.toolboxLayout) {
      useToolboxStore.getState().applyLayout(d.toolboxLayout);
    }
    if (d.uiPrefs) {
      useToolboxStore.getState().applyUiPrefs(d.uiPrefs);
    }
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
