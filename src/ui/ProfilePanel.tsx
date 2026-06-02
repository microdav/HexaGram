import { useState, useEffect } from "react";
import { useProfilesStore } from "../store/useProfilesStore";
import { useHexapodStore } from "../store/useHexapodStore";
import { useAuthStore } from "../store/useAuthStore";
import { useToastStore } from "../store/useToastStore";
import { ProfileSettingsModal } from "./ProfileSettingsModal";

export function ProfilePanel() {
  const user = useAuthStore((s) => s.user);
  const activeProfileId = useProfilesStore((s) => s.activeProfileId);
  const profiles = useProfilesStore((s) => s.profiles);
  const updateProfile = useProfilesStore((s) => s.update);
  const savedSignature = useProfilesStore((s) => s.savedSignature);
  const autoSave = useProfilesStore((s) => s.autoSave);

  const showToast = useToastStore((s) => s.show);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Vrai quand la config robot diffère de la dernière version enregistrée.
  const [dirty, setDirty] = useState(false);

  // Recalcule l'état "modifié" à chaque changement de la config robot et quand
  // la signature de référence change (après enregistrement/chargement).
  useEffect(() => {
    const compute = () => {
      setDirty(savedSignature != null && useHexapodStore.getState().profileCoreSignature() !== savedSignature);
    };
    compute();
    return useHexapodStore.subscribe(compute);
  }, [savedSignature]);

  if (!user) return null;

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  // La base mécanique existe toujours (créée automatiquement à l'ouverture du
  // projet) → l'enregistrement est toujours une mise à jour.
  const handleSave = async () => {
    if (!activeProfileId) return;
    setSaving(true);
    try {
      await updateProfile(activeProfileId);
      showToast(`Base mécanique « ${activeProfile?.name} » sauvegardée`);
    } finally { setSaving(false); }
  };

  const handleAutoSaveChange = async (checked: boolean) => {
    useProfilesStore.getState().setAutoSave(checked);
    // En activant l'option, on enregistre immédiatement une modif en attente.
    if (checked && activeProfileId && dirty) {
      setSaving(true);
      try { await updateProfile(activeProfileId); } finally { setSaving(false); }
    }
  };

  return (
    <div className="panel profile-panel">
      <div className="profile-panel-row">
        <span className="profile-name-label">Base mécanique</span>
        <span className="profile-name-value">
          {activeProfile ? activeProfile.name : <em>aucune</em>}
        </span>
        <button
          type="button"
          className="btn btn-icon btn-save-profile"
          disabled={saving || !activeProfileId || !dirty}
          title={
            activeProfile
              ? dirty ? `Sauvegarder « ${activeProfile.name} »` : "Aucune modification à enregistrer"
              : "Aucune base mécanique"
          }
          onClick={handleSave}
        >
          {saving ? "…" : "💾"}
        </button>
      </div>

      {activeProfileId && (
        <label
          className="profile-autosave"
          title="Enregistrer automatiquement les réglages du profil"
        >
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => handleAutoSaveChange(e.target.checked)}
          />
          <span>Enregistrer automatiquement</span>
        </label>
      )}

      <div className="profile-panel-gear-row">
        <button
          type="button"
          className="btn btn-profile-gear"
          title="Paramètres du profil"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙ Paramétrage robot
        </button>
      </div>

      <ProfileSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
