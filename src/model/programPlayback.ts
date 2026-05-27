import type { Pose } from "./pose";
import type { Program } from "./program";
import type { SavedSequence } from "../store/useSavedSequencesStore";
import type { SequencerStep } from "../store/useSequencerStore";
import { MAX_FPS } from "../store/useSequencerStore";

/**
 * Une keyframe de lecture : pose définie + l'index de l'étape du programme dont
 * elle provient (-1 pour la pose d'init). Sert de cible aux boucles « → Étape N ».
 * `id`/`name` reprennent le step source (réutilise le cache de vignettes pour la frise).
 */
export interface ProgramKeyframe {
  pose: Pose;
  stepIndex: number;
  id: string;
  name: string;
}

/**
 * Une image de lecture : pose à appliquer + index d'étape source + drapeau
 * indiquant si c'est une keyframe (pose définie) ou une image interpolée.
 */
export interface ProgramFrame {
  pose: Pose;
  stepIndex: number;
  isKeyframe: boolean;
}

/**
 * Aplatit un programme en une liste ordonnée de keyframes : pose d'init (si
 * présente) puis, pour chaque étape, les poses définies de la séquence référencée
 * ou des steps inline. Les séquences `ref` sont résolues via `getSequence`
 * (réutilise useSavedSequencesStore.getSequence).
 */
export async function resolveProgramKeyframes(
  program: Pick<Program, "initPose" | "steps">,
  getSequence: (id: string) => Promise<SavedSequence>,
): Promise<ProgramKeyframe[]> {
  const out: ProgramKeyframe[] = [];

  if (program.initPose) {
    out.push({ pose: program.initPose.slice(), stepIndex: -1, id: "init", name: "Init" });
  }

  for (let i = 0; i < program.steps.length; i++) {
    const step = program.steps[i];
    let defined: SequencerStep[] = [];
    if (step.type === "ref") {
      if (!step.sequenceId) continue;
      try {
        const seq = await getSequence(step.sequenceId);
        defined = seq.steps.filter((s) => s.type !== "interpolated");
      } catch {
        defined = [];
      }
    } else {
      defined = step.steps.filter((s) => s.type !== "interpolated");
    }
    for (const d of defined) {
      out.push({ pose: d.pose.slice(), stepIndex: i, id: d.id, name: d.name });
    }
  }

  return out;
}

/**
 * Construit la liste d'images jouables en insérant des images interpolées
 * linéairement entre keyframes consécutives. Même cadence d'insertion que
 * `buildInterpolated` du séquenceur (≈ stepDelay × MAX_FPS images par transition).
 * Pas d'interpolation de bouclage : un saut de boucle est traité comme une
 * discontinuité par l'intégrateur de locomotion.
 */
export function buildPlaybackFrames(
  keyframes: ProgramKeyframe[],
  stepDelay: number,
): ProgramFrame[] {
  if (keyframes.length === 0) return [];
  if (keyframes.length === 1) {
    return [{ pose: keyframes[0].pose.slice(), stepIndex: keyframes[0].stepIndex, isKeyframe: true }];
  }

  const insertCount = Math.max(0, Math.round(stepDelay * MAX_FPS) - 1);
  const frames: ProgramFrame[] = [];

  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    frames.push({ pose: a.pose.slice(), stepIndex: a.stepIndex, isKeyframe: true });
    for (let f = 1; f <= insertCount; f++) {
      const t = f / (insertCount + 1);
      frames.push({
        pose: a.pose.map((angle, k) => angle + (b.pose[k] - angle) * t),
        stepIndex: b.stepIndex,
        isKeyframe: false,
      });
    }
  }
  const last = keyframes[keyframes.length - 1];
  frames.push({ pose: last.pose.slice(), stepIndex: last.stepIndex, isKeyframe: true });

  return frames;
}
