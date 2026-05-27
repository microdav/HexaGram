import { useState, useEffect } from "react";
import { useProfilesStore } from "../store/useProfilesStore";
import { useHexapodStore } from "../store/useHexapodStore";
import { useAuthStore } from "../store/useAuthStore";
import { useToastStore } from "../store/useToastStore";
import { guardProfileEdit } from "../store/profileEditGuard";
import { Modal } from "./Modal";
import { ProfileSettingsModal } from "./ProfileSettingsModal";

export function ProfilePanel() {
  const user = useAuthStore((s) => s.user);
  const activeProfileId = useProfilesStore((s) => s.activeProfileId);
  const profiles = useProfilesStore((s) => s.profiles);
  const saveProfile = useProfilesStore((s) => s.save);
  const updateProfile = useProfilesStore((s) => s.update);
  const loadProfile = useProfilesStore((s) => s.load);
  const savedSignature = useProfilesStore((s) => s.savedSignature);
  const autoSave = useProfilesStore((s) => s.autoSave);

  const showToast = useToastStore((s) => s.show);

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
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

  const handleSave = async () => {
    if (activeProfileId) {
      setSaving(true);
      try {
        await updateProfile(activeProfileId);
        showToast(`Profil « ${activeProfile?.name} » sauvegardé`);
      } finally { setSaving(false); }
    } else {
      setNewProfileName("");
      setSaveModalOpen(true);
    }
  };

  const handleModalSave = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await saveProfile(name);
      setSaveModalOpen(false);
      showToast(`Profil « ${name} » créé`);
    } finally {
      setSaving(false);
    }
  };

  // Changement de profil protégé : on propose d'enregistrer les réglages en
  // cours avant de charger un autre profil.
  const handleSelectProfile = async (id: string) => {
    if (!id || id === activeProfileId) return;
    if (!(await guardProfileEdit())) return;
    loadProfile(id);
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
        <span className="profile-name-label">Profil</span>
        {profiles.length > 0 ? (
          <select
            className="profile-select"
            aria-label="Profil robot actif"
            value={activeProfileId ?? ""}
            onChange={(e) => handleSelectProfile(e.target.value)}
          >
            {!activeProfileId && <option value="">— choisir —</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ) : (
          <span className="profile-name-value"><em>aucun</em></span>
        )}
        <button
          type="button"
          className="btn btn-icon btn-save-profile"
          disabled={saving || (!!activeProfileId && !dirty)}
          title={
            activeProfile
              ? dirty ? `Sauvegarder « ${activeProfile.name} »` : "Aucune modification à enregistrer"
              : "Sauvegarder le profil…"
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

      <Modal open={saveModalOpen} onClose={() => setSaveModalOpen(false)}>
        <h3 className="modal-title">Nouveau profil robot</h3>
        <label className="modal-field">
          <span>Nom du profil</span>
          <input
            type="text"
            value={newProfileName}
            autoFocus
            placeholder="ex : Hexapode v1"
            onChange={(e) => setNewProfileName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleModalSave()}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setSaveModalOpen(false)}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !newProfileName.trim()}
            onClick={handleModalSave}
          >
            {saving ? "Création…" : "Créer"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
