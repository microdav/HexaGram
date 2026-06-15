import { SERVOS } from "./hexapod";

export type Pose = number[];

export const defaultPose = (): Pose => SERVOS.map((s) => s.defaultDeg);

export const servoIndex = (legIndex: number, joint: "coxa" | "femur" | "tibia"): number => {
  const offset = joint === "coxa" ? 0 : joint === "femur" ? 1 : 2;
  return legIndex * 3 + offset;
};

/**
 * Angle modèle (deg) où la position physique de référence d'une articulation est
 * la plus facile à identifier pour caler le zéro mécanique :
 *  - coxa : patte dans son axe (0°)
 *  - fémur : horizontal (0°)
 *  - tibia : perpendiculaire au fémur (−90°) — sur les montages courants c'est le
 *    centre du servo ; le tibia ne s'aligne jamais à plat avec le fémur.
 */
export const JOINT_REFERENCE_DEG: Record<"coxa" | "femur" | "tibia", number> = {
  coxa: 0,
  femur: 0,
  tibia: -90,
};

/** Pose de référence (repère par articulation) — pattes tendues, tibias perpendiculaires. */
export const referencePose = (): Pose => SERVOS.map((s) => JOINT_REFERENCE_DEG[s.joint]);

export interface Keyframe {
  id: string;
  name: string;
  pose: Pose;
  createdAt: number;
}

/**
 * Pose enregistrée dans le projet (table `poses` côté backend, persist local en démo).
 * Réutilisable par drag-and-drop dans le séquenceur ; un step créé garde un
 * `sourcePoseId` pointant ici, ce qui permet la propagation (lien) ou la rupture.
 */
export interface SavedPose {
  id: string;
  /** null en mode démo (pas de projet). */
  projectId: string | null;
  /** Profil robot actif au moment de l'enregistrement (null en démo). */
  profileId: string | null;
  name: string;
  angles: Pose;
  /** Ordre dans la grille de la toolbox. */
  position: number;
  /**
   * Vignette PNG (dataURL) générée côté client et persistée pour réutilisation.
   * Validée à l'hydratation via `thumbnailContext` ; ignorée si le contexte
   * de rendu actuel (géométrie/gravité/transparence/caméra) a changé.
   */
  thumbnail?: string | null;
  thumbnailContext?: string | null;
  createdAt: number;
  updatedAt: number;
}
