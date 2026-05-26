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
  createdAt: number;
  updatedAt: number;
}
