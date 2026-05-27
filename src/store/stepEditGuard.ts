import type { Pose } from "../model/pose";
import type { SequencerStep } from "./useSequencerStore";
import { useSequencerStore } from "./useSequencerStore";
import { useHexapodStore } from "./useHexapodStore";
import { confirmTri } from "./useConfirmStore";

/** Tolérance (en degrés) sous laquelle deux poses sont considérées identiques. */
const POSE_EPSILON = 0.01;

export function posesEqual(a: Pose, b: Pose): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > POSE_EPSILON) return false;
  }
  return true;
}

/**
 * Retourne l'étape actuellement sélectionnée si sa pose 3D a été modifiée mais
 * pas encore appliquée (l'utilisateur a bougé des servos sans cliquer
 * « Appliquer »). Sinon `null`.
 *
 * On ne considère pas de modification en attente pendant la lecture, où la pose
 * du robot suit la séquence et non une édition manuelle.
 */
export function getPendingStepEdit(): SequencerStep | null {
  const seq = useSequencerStore.getState();
  if (seq.isPlaying) return null;
  const idx = seq.selectedStepIndex;
  if (idx < 0) return null;
  const step = seq.steps[idx];
  if (!step) return null;
  const live = useHexapodStore.getState().pose;
  if (posesEqual(live, step.pose)) return null;
  return step;
}

/**
 * Garde à appeler avant tout changement de contexte (changement d'étape, sortie
 * de la page Conception…). S'il existe une modification de pose non appliquée,
 * propose « Appliquer / Abandonner / Annuler ».
 *
 * @returns `true` si l'appelant peut poursuivre la navigation, `false` s'il doit
 * l'annuler (l'utilisateur a choisi « Annuler »).
 */
export async function guardStepEdit(): Promise<boolean> {
  const step = getPendingStepEdit();
  if (!step) return true;

  const live = useHexapodStore.getState().pose.slice();

  // Enregistrement automatique : on applique sans demander. Les étapes liées à
  // une pose enregistrée restent arbitrées par la modale (le lien doit être
  // tranché à la main), donc on ne court-circuite que les étapes indépendantes.
  if (useSequencerStore.getState().autoApply && !step.sourcePoseId) {
    useSequencerStore.getState().updateStepPose(step.id, live);
    return true;
  }

  const res = await confirmTri({
    title: "Modification non enregistrée",
    message: `La pose de l'étape « ${step.name} » a été modifiée mais pas appliquée.`,
    confirmLabel: "Appliquer",
    discardLabel: "Abandonner",
    cancelLabel: "Annuler",
  });

  if (res === "cancel") return false;

  if (res === "confirm") {
    // Pour une étape liée à une pose enregistrée, requestStepPoseUpdate lève un
    // PendingPoseConflict que l'utilisateur arbitre via PoseConflictModal.
    useSequencerStore.getState().requestStepPoseUpdate(step.id, live);
  } else {
    // Abandonner : on rétablit la pose stockée de l'étape sur le robot.
    useHexapodStore.getState().applyPose(step.pose);
  }
  return true;
}
