import { useState } from "react";
import { useProfilesStore } from "../store/useProfilesStore";

export function ProfileMenu() {
  const { profiles, activeProfileId, loading, save, update, load, rename, remove } = useProfilesStore();
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function handleSave() {
    const name = newName.trim() || `Robot ${new Date().toLocaleDateString("fr-FR")}`;
    setSaving(true);
    try {
      await save(name);
      setNewName("");
    } finally {
      setSaving(false);
    }
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id);
    setRenameValue(currentName);
  }

  async function handleUpdate() {
    if (!activeProfileId) return;
    setUpdating(true);
    try {
      await update(activeProfileId);
    } finally {
      setUpdating(false);
    }
  }

  async function commitRename(id: string) {
    if (renameValue.trim()) await rename(id, renameValue.trim());
    setRenamingId(null);
  }

  return (
    <div className="profile-menu">
      <h3 className="profile-menu-title">Mes profils robot</h3>

      <div className="profile-save-row">
        <input
          type="text"
          className="profile-name-input"
          placeholder="Nom du profil…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={80}
        />
        <button className="btn btn-primary btn-icon" onClick={handleSave} disabled={saving}>
          {saving ? "…" : "Sauver"}
        </button>
      </div>

      {activeProfileId && (
        <button
          className="btn profile-update-btn"
          onClick={handleUpdate}
          disabled={updating}
          title={`Écraser le profil actif avec l'état courant`}
        >
          {updating ? "…" : "↑ Mettre à jour le profil actif"}
        </button>
      )}

      {loading && <p className="empty">Chargement…</p>}

      {!loading && profiles.length === 0 && (
        <p className="empty">Aucun profil sauvegardé.</p>
      )}

      <ul className="profile-list">
        {profiles.map((p) => (
          <li key={p.id} className={`profile-item${activeProfileId === p.id ? " active" : ""}`}>
            {renamingId === p.id ? (
              <input
                className="profile-name-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(p.id)}
                onKeyDown={(e) => e.key === "Enter" && commitRename(p.id)}
                autoFocus
              />
            ) : (
              <button className="profile-name-btn" onClick={() => load(p.id)}>
                {p.name}
                {activeProfileId === p.id && <span className="profile-active-dot" />}
              </button>
            )}
            <button
              className="btn btn-icon"
              title="Renommer"
              onClick={() => startRename(p.id, p.name)}
            >
              ✎
            </button>
            <button
              className="btn btn-icon"
              title="Supprimer"
              onClick={() => remove(p.id)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
