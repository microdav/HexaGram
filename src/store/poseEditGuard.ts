import type { SavedPose } from "../model/pose";
import { posesEqual } from "./stepEditGuard";
import { useHexapodStore } from "./useHexapodStore";
import { useSequencerStore } from "./useSequencerStore";
import { useSavedPosesStore } from "./useSavedPosesStore";
import { confirmTri } from "./useConfirmStore";

/**
 * Retourne la pose sélectionnée dans la boîte « Poses » si sa représentation 3D
 * a été modifiée (l'utilisateur a bougé des servos depuis qu'il l'a appliquée),
 * sinon `null`. Pas de modification en attente pendant la lecture, où la pose du
 * robot suit la séquence.
 */
export function getPendingPoseEdit(): SavedPose | null {
  const { selectedPoseId, getById } = useSavedPosesStore.getState();
  if (!selectedPoseId) return null;
  if (useSequencerStore.getState().isPlaying) return null;
  const pose = getById(selectedPoseId);
  if (!pose) return null;
  const live = useHexapodStore.getState().pose;
  if (posesEqual(live, pose.angles)) return null;
  return pose;
}

/**
 * Garde à appeler avant tout changement de contexte (sélection d'une autre pose,
 * activation d'une étape, sortie de la page Conception…). S'il existe une pose
 * sélectionnée modifiée, propose « Remplacer / Nouvelle pose / Abandonner /
 * Annuler ». Le remplacement d'une pose liée à des steps déclenche une seconde
 * modale (propager aux steps liés / pose seulement).
 *
 * @returns `true` si l'appelant peut poursuivre, `false` s'il doit annuler.
 */
export async function guardPoseEdit(): Promise<boolean> {
  const pose = getPendingPoseEdit();
  if (!pose) return true;

  const live = useHexapodStore.getState().pose.slice();
  const store = useSavedPosesStore.getState();

  const res = await confirmTri({
    title: "Pose modifiée",
    message: `La pose « ${pose.name} » a été modifiée.`,
    confirmLabel: `Remplacer « ${pose.name} »`,
    altLabel: "Nouvelle pose",
    discardLabel: "Abandonner",
    cancelLabel: "Annuler",
  });

  if (res === "cancel") return false;

  if (res === "alt") {
    // Enregistrer comme nouvelle pose, qui devient la pose sélectionnée.
    const created = await store.add(`Pose ${store.poses.length + 1}`, live);
    store.setSelectedPoseId(created.id);
    return true;
  }

  if (res === "discard") {
    // Abandonner : on rétablit les angles enregistrés de la pose sur le robot.
    useHexapodStore.getState().applyPose(pose.angles);
    return true;
  }

  // res === "confirm" → remplacer la pose existante.
  const u = await store.usage(pose.id);
  if (u.total > 0) {
    const choice = await confirmTri({
      title: "Pose liée à des steps",
      message: [
        `Cette pose est utilisée par ${u.total} étape(s) dans ${u.sequences.length} séquence(s).`,
        "Que voulez-vous faire de votre modification ?",
      ],
      confirmLabel: "Mettre à jour les steps liés",
      discardLabel: "Pose seulement",
      cancelLabel: "Annuler",
    });
    if (choice === "cancel") return false;
    if (choice === "confirm") {
      await store.propagateAngles(pose.id, live);
    } else {
      await store.updateAngles(pose.id, live);
    }
  } else {
    await store.updateAngles(pose.id, live);
  }
  return true;
}
