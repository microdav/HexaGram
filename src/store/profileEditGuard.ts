import { useProfilesStore } from "./useProfilesStore";
import { useHexapodStore } from "./useHexapodStore";

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
 * La sauvegarde du profil est toujours automatique : on persiste les éventuelles
 * modifications en cours puis on poursuit, sans invite.
 *
 * @returns `true` — l'appelant peut toujours poursuivre.
 */
export async function guardProfileEdit(): Promise<boolean> {
  const { activeProfileId } = useProfilesStore.getState();
  if (!activeProfileId || !isProfileDirty()) return true;
  await useProfilesStore.getState().update(activeProfileId);
  return true;
}
