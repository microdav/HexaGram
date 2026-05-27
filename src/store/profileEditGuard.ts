import { useProfilesStore } from "./useProfilesStore";
import { useHexapodStore } from "./useHexapodStore";
import { confirmTri } from "./useConfirmStore";

/**
 * Vrai si la config robot du profil actif diffère de la dernière version
 * enregistrée (modifications non enregistrées). Le layout des panneaux est
 * exclu de la comparaison (auto-sauvegardé séparément).
 */
export function isProfileDirty(): boolean {
  const { activeProfileId, savedSignature } = useProfilesStore.getState();
  if (!activeProfileId || savedSignature == null) return false;
  return useHexapodStore.getState().profileCoreSignature() !== savedSignature;
}

/**
 * Garde à appeler avant tout changement de contexte susceptible de perdre les
 * réglages du profil (changement de profil, sortie de la page Conception…).
 * Propose « Enregistrer / Abandonner / Annuler » s'il y a des modifications.
 *
 * @returns `true` si l'appelant peut poursuivre, `false` s'il doit annuler.
 */
export async function guardProfileEdit(): Promise<boolean> {
  const { activeProfileId, autoSave } = useProfilesStore.getState();
  if (!activeProfileId || !isProfileDirty()) return true;

  if (autoSave) {
    await useProfilesStore.getState().update(activeProfileId);
    return true;
  }

  const name =
    useProfilesStore.getState().profiles.find((p) => p.id === activeProfileId)?.name ?? "";
  const res = await confirmTri({
    title: "Profil non enregistré",
    message: `Les réglages du profil « ${name} » ont été modifiés.`,
    confirmLabel: "Enregistrer",
    discardLabel: "Abandonner",
    cancelLabel: "Annuler",
  });

  if (res === "cancel") return false;

  if (res === "confirm") {
    await useProfilesStore.getState().update(activeProfileId);
  } else {
    // Abandonner : recharge le profil enregistré (restaure aussi la signature).
    await useProfilesStore.getState().load(activeProfileId);
  }
  return true;
}
