import type { Pose } from "./pose";
import type { Program } from "./program";
import type { SavedSequence } from "../store/useSavedSequencesStore";
import type { SequencerStep } from "../store/useSequencerStore";
import { MAX_FPS } from "../store/useSequencerStore";
import type { HexapodGeometry, LegMount } from "./hexapod";
import { buildTransitionFrames, type TransitionOptions } from "./transitionPlanner";

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
 * Contexte cinématique optionnel pour la génération d'images. Fourni par la
 * salle d'exécution (géométrie + ancrages du robot actif). Lorsqu'il est
 * présent, les passages d'une séquence à une autre (changement de `stepIndex`,
 * y compris init → 1ʳᵉ séquence) sont générés par le planificateur de
 * transition — pieds levés, équilibre et orientation préservés — au lieu d'une
 * interpolation linéaire des angles.
 */
export interface PlaybackContext {
  geometry: HexapodGeometry;
  mounts: LegMount[];
  transition?: TransitionOptions;
}

/**
 * Construit la liste d'images jouables.
 *
 * À l'intérieur d'une même séquence (keyframes de même `stepIndex`), on insère
 * des images interpolées linéairement, à la cadence de `buildInterpolated` du
 * séquenceur (≈ stepDelay × MAX_FPS images par transition).
 *
 * Au passage d'une séquence à la suivante (`stepIndex` différent), si un
 * `PlaybackContext` est fourni, on insère des images de transition physiquement
 * saines (cf. {@link buildTransitionFrames}). Sans contexte, on retombe sur
 * l'interpolation linéaire (compatibilité ascendante).
 *
 * Pas d'interpolation de bouclage : un saut de boucle est traité comme une
 * discontinuité par l'intégrateur de locomotion.
 */
export function buildPlaybackFrames(
  keyframes: ProgramKeyframe[],
  stepDelay: number,
  ctx?: PlaybackContext,
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

    const isSequenceBoundary = a.stepIndex !== b.stepIndex;
    if (isSequenceBoundary && ctx) {
      // Transition inter-séquences : génération physique (pieds levés, équilibre).
      const mid = buildTransitionFrames(a.pose, b.pose, ctx.geometry, ctx.mounts, {
        fps: MAX_FPS,
        ...ctx.transition,
      });
      for (const pose of mid) {
        frames.push({ pose, stepIndex: b.stepIndex, isKeyframe: false });
      }
    } else {
      // Intra-séquence (ou pas de contexte) : interpolation linéaire des angles.
      for (let f = 1; f <= insertCount; f++) {
        const t = f / (insertCount + 1);
        frames.push({
          pose: a.pose.map((angle, k) => angle + (b.pose[k] - angle) * t),
          stepIndex: b.stepIndex,
          isKeyframe: false,
        });
      }
    }
  }
  const last = keyframes[keyframes.length - 1];
  frames.push({ pose: last.pose.slice(), stepIndex: last.stepIndex, isKeyframe: true });

  return frames;
}
