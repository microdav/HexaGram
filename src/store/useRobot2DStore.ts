import { create } from "zustand";
import type { Pt2, ShapeLayer } from "../model/hexapod";

/** Cible d'édition courante dans l'éditeur 2D. */
export type Robot2DTarget =
  | { type: "chassis" }
  | { type: "leg"; index: number }
  | null;

/** Outil actif (barre d'outils flottante). */
export type Robot2DTool = "select" | "pen" | "rect" | "circle" | "placeServo" | "measure";

/**
 * État transient de l'éditeur « Robot 2D ». NON persisté dans la base mécanique :
 * la géométrie elle-même vit dans useHexapodStore (source de vérité unique).
 * Ce store ne porte que l'état d'interface (sélection, outil, vue, options).
 */
interface Robot2DState {
  selected: Robot2DTarget;
  tool: Robot2DTool;
  snapEnabled: boolean;
  /** Pas de la grille de magnétisme, en centimètres. */
  snapStepCm: number;
  /** Pas de déplacement aux flèches du clavier (forme sélectionnée), en centimètres. */
  keyboardStepCm: number;
  /** Affiche les marqueurs de servo le long des pattes. */
  showServos: boolean;
  /** Facteur de zoom (1 = ajustement automatique au contenu). */
  zoom: number;
  /** Décalage de panoramique, en pixels écran. */
  pan: { x: number; y: number };
  /** Incrémenté pour forcer un ré-ajustement de l'échelle (resize / recentrage). */
  fitEpoch: number;
  /** Premier point posé en cours de tracé d'une mesure (null = aucun). Les cotes
   *  validées vivent dans body2D.measurements (useHexapodStore), donc persistées. */
  pendingMeasure: { x: number; z: number } | null;
  /** Calque actif pour la création de formes. */
  activeLayer: ShapeLayer;
  /** Forme sélectionnée (id) — pour déplacement / édition / suppression. */
  selectedShapeId: string | null;
  /** Sommets en cours de tracé au crayon (vide = pas de tracé). */
  penPoints: Pt2[];

  select: (t: Robot2DTarget) => void;
  setTool: (t: Robot2DTool) => void;
  setSnapEnabled: (v: boolean) => void;
  setSnapStepCm: (v: number) => void;
  setKeyboardStepCm: (v: number) => void;
  setShowServos: (v: boolean) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  resetView: () => void;
  setPendingMeasure: (p: { x: number; z: number } | null) => void;
  setActiveLayer: (l: ShapeLayer) => void;
  selectShape: (id: string | null) => void;
  setPenPoints: (pts: Pt2[]) => void;
}

let _shapeSeq = 0;
/**
 * Identifiant de forme unique, y compris APRÈS un rechargement : on combine un
 * horodatage (base 36) et un compteur. Sans l'horodatage, le compteur repartant
 * de 0 au reload re-générait `s1`, `s2`… en collision avec les formes déjà
 * chargées depuis la base (deux formes sélectionnées à la fois).
 */
export function newShapeId(): string {
  return `s${Date.now().toString(36)}${(++_shapeSeq).toString(36)}`;
}

export const useRobot2DStore = create<Robot2DState>((set) => ({
  selected: { type: "chassis" },
  tool: "select",
  snapEnabled: true,
  snapStepCm: 0.1,
  keyboardStepCm: 0.01,
  showServos: true,
  zoom: 1,
  pan: { x: 0, y: 0 },
  fitEpoch: 0,
  pendingMeasure: null,
  activeLayer: "real",
  selectedShapeId: null,
  penPoints: [],

  select: (selected) => set({ selected }),
  // Changer d'outil annule un tracé crayon en cours et un point de mesure pendant.
  setTool: (tool) => set({ tool, pendingMeasure: null, penPoints: [] }),
  setActiveLayer: (activeLayer) => set({ activeLayer }),
  selectShape: (selectedShapeId) => set({ selectedShapeId }),
  setPenPoints: (penPoints) => set({ penPoints }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setSnapStepCm: (snapStepCm) => set({ snapStepCm: Math.max(0.1, snapStepCm) }),
  setKeyboardStepCm: (keyboardStepCm) => set({ keyboardStepCm: Math.max(0.001, keyboardStepCm) }),
  setShowServos: (showServos) => set({ showServos }),
  setZoom: (zoom) => set({ zoom: Math.max(0.2, Math.min(6, zoom)) }),
  setPan: (pan) => set({ pan }),
  resetView: () => set((s) => ({ zoom: 1, pan: { x: 0, y: 0 }, fitEpoch: s.fitEpoch + 1 })),
  setPendingMeasure: (pendingMeasure) => set({ pendingMeasure }),
}));
