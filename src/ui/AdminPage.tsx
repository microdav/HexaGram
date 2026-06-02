import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useAdminStore, type AdminUser, type CatalogKind } from "../store/useAdminStore";
import { useCatalogStore } from "../store/useCatalogStore";
import { useToolboxStore } from "../store/useToolboxStore";
import { useToastStore } from "../store/useToastStore";
import { confirmDialog } from "../store/useConfirmStore";
import { AvatarImg } from "./AvatarPicker";

const CENTRAL_ADMIN_LOGIN = "microdav";

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString("fr-FR", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/** Page pleine d'administration : utilisateurs + référentiels matériels. */
export function AdminPage() {
  const sub = useToolboxStore((s) => s.uiPrefs.adminSubTab ?? "users");
  const setSub = useToolboxStore((s) => s.setAdminSubTab);

  return (
    <div className="admin-page">
      <div className="admin-sidebar">
        <div className="admin-sidebar-header">Administration</div>
        <button
          type="button"
          className={`admin-nav-item${sub === "users" ? " active" : ""}`}
          onClick={() => setSub("users")}
        >
          👤 Utilisateurs
        </button>
        <button
          type="button"
          className={`admin-nav-item${sub === "referentiels" ? " active" : ""}`}
          onClick={() => setSub("referentiels")}
        >
          📚 Référentiels
        </button>
      </div>

      <div className="admin-main">
        {sub === "users" ? <UsersPanel /> : <ReferentielsPanel />}
      </div>
    </div>
  );
}

// ── Utilisateurs ─────────────────────────────────────────────────────────────

function UsersPanel() {
  const users = useAdminStore((s) => s.users);
  const loading = useAdminStore((s) => s.loading);
  const listUsers = useAdminStore((s) => s.listUsers);
  const setUserFlags = useAdminStore((s) => s.setUserFlags);
  const deleteUser = useAdminStore((s) => s.deleteUser);
  const showToast = useToastStore((s) => s.show);
  const me = useAuthStore((s) => s.user);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    listUsers();
  }, [listUsers]);

  const toggleFlag = async (u: AdminUser, flag: "isAdmin" | "isActive") => {
    setBusyId(u.id);
    try {
      await setUserFlags(u.id, { [flag]: !u[flag] });
      showToast("Utilisateur mis à jour");
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (u: AdminUser) => {
    const ok = await confirmDialog({
      title: "Supprimer l'utilisateur",
      message: `Supprimer définitivement « ${u.login} » et tous ses projets, bases mécaniques et séquences ?`,
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await deleteUser(u.id);
      showToast(`Utilisateur « ${u.login} » supprimé`);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-section">
      <header className="admin-section-head">
        <h2>Utilisateurs</h2>
        <span className="admin-count">{users.length}</span>
      </header>

      {loading && users.length === 0 ? (
        <div className="admin-empty">Chargement…</div>
      ) : (
        <div className="admin-table">
          <div className="admin-row admin-row-head">
            <span className="ac-user">Compte</span>
            <span className="ac-meta">Pays</span>
            <span className="ac-meta">Inscrit</span>
            <span className="ac-meta">Projets</span>
            <span className="ac-flags">Droits</span>
            <span className="ac-actions">Actions</span>
          </div>
          {users.map((u) => {
            const isCentral = u.login === CENTRAL_ADMIN_LOGIN;
            const isSelf = me?.id === u.id;
            const busy = busyId === u.id;
            return (
              <div key={u.id} className={`admin-row${u.isActive ? "" : " inactive"}`}>
                <span className="ac-user">
                  <AvatarImg seed={u.avatarSeed} size={28} />
                  <span className="ac-login">{u.login}</span>
                  {isCentral && <span className="admin-badge badge-central" title="Administrateur central">central</span>}
                </span>
                <span className="ac-meta">{u.country ?? "—"}</span>
                <span className="ac-meta">{fmtDate(u.createdAt)}</span>
                <span className="ac-meta">{u.projectCount}</span>
                <span className="ac-flags">
                  <button
                    type="button"
                    className={`admin-chip${u.isAdmin ? " on" : ""}`}
                    disabled={busy || isCentral}
                    title={isCentral ? "L'administrateur central ne peut être rétrogradé" : "Basculer le droit d'administration"}
                    onClick={() => toggleFlag(u, "isAdmin")}
                  >
                    Admin
                  </button>
                  <button
                    type="button"
                    className={`admin-chip${u.isActive ? " on" : ""}`}
                    disabled={busy || isCentral}
                    title={isCentral ? "L'administrateur central ne peut être désactivé" : "Activer / désactiver le compte"}
                    onClick={() => toggleFlag(u, "isActive")}
                  >
                    {u.isActive ? "Actif" : "Inactif"}
                  </button>
                </span>
                <span className="ac-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => setResetTarget(u)}
                  >
                    Réinit. mot de passe
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busy || isCentral || isSelf}
                    title={isCentral ? "L'administrateur central ne peut être supprimé" : isSelf ? "Vous ne pouvez pas supprimer votre propre compte" : "Supprimer"}
                    onClick={() => handleDelete(u)}
                  >
                    ✕
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {resetTarget && (
        <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
    </div>
  );
}

function ResetPasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const resetPassword = useAdminStore((s) => s.resetPassword);
  const showToast = useToastStore((s) => s.show);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("6 caractères minimum");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await resetPassword(user.id, password);
      showToast(`Mot de passe de « ${user.login} » réinitialisé`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose} role="presentation">
      <form className="admin-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3>Réinitialiser le mot de passe</h3>
        <p className="admin-modal-sub">Compte « {user.login} »</p>
        <label className="modal-field">
          <span>Nouveau mot de passe</span>
          <input
            type="text"
            value={password}
            autoFocus
            minLength={6}
            maxLength={100}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6 caractères minimum"
          />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <div className="admin-modal-actions">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={saving || password.length < 6}>
            {saving ? "Enregistrement…" : "Réinitialiser"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Référentiels ─────────────────────────────────────────────────────────────

interface KindMeta {
  kind: CatalogKind;
  label: string;
  list: () => Record<string, unknown>[];
  primary: (e: Record<string, unknown>) => string;
  secondary: (e: Record<string, unknown>) => string;
  template: Record<string, unknown>;
}

const KIND_TEMPLATES: Record<CatalogKind, Record<string, unknown>> = {
  servoType: {
    id: "mon-servo",
    brand: "Marque",
    model: "Modèle",
    torqueKgCm: { v6: 0, v7_4: 0 },
    speedS60: { v6: 0, v7_4: 0 },
    voltageRange: [4.8, 6.0],
    currentMa: { idle: 0, stall: 0 },
    weightG: 0,
    dimensionsMm: { l: 0, w: 0, h: 0 },
    shaftOffsetMm: 10.0,
    pinionDiamMm: 6.0,
    pulseUs: { min: 500, center: 1500, max: 2500 },
    deadbandUs: 4,
    gearType: "metal",
    bearing: "ball",
    connector: "JR",
    notes: "",
  },
  servoController: {
    id: "mon-controleur",
    brand: "Marque",
    model: "Modèle",
    channels: 16,
    interfaces: ["USB"],
    voltageInputV: [5.0, 6.0],
    pulseUs: { min: 500, max: 2500 },
    resolutionUs: 1,
    weightG: 0,
    dimensionsMm: { l: 0, w: 0, h: 0 },
    notes: "",
  },
  commandElectronics: {
    id: "ma-carte",
    brand: "Marque",
    model: "Modèle",
    type: "microcontroller",
    cpu: "",
    gpio: 0,
    interfaces: ["UART"],
    voltageV: 5.0,
    currentMa: { idle: 0, active: 0 },
    weightG: 0,
    dimensionsMm: { l: 0, w: 0, h: 0 },
    notes: "",
  },
  peripheral: {
    id: "mon-capteur",
    category: "other",
    name: "Nom",
    description: "",
    interfaces: ["I2C"],
    icon: "🧩",
  },
};

function useKindMetas(): KindMeta[] {
  const servoTypes = useCatalogStore((s) => s.servoTypes) as unknown as Record<string, unknown>[];
  const servoControllers = useCatalogStore((s) => s.servoControllers) as unknown as Record<string, unknown>[];
  const commandElectronics = useCatalogStore((s) => s.commandElectronics) as unknown as Record<string, unknown>[];
  const peripherals = useCatalogStore((s) => s.peripherals) as unknown as Record<string, unknown>[];

  return useMemo(
    () => [
      {
        kind: "servoType",
        label: "Servomoteurs",
        list: () => servoTypes,
        primary: (e) => `${e.brand} ${e.model}`,
        secondary: (e) => String(e.id),
        template: KIND_TEMPLATES.servoType,
      },
      {
        kind: "servoController",
        label: "Cartes servo",
        list: () => servoControllers,
        primary: (e) => `${e.brand} ${e.model}`,
        secondary: (e) => `${e.id} · ${e.channels} canaux`,
        template: KIND_TEMPLATES.servoController,
      },
      {
        kind: "commandElectronics",
        label: "Cartes de commande",
        list: () => commandElectronics,
        primary: (e) => `${e.brand} ${e.model}`,
        secondary: (e) => `${e.id} · ${e.type}`,
        template: KIND_TEMPLATES.commandElectronics,
      },
      {
        kind: "peripheral",
        label: "Capteurs",
        list: () => peripherals,
        primary: (e) => `${e.icon ?? ""} ${e.name}`,
        secondary: (e) => `${e.id} · ${e.category}`,
        template: KIND_TEMPLATES.peripheral,
      },
    ],
    [servoTypes, servoControllers, commandElectronics, peripherals]
  );
}

function ReferentielsPanel() {
  const metas = useKindMetas();
  const [activeKind, setActiveKind] = useState<CatalogKind>("servoType");
  const [editor, setEditor] = useState<{ entry: Record<string, unknown> | null } | null>(null);
  const meta = metas.find((m) => m.kind === activeKind)!;
  const entries = meta.list();

  return (
    <div className="admin-section">
      <header className="admin-section-head">
        <h2>Référentiels matériels</h2>
      </header>

      <div className="admin-kind-tabs">
        {metas.map((m) => (
          <button
            type="button"
            key={m.kind}
            className={`admin-kind-tab${m.kind === activeKind ? " active" : ""}`}
            onClick={() => setActiveKind(m.kind)}
          >
            {m.label}
            <span className="admin-kind-count">{m.list().length}</span>
          </button>
        ))}
      </div>

      <div className="admin-ref-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => setEditor({ entry: null })}>
          ＋ Ajouter
        </button>
      </div>

      <div className="admin-ref-list">
        {entries.length === 0 && <div className="admin-empty">Aucune entrée.</div>}
        {entries.map((e) => (
          <button
            type="button"
            key={String(e.id)}
            className="admin-ref-item"
            onClick={() => setEditor({ entry: e })}
          >
            <span className="admin-ref-primary">{meta.primary(e)}</span>
            <span className="admin-ref-secondary">{meta.secondary(e)}</span>
          </button>
        ))}
      </div>

      {editor && (
        <EntryEditor
          kind={activeKind}
          entry={editor.entry}
          template={meta.template}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function EntryEditor({
  kind,
  entry,
  template,
  onClose,
}: {
  kind: CatalogKind;
  entry: Record<string, unknown> | null;
  template: Record<string, unknown>;
  onClose: () => void;
}) {
  const createEntry = useAdminStore((s) => s.createEntry);
  const updateEntry = useAdminStore((s) => s.updateEntry);
  const deleteEntry = useAdminStore((s) => s.deleteEntry);
  const showToast = useToastStore((s) => s.show);
  const isNew = entry === null;
  const originalId = entry ? String(entry.id) : null;
  const [text, setText] = useState(() => JSON.stringify(entry ?? template, null, 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("JSON invalide");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        await createEntry(kind, parsed as never);
        showToast("Entrée créée");
      } else {
        await updateEntry(kind, originalId!, parsed as never);
        showToast("Entrée mise à jour");
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!originalId) return;
    const ok = await confirmDialog({
      title: "Supprimer l'entrée",
      message: `Supprimer définitivement « ${originalId} » du référentiel ?`,
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteEntry(kind, originalId);
      showToast("Entrée supprimée");
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose} role="presentation">
      <div className="admin-modal admin-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? "Nouvelle entrée" : `Modifier « ${originalId} »`}</h3>
        <p className="admin-modal-sub">
          Édition de la fiche au format JSON. Les champs sont validés à l'enregistrement.
        </p>
        <textarea
          className="admin-json-editor"
          aria-label="Fiche JSON de l'entrée"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          rows={20}
        />
        {error && <p className="modal-error">{error}</p>}
        <div className="admin-modal-actions">
          {!isNew && (
            <button type="button" className="btn btn-danger" disabled={saving} onClick={handleDelete}>
              Supprimer
            </button>
          )}
          <span className="admin-modal-spacer" />
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
