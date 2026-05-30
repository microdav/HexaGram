import { SERVOS, LEG_NAMES } from './hexapod';
import { defaultPose, type Pose } from './pose';

/**
 * (Dé)sérialisation d'une pose seule au format JSON.
 *
 * Le format est aligné sur celui des étapes de séquence (dict de servos avec
 * des clés lisibles « Avant gauche - coxa (S0) »), pour qu'une pose exportée
 * ici puisse être relue par l'import de séquence et inversement. L'import
 * accepte aussi des variantes laxistes (tableau brut de 18 angles, champ
 * `angles`, dict de servos à la racine).
 */

export interface PoseFile {
  name: string;
  pose: Record<string, number>;
}

/** Construit le dictionnaire lisible { "Avant gauche - coxa (S0)": angle, ... }. */
export function poseToDict(pose: Pose): Record<string, number> {
  return Object.fromEntries(
    SERVOS.map((servo) => [
      `${LEG_NAMES[servo.legIndex]} - ${servo.joint} (S${servo.id})`,
      +(pose[servo.id] ?? 0).toFixed(2),
    ])
  );
}

/** Sérialise une pose en JSON indenté, prêt à télécharger. */
export function poseToJson(name: string, pose: Pose): string {
  const payload: PoseFile = { name, pose: poseToDict(pose) };
  return JSON.stringify(payload, null, 2);
}

/** Reconstruit une pose depuis un dict de servos (clés « ... (S<id>) »). */
export function dictToPose(dict: Record<string, unknown>): Pose {
  const pose = defaultPose();
  for (const [key, value] of Object.entries(dict)) {
    const m = key.match(/\(S(\d+)\)\s*$/);
    if (!m) continue;
    const id = Number(m[1]);
    if (!Number.isInteger(id) || id < 0 || id >= SERVOS.length) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    pose[id] = value;
  }
  return pose;
}

/** Reconstruit une pose depuis un tableau brut d'angles. */
export function arrayToPose(arr: unknown[]): Pose {
  const pose = defaultPose();
  for (let i = 0; i < pose.length && i < arr.length; i++) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) pose[i] = v;
  }
  return pose;
}

/**
 * Parse un JSON de pose. Lève une `Error` si le texte n'est pas exploitable.
 * Renvoie le nom (si présent dans le fichier) et la pose reconstruite.
 */
export function parsePoseJson(text: string): { name: string | null; pose: Pose } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('JSON invalide : ' + (e instanceof Error ? e.message : 'erreur de parsing'));
  }

  // Tableau brut de 18 angles
  if (Array.isArray(data)) {
    return { name: null, pose: arrayToPose(data) };
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Le JSON doit être un objet ou un tableau d\'angles.');
  }

  const obj = data as Record<string, unknown>;
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name : null;

  // Champ `angles` (format SavedPose) — tableau d'angles
  if (Array.isArray(obj.angles)) {
    return { name, pose: arrayToPose(obj.angles) };
  }
  // Champ `pose` (format étape de séquence) — dict de servos
  if (obj.pose && typeof obj.pose === 'object' && !Array.isArray(obj.pose)) {
    return { name, pose: dictToPose(obj.pose as Record<string, unknown>) };
  }
  // Dict de servos directement à la racine
  return { name, pose: dictToPose(obj) };
}
