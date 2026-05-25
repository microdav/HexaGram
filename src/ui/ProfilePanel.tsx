import { useState } from "react";
import { useProfilesStore } from "../store/useProfilesStore";
import { useAuthStore } from "../store/useAuthStore";
import { useToastStore } from "../store/useToastStore";
import { Modal } from "./Modal";
import { ProfileSettingsModal } from "./ProfileSettingsModal";

export function ProfilePanel() {
  const user = useAuthStore((s) => s.user);
  const activeProfileId = useProfilesStore((s) => s.activeProfileId);
  const profiles = useProfilesStore((s) => s.profiles);
  const saveProfile = useProfilesStore((s) => s.save);
  const updateProfile = useProfilesStore((s) => s.update);
  const loadProfile = useProfilesStore((s) => s.load);

  const showToast = useToastStore((s) => s.show);

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="panel profile-panel">
      <div className="profile-panel-row">
        <span className="profile-name-label">Profil</span>
        {profiles.length > 0 ? (
          <select
            className="profile-select"
            aria-label="Profil robot actif"
            value={activeProfileId ?? ""}
            onChange={(e) => e.target.value && loadProfile(e.target.value)}
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
          disabled={saving}
          title={activeProfile ? `Sauvegarder « ${activeProfile.name} »` : "Sauvegarder le profil…"}
          onClick={handleSave}
        >
          {saving ? "…" : "💾"}
        </button>
      </div>

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
