import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore, type ProjectHardware } from "../store/useProjectStore";
import { useProfilesStore } from "../store/useProfilesStore";
import { useSavedSequencesStore } from "../store/useSavedSequencesStore";
import { useProgramsStore } from "../store/useProgramsStore";
import { useToastStore } from "../store/useToastStore";
import { api } from "../api/client";
import {
  SERVO_CATALOG,
  type ServoSpec,
} from "../model/servoTypes";
import {
  SERVO_CONTROLLER_CATALOG,
  type ServoControllerSpec,
} from "../model/servoControllers";
import {
  COMMAND_ELECTRONICS_CATALOG,
  type CommandElectronicsSpec,
} from "../model/commandElectronics";

type DetailTab = "general" | "hardware" | "content" | "import";

const GEAR_LABELS: Record<string, string> = { plastic: "Plastique", metal: "Métal", titanium: "Titane" };
const BEARING_LABELS: Record<string, string> = { plain: "Lisse", ball: "Billes", "dual-ball": "Billes doubles" };

const EMPTY_SERVO: Partial<ServoSpec> = {
  brand: "",
  model: "",
  gearType: "metal",
  bearing: "ball",
  connector: "JR",
  voltageRange: [4.8, 7.4],
  torqueKgCm: {},
  speedS60: {},
  currentMa: { idle: 5, stall: 1500 },
  weightG: 0,
  dimensionsMm: { l: 0, w: 0, h: 0 },
  pulseUs: { min: 500, center: 1500, max: 2500 },
  deadbandUs: 4,
  notes: "",
};

function slugify(brand: string, model: string): string {
  return `${brand}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Comboboxes (mêmes que dans ProjectSettingsModal — réutilisés ici) ────

function ServoCombobox({
  value, onChange, types, onNew,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  types: ServoSpec[];
  onNew: () => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = types.find((t) => t.id === value);
  const filtered = useMemo(() => {
    if (!search) return types;
    const q = search.toLowerCase();
    return types.filter((t) => t.brand.toLowerCase().includes(q) || t.model.toLowerCase().includes(q));
  }, [types, search]);

  return (
    <div ref={ref} className="servo-combobox">
      <button type="button" className="servo-combobox-trigger" onClick={() => { setOpen((o) => !o); setTimeout(() => inputRef.current?.focus(), 50); }}>
        <span>{selected ? (<><span className="sct-brand">{selected.brand}</span>{" "}<strong>{selected.model}</strong>{selected.custom && <span className="sco-tag">custom</span>}</>) : (<span className="sct-none">— aucun —</span>)}</span>
        <span className="sct-caret">▼</span>
      </button>
      {open && (
        <div className="servo-combobox-dropdown">
          <input ref={inputRef} className="servo-combobox-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une référence…" />
          <div className="servo-combobox-list">
            <button type="button" className={`servo-combobox-option${value === null ? " selected" : ""}`} onClick={() => { onChange(null); setOpen(false); setSearch(""); }}>
              <span className="sco-model">— aucun —</span>
            </button>
            {filtered.map((t) => (
              <button type="button" key={t.id} className={`servo-combobox-option${t.id === value ? " selected" : ""}`} onClick={() => { onChange(t.id); setOpen(false); setSearch(""); }}>
                <span className="sco-brand">{t.brand}</span>
                <span className="sco-model">{t.model}</span>
                {t.custom && <span className="sco-tag">custom</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="servo-combobox-empty">Aucun résultat</div>}
          </div>
          <button type="button" className="servo-combobox-new" onClick={() => { onNew(); setOpen(false); setSearch(""); }}>
            + Nouveau servo…
          </button>
        </div>
      )}
    </div>
  );
}

function ServoSpecCard({ spec }: { spec: ServoSpec }) {
  const torque = spec.torqueKgCm.v7_4 ? `${spec.torqueKgCm.v7_4} kg·cm @ 7,4V` : spec.torqueKgCm.v6 ? `${spec.torqueKgCm.v6} kg·cm @ 6V` : "—";
  const speed = spec.speedS60.v7_4 ? `${spec.speedS60.v7_4} s/60° @ 7,4V` : spec.speedS60.v6 ? `${spec.speedS60.v6} s/60° @ 6V` : "—";
  const { l, w, h } = spec.dimensionsMm;

  return (
    <div className="servo-spec-card">
      <div className="ssc-header">
        <div>
          <div className="ssc-model">{spec.model}</div>
          <div className="ssc-brand">{spec.brand}</div>
        </div>
        <div className="ssc-tags">
          <span className={`ssc-tag gear-${spec.gearType}`}>{GEAR_LABELS[spec.gearType]}</span>
          <span className="ssc-tag">{BEARING_LABELS[spec.bearing]}</span>
          <span className="ssc-tag">{spec.connector}</span>
        </div>
      </div>
      <div className="ssc-grid">
        <div className="ssc-row"><span>Tension</span><span>{spec.voltageRange[0]}V – {spec.voltageRange[1]}V</span></div>
        <div className="ssc-row"><span>Couple</span><span>{torque}</span></div>
        <div className="ssc-row"><span>Vitesse</span><span>{speed}</span></div>
        <div className="ssc-row"><span>Courant repos / blocage</span><span>{spec.currentMa.idle} / {spec.currentMa.stall} mA</span></div>
        <div className="ssc-row"><span>Poids</span><span>{spec.weightG} g</span></div>
        <div className="ssc-row"><span>Dimensions</span><span>{l} × {w} × {h} mm</span></div>
        <div className="ssc-row"><span>Impulsions</span><span>{spec.pulseUs.min}–{spec.pulseUs.max} µs (centre {spec.pulseUs.center} µs)</span></div>
        <div className="ssc-row"><span>Zone morte</span><span>{spec.deadbandUs} µs</span></div>
      </div>
      {spec.notes && <div className="ssc-notes">{spec.notes}</div>}
    </div>
  );
}

function NewServoForm({ onSave, onCancel }: { onSave: (spec: ServoSpec) => void; onCancel: () => void; }) {
  const [d, setD] = useState<Partial<ServoSpec>>({ ...EMPTY_SERVO });
  const set = (field: string, value: unknown) => setD((prev) => ({ ...prev, [field]: value }));
  const setNested = (field: string, key: string, value: unknown) =>
    setD((prev) => ({ ...prev, [field]: { ...(prev[field as keyof ServoSpec] as Record<string, unknown>), [key]: value } }));
  const handleSave = () => {
    if (!d.brand?.trim() || !d.model?.trim()) return;
    const spec: ServoSpec = {
      id: slugify(d.brand!, d.model!),
      brand: d.brand!.trim(),
      model: d.model!.trim(),
      torqueKgCm: d.torqueKgCm ?? {},
      speedS60: d.speedS60 ?? {},
      voltageRange: d.voltageRange ?? [4.8, 7.4],
      currentMa: d.currentMa ?? { idle: 5, stall: 1500 },
      weightG: d.weightG ?? 0,
      dimensionsMm: d.dimensionsMm ?? { l: 0, w: 0, h: 0 },
      pulseUs: d.pulseUs ?? { min: 500, center: 1500, max: 2500 },
      deadbandUs: d.deadbandUs ?? 4,
      gearType: d.gearType ?? "metal",
      bearing: d.bearing ?? "ball",
      connector: d.connector ?? "JR",
      notes: d.notes?.trim() || undefined,
      custom: true,
    };
    onSave(spec);
  };
  const n = (v: number | undefined) => v ?? 0;

  return (
    <div className="new-servo-form">
      <div className="nsf-title">Nouveau servo-moteur</div>
      <div className="nsf-grid">
        <label className="nsf-field"><span className="nsf-label">Marque</span><input className="nsf-input" value={d.brand ?? ""} onChange={(e) => set("brand", e.target.value)} placeholder="ex : Tower Pro" /></label>
        <label className="nsf-field"><span className="nsf-label">Modèle</span><input className="nsf-input" value={d.model ?? ""} onChange={(e) => set("model", e.target.value)} placeholder="ex : MG995" /></label>
        <label className="nsf-field"><span className="nsf-label">Couple @ 6V (kg·cm)</span><input className="nsf-input" type="number" step="0.1" value={n(d.torqueKgCm?.v6)} onChange={(e) => setNested("torqueKgCm", "v6", parseFloat(e.target.value))} /></label>
        <label className="nsf-field"><span className="nsf-label">Couple @ 7,4V (kg·cm)</span><input className="nsf-input" type="number" step="0.1" value={n(d.torqueKgCm?.v7_4)} onChange={(e) => setNested("torqueKgCm", "v7_4", parseFloat(e.target.value))} /></label>
        <label className="nsf-field"><span className="nsf-label">Vitesse @ 6V (s/60°)</span><input className="nsf-input" type="number" step="0.01" value={n(d.speedS60?.v6)} onChange={(e) => setNested("speedS60", "v6", parseFloat(e.target.value))} /></label>
        <label className="nsf-field"><span className="nsf-label">Vitesse @ 7,4V (s/60°)</span><input className="nsf-input" type="number" step="0.01" value={n(d.speedS60?.v7_4)} onChange={(e) => setNested("speedS60", "v7_4", parseFloat(e.target.value))} /></label>
        <label className="nsf-field"><span className="nsf-label">Tension min (V)</span><input className="nsf-input" type="number" step="0.1" value={d.voltageRange?.[0] ?? 4.8} onChange={(e) => set("voltageRange", [parseFloat(e.target.value), d.voltageRange?.[1] ?? 7.4])} /></label>
        <label className="nsf-field"><span className="nsf-label">Tension max (V)</span><input className="nsf-input" type="number" step="0.1" value={d.voltageRange?.[1] ?? 7.4} onChange={(e) => set("voltageRange", [d.voltageRange?.[0] ?? 4.8, parseFloat(e.target.value)])} /></label>
        <label className="nsf-field"><span className="nsf-label">Courant repos (mA)</span><input className="nsf-input" type="number" value={d.currentMa?.idle ?? 5} onChange={(e) => setNested("currentMa", "idle", parseInt(e.target.value))} /></label>
        <label className="nsf-field"><span className="nsf-label">Courant blocage (mA)</span><input className="nsf-input" type="number" value={d.currentMa?.stall ?? 1500} onChange={(e) => setNested("currentMa", "stall", parseInt(e.target.value))} /></label>
        <label className="nsf-field"><span className="nsf-label">Poids (g)</span><input className="nsf-input" type="number" step="0.1" value={d.weightG ?? 0} onChange={(e) => set("weightG", parseFloat(e.target.value))} /></label>
        <label className="nsf-field"><span className="nsf-label">Zone morte (µs)</span><input className="nsf-input" type="number" value={d.deadbandUs ?? 4} onChange={(e) => set("deadbandUs", parseInt(e.target.value))} /></label>
        <label className="nsf-field"><span className="nsf-label">Réducteur</span>
          <select className="nsf-select" value={d.gearType ?? "metal"} onChange={(e) => set("gearType", e.target.value)}>
            <option value="plastic">Plastique</option>
            <option value="metal">Métal</option>
            <option value="titanium">Titane</option>
          </select>
        </label>
        <label className="nsf-field"><span className="nsf-label">Roulements</span>
          <select className="nsf-select" value={d.bearing ?? "ball"} onChange={(e) => set("bearing", e.target.value)}>
            <option value="plain">Lisse</option>
            <option value="ball">Billes</option>
            <option value="dual-ball">Billes doubles</option>
          </select>
        </label>
        <label className="nsf-field"><span className="nsf-label">Connecteur</span>
          <select className="nsf-select" value={d.connector ?? "JR"} onChange={(e) => set("connector", e.target.value)}>
            <option value="JR">JR</option>
            <option value="Futaba">Futaba</option>
            <option value="Hitec">Hitec</option>
            <option value="BUS">BUS</option>
          </select>
        </label>
        <label className="nsf-field"><span className="nsf-label">Notes</span><input className="nsf-input" value={d.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Description courte" /></label>
      </div>
      <div className="nsf-actions">
        <button type="button" className="btn" onClick={onCancel}>Annuler</button>
        <button type="button" className="btn btn-primary" disabled={!d.brand?.trim() || !d.model?.trim()} onClick={handleSave}>Créer</button>
      </div>
    </div>
  );
}

function GenericCombobox<T extends { id: string; brand: string; model: string }>({
  value, onChange, items, placeholder, extraLabel,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  items: T[];
  placeholder: string;
  extraLabel?: (item: T) => string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const selected = items.find((i) => i.id === value);
  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((i) => i.brand.toLowerCase().includes(q) || i.model.toLowerCase().includes(q));
  }, [items, search]);
  return (
    <div ref={ref} className="servo-combobox">
      <button type="button" className="servo-combobox-trigger" onClick={() => { setOpen((o) => !o); setTimeout(() => inputRef.current?.focus(), 50); }}>
        <span>{selected ? (<><span className="sct-brand">{selected.brand}</span>{" "}<strong>{selected.model}</strong></>) : (<span className="sct-none">— {placeholder} —</span>)}</span>
        <span className="sct-caret">▼</span>
      </button>
      {open && (
        <div className="servo-combobox-dropdown">
          <input ref={inputRef} className="servo-combobox-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" />
          <div className="servo-combobox-list">
            <button type="button" className={`servo-combobox-option${!value ? " selected" : ""}`} onClick={() => { onChange(null); setOpen(false); setSearch(""); }}>
              <span className="sco-model">— aucun —</span>
            </button>
            {filtered.map((i) => (
              <button type="button" key={i.id} className={`servo-combobox-option${i.id === value ? " selected" : ""}`} onClick={() => { onChange(i.id); setOpen(false); setSearch(""); }}>
                <span className="sco-brand">{i.brand}</span>
                <span className="sco-model">{i.model}</span>
                {extraLabel && <span className="sco-hint">{extraLabel(i)}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="servo-combobox-empty">Aucun résultat</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function ControllerSpecCard({ spec }: { spec: ServoControllerSpec }) {
  return (
    <div className="hw-spec-card">
      <div className="hw-spec-row"><span>Canaux</span><span>{spec.channels}</span></div>
      <div className="hw-spec-row"><span>Interfaces</span><span>{spec.interfaces.join(", ")}</span></div>
      <div className="hw-spec-row"><span>Tension entrée</span><span>{spec.voltageInputV[0]}–{spec.voltageInputV[1]} V</span></div>
      {spec.voltageServoV && (
        <div className="hw-spec-row"><span>Tension servo</span><span>{spec.voltageServoV[0]}–{spec.voltageServoV[1]} V</span></div>
      )}
      <div className="hw-spec-row"><span>Résolution</span><span>{spec.resolutionUs} µs</span></div>
      <div className="hw-spec-row"><span>Poids</span><span>{spec.weightG} g</span></div>
      <div className="hw-spec-row"><span>Dimensions</span><span>{spec.dimensionsMm.l}×{spec.dimensionsMm.w}×{spec.dimensionsMm.h} mm</span></div>
      {spec.notes && <div className="hw-spec-notes">{spec.notes}</div>}
    </div>
  );
}

function CommandSpecCard({ spec }: { spec: CommandElectronicsSpec }) {
  return (
    <div className="hw-spec-card">
      <div className="hw-spec-row"><span>CPU</span><span>{spec.cpu}</span></div>
      {spec.flashKb !== undefined && (
        <div className="hw-spec-row"><span>Flash</span><span>{spec.flashKb >= 1024 ? `${spec.flashKb / 1024} Mo` : `${spec.flashKb} Ko`}</span></div>
      )}
      {spec.ramKb !== undefined && (
        <div className="hw-spec-row"><span>RAM</span><span>{spec.ramKb >= 1024 ? `${(spec.ramKb / 1024).toFixed(0)} Mo` : `${spec.ramKb} Ko`}</span></div>
      )}
      <div className="hw-spec-row"><span>GPIO</span><span>{spec.gpio}</span></div>
      <div className="hw-spec-row"><span>Interfaces</span><span>{spec.interfaces.join(", ")}</span></div>
      <div className="hw-spec-row"><span>Tension</span><span>{spec.voltageV} V</span></div>
      <div className="hw-spec-row"><span>Courant repos / actif</span><span>{spec.currentMa.idle} / {spec.currentMa.active} mA</span></div>
      <div className="hw-spec-row"><span>Poids</span><span>{spec.weightG} g</span></div>
      <div className="hw-spec-row"><span>Dimensions</span><span>{spec.dimensionsMm.l}×{spec.dimensionsMm.w}×{spec.dimensionsMm.h} mm</span></div>
      {spec.notes && <div className="hw-spec-notes">{spec.notes}</div>}
    </div>
  );
}

// ── Sidebar : liste des projets ──────────────────────────────────────────

function SidebarProjectList({ onCreateClick }: { onCreateClick: () => void }) {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const loadProject = useProjectStore((s) => s.load);
  const showToast = useToastStore((s) => s.show);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleSelect = async (id: string, name: string) => {
    if (id === activeProjectId) return;
    setBusyId(id);
    try {
      await loadProject(id);
      showToast(`Projet « ${name} » chargé`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="pp-sidebar">
      <div className="pp-sidebar-header">
        <span>Mes projets</span>
        <span className="pp-sidebar-count">{projects.length}</span>
      </div>
      <div className="pp-project-list">
        {projects.length === 0 ? (
          <div className="pp-empty">Aucun projet</div>
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`pp-project-card${p.id === activeProjectId ? ' active' : ''}`}
              disabled={busyId !== null}
              onClick={() => handleSelect(p.id, p.name)}
            >
              <div className="pp-card-name">
                {p.name}
                {p.id === activeProjectId && <span className="pp-card-active">actif</span>}
              </div>
              {p.description && <div className="pp-card-desc">{p.description}</div>}
              <div className="pp-card-stats">
                <span>{p.counts.profiles} profil{p.counts.profiles > 1 ? 's' : ''}</span>
                <span>·</span>
                <span>{p.counts.sequences} séq.</span>
                <span>·</span>
                <span>{p.counts.programs} prog.</span>
              </div>
              {busyId === p.id && <span className="pp-card-spinner">…</span>}
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        className="btn btn-primary pp-new-btn"
        onClick={onCreateClick}
      >
        ＋ Nouveau projet
      </button>
    </div>
  );
}

// ── Onglet Général ──────────────────────────────────────────────────────

function GeneralPanel({ projectId, initialName, initialDescription }: {
  projectId: string;
  initialName: string;
  initialDescription: string;
}) {
  const update = useProjectStore((s) => s.update);
  const showToast = useToastStore((s) => s.show);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setName(initialName); }, [initialName]);
  useEffect(() => { setDescription(initialDescription); }, [initialDescription]);

  const dirty = name !== initialName || description !== initialDescription;

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await update(projectId, { name: name.trim() || initialName, description });
      showToast("Projet mis à jour");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pp-section">
      <div className="modal-form">
        <label className="modal-field">
          <span>Nom du projet</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="modal-field">
          <span>Description</span>
          <textarea
            className="settings-textarea"
            rows={4}
            maxLength={500}
            value={description}
            placeholder="Notes générales sur ce projet…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
      <div className="pp-panel-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

// ── Onglet Matériel ─────────────────────────────────────────────────────

function HardwarePanel({ projectId, initialHardware }: {
  projectId: string;
  initialHardware: ProjectHardware;
}) {
  const update = useProjectStore((s) => s.update);
  const showToast = useToastStore((s) => s.show);
  const [hardware, setHardware] = useState<ProjectHardware>(initialHardware);
  const [showNewServoForm, setShowNewServoForm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setHardware(initialHardware); setShowNewServoForm(false); }, [initialHardware, projectId]);

  const allTypes = useMemo(
    () => [...SERVO_CATALOG, ...hardware.customServoTypes],
    [hardware.customServoTypes]
  );
  const selectedServo = allTypes.find((t) => t.id === hardware.servoTypeId) ?? null;
  const selectedController = SERVO_CONTROLLER_CATALOG.find((c) => c.id === hardware.servoControllerId);
  const selectedCommand = COMMAND_ELECTRONICS_CATALOG.find((c) => c.id === hardware.commandElectronicsId);

  const dirty = useMemo(() => JSON.stringify(hardware) !== JSON.stringify(initialHardware), [hardware, initialHardware]);

  const handleNewServoSave = (spec: ServoSpec) => {
    const exists = hardware.customServoTypes.some((s) => s.id === spec.id);
    const customServoTypes = exists
      ? hardware.customServoTypes.map((s) => (s.id === spec.id ? spec : s))
      : [...hardware.customServoTypes, spec];
    setHardware((h) => ({ ...h, customServoTypes, servoTypeId: spec.id }));
    setShowNewServoForm(false);
    showToast(`Servo « ${spec.model} » ajouté au projet`);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await update(projectId, { hardware });
      showToast("Matériel mis à jour");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pp-section">
      <div className="hw-section">
        <div className="hw-section-title">Type de servo global</div>
        <ServoCombobox
          value={hardware.servoTypeId}
          onChange={(id) => { setHardware((h) => ({ ...h, servoTypeId: id })); setShowNewServoForm(false); }}
          types={allTypes}
          onNew={() => setShowNewServoForm(true)}
        />
        {showNewServoForm ? (
          <NewServoForm onSave={handleNewServoSave} onCancel={() => setShowNewServoForm(false)} />
        ) : selectedServo ? (
          <ServoSpecCard spec={selectedServo} />
        ) : (
          <div className="servos-hint">
            Sélectionnez un modèle de servo ou créez une référence personnalisée.
          </div>
        )}
      </div>

      <div className="hw-section">
        <div className="hw-section-title">Contrôleur servo</div>
        <GenericCombobox
          value={hardware.servoControllerId}
          onChange={(id) => setHardware((h) => ({ ...h, servoControllerId: id }))}
          items={SERVO_CONTROLLER_CATALOG}
          placeholder="aucun"
          extraLabel={(c) => `${c.channels} ch`}
        />
        {selectedController && <ControllerSpecCard spec={selectedController} />}
      </div>

      <div className="hw-section">
        <div className="hw-section-title">Électronique de commande</div>
        <GenericCombobox
          value={hardware.commandElectronicsId}
          onChange={(id) => setHardware((h) => ({ ...h, commandElectronicsId: id }))}
          items={COMMAND_ELECTRONICS_CATALOG}
          placeholder="aucune"
        />
        {selectedCommand && <CommandSpecCard spec={selectedCommand} />}
      </div>

      <div className="pp-panel-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

// ── Onglet Contenu ──────────────────────────────────────────────────────

function ContentPanel() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const profiles = useProfilesStore((s) => s.profiles);
  const sequences = useSavedSequencesStore((s) => s.sequences);
  const programs = useProgramsStore((s) => s.programs);
  const listProfiles = useProfilesStore((s) => s.list);
  const listSequences = useSavedSequencesStore((s) => s.list);
  const listPrograms = useProgramsStore((s) => s.list);
  const removeProfile = useProfilesStore((s) => s.remove);
  const removeSequence = useSavedSequencesStore((s) => s.remove);
  const removeProgram = useProgramsStore((s) => s.remove);

  useEffect(() => {
    if (!activeProject) return;
    listProfiles();
    listSequences();
    listPrograms();
  }, [activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (ts: number) => new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="pp-section">
      <div className="pp-content-grid">
        <div className="pp-content-col">
          <div className="pp-content-title">
            Profils robot
            <span className="pp-content-count">{profiles.length}</span>
          </div>
          {profiles.length === 0 ? (
            <div className="pp-empty-mini">aucun</div>
          ) : profiles.map((p) => (
            <div key={p.id} className="pp-item-row">
              <div className="pp-item-main">
                <span className="pp-item-name">{p.name}</span>
                <span className="pp-item-date">maj {fmt(p.updatedAt)}</span>
              </div>
              <button type="button" className="btn btn-sm btn-danger"
                onClick={() => confirm(`Supprimer le profil "${p.name}" ?`) && removeProfile(p.id)}>✕</button>
            </div>
          ))}
        </div>

        <div className="pp-content-col">
          <div className="pp-content-title">
            Séquences
            <span className="pp-content-count">{sequences.length}</span>
          </div>
          {sequences.length === 0 ? (
            <div className="pp-empty-mini">aucune</div>
          ) : sequences.map((s) => (
            <div key={s.id} className="pp-item-row">
              <div className="pp-item-main">
                <span className="pp-item-name">{s.name}</span>
                <span className="pp-item-date">maj {fmt(s.updatedAt)}</span>
              </div>
              <button type="button" className="btn btn-sm btn-danger"
                onClick={() => confirm(`Supprimer la séquence "${s.name}" ?`) && removeSequence(s.id)}>✕</button>
            </div>
          ))}
        </div>

        <div className="pp-content-col">
          <div className="pp-content-title">
            Programmes
            <span className="pp-content-count">{programs.length}</span>
          </div>
          {programs.length === 0 ? (
            <div className="pp-empty-mini">aucun</div>
          ) : programs.map((p) => (
            <div key={p.id} className="pp-item-row">
              <div className="pp-item-main">
                <span className="pp-item-name">{p.name}</span>
                <span className="pp-item-date">maj {fmt(p.updatedAt)}</span>
              </div>
              <button type="button" className="btn btn-sm btn-danger"
                onClick={() => confirm(`Supprimer le programme "${p.name}" ?`) && removeProgram(p.id)}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Onglet Import ───────────────────────────────────────────────────────

interface ListItem { id: string; name: string; }

function ImportPanel() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const importFrom = useProjectStore((s) => s.importFrom);
  const showToast = useToastStore((s) => s.show);

  const [sourceId, setSourceId] = useState("");
  const [profiles, setProfiles] = useState<ListItem[]>([]);
  const [sequences, setSequences] = useState<ListItem[]>([]);
  const [programs, setPrograms] = useState<ListItem[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [selectedSequences, setSelectedSequences] = useState<Set<string>>(new Set());
  const [selectedPrograms, setSelectedPrograms] = useState<Set<string>>(new Set());
  const [loadingItems, setLoadingItems] = useState(false);
  const [importing, setImporting] = useState(false);

  const otherProjects = projects.filter((p) => p.id !== activeProjectId);

  useEffect(() => {
    setProfiles([]); setSequences([]); setPrograms([]);
    setSelectedProfiles(new Set()); setSelectedSequences(new Set()); setSelectedPrograms(new Set());
  }, [activeProjectId]);

  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    setLoadingItems(true);
    Promise.all([
      api.get<ListItem[]>(`/profiles?projectId=${encodeURIComponent(sourceId)}`),
      api.get<ListItem[]>(`/sequences?projectId=${encodeURIComponent(sourceId)}`),
      api.get<ListItem[]>(`/programs?projectId=${encodeURIComponent(sourceId)}`),
    ])
      .then(([profs, seqs, progs]) => {
        if (cancelled) return;
        setProfiles(profs); setSequences(seqs); setPrograms(progs);
      })
      .finally(() => { if (!cancelled) setLoadingItems(false); });
    return () => { cancelled = true; };
  }, [sourceId]);

  const toggle = (set: Set<string>, setter: (v: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const totalSelected = selectedProfiles.size + selectedSequences.size + selectedPrograms.size;

  const handleImport = async () => {
    if (!sourceId || totalSelected === 0) return;
    setImporting(true);
    try {
      const result = await importFrom(sourceId, {
        profileIds: [...selectedProfiles],
        sequenceIds: [...selectedSequences],
        programIds: [...selectedPrograms],
      });
      showToast(`Importé : ${result.profilesImported} profil(s), ${result.sequencesImported} séq., ${result.programsImported} prog.`);
      setSourceId("");
      setSelectedProfiles(new Set()); setSelectedSequences(new Set()); setSelectedPrograms(new Set());
    } finally {
      setImporting(false);
    }
  };

  const renderList = (
    items: ListItem[],
    selected: Set<string>,
    setter: (v: Set<string>) => void,
    label: string
  ) => (
    <div className="import-section">
      <div className="import-section-header">
        <span>{label} ({items.length})</span>
        {items.length > 0 && (
          <button type="button" className="import-section-all"
            onClick={() => {
              if (selected.size === items.length) setter(new Set());
              else setter(new Set(items.map((i) => i.id)));
            }}>
            {selected.size === items.length ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="import-list-empty">aucun</div>
      ) : (
        <div className="import-list">
          {items.map((i) => (
            <label key={i.id} className="import-row">
              <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(selected, setter, i.id)} />
              <span>{i.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="pp-section">
      <p className="pp-hint">
        Copiez des profils, séquences ou programmes depuis un autre projet vers le projet actif.
        Les éléments importés sont des copies indépendantes (nouveaux identifiants).
      </p>
      <div className="modal-form">
        <label className="modal-field">
          <span>Projet source</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">— choisir un projet —</option>
            {otherProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {sourceId && (
          loadingItems ? (
            <div className="import-list-empty">Chargement…</div>
          ) : (
            <>
              {renderList(profiles, selectedProfiles, setSelectedProfiles, "Profils robot")}
              {renderList(sequences, selectedSequences, setSelectedSequences, "Séquences")}
              {renderList(programs, selectedPrograms, setSelectedPrograms, "Programmes")}
            </>
          )
        )}
      </div>

      <div className="pp-panel-actions">
        <button type="button" className="btn btn-primary"
          disabled={importing || !sourceId || totalSelected === 0}
          onClick={handleImport}>
          {importing ? "Import…" : totalSelected === 0 ? "Importer" : `Importer (${totalSelected})`}
        </button>
      </div>
    </div>
  );
}

// ── Création d'un nouveau projet (formulaire inline) ────────────────────

function NewProjectForm({ onClose }: { onClose: () => void }) {
  const create = useProjectStore((s) => s.create);
  const showToast = useToastStore((s) => s.show);
  const clearProfiles = useProfilesStore((s) => s.clear);
  const clearSequences = useSavedSequencesStore((s) => s.clear);
  const clearPrograms = useProgramsStore((s) => s.clear);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const project = await create(name.trim(), description.trim() || undefined);
      clearProfiles();
      clearSequences();
      clearPrograms();
      showToast(`Projet « ${project.name} » créé`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="pp-new-form" onSubmit={handleSubmit}>
      <div className="pp-new-form-title">Nouveau projet</div>
      <label className="modal-field">
        <span>Nom</span>
        <input
          type="text" value={name} autoFocus maxLength={80}
          placeholder="ex : Hexapode V2"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="modal-field">
        <span>Description</span>
        <textarea
          rows={3} maxLength={500} value={description}
          placeholder="Notes sur ce projet…"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {error && <p className="modal-error">{error}</p>}
      <div className="pp-panel-actions">
        <button type="button" className="btn" onClick={onClose}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
          {saving ? "Création…" : "Créer"}
        </button>
      </div>
    </form>
  );
}

// ── ProjectPage racine ─────────────────────────────────────────────────

export function ProjectPage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const removeProject = useProjectStore((s) => s.remove);
  const refreshProfiles = useProfilesStore((s) => s.list);
  const refreshSequences = useSavedSequencesStore((s) => s.list);
  const refreshPrograms = useProgramsStore((s) => s.list);
  const showToast = useToastStore((s) => s.show);

  const [tab, setTab] = useState<DetailTab>("general");
  const [creatingNew, setCreatingNew] = useState(false);

  // Si on change de projet actif pendant qu'on créait un nouveau projet, on referme le formulaire
  useEffect(() => {
    setCreatingNew(false);
  }, [activeProject?.id]);

  const handleDelete = async () => {
    if (!activeProject) return;
    if (!confirm(`Supprimer définitivement le projet "${activeProject.name}" et toutes ses données (profils, séquences, programmes) ?`)) return;
    const name = activeProject.name;
    await removeProject(activeProject.id);
    showToast(`Projet « ${name} » supprimé`);
    await refreshProfiles();
    await refreshSequences();
    await refreshPrograms();
  };

  return (
    <div className="project-page">
      <SidebarProjectList onCreateClick={() => setCreatingNew(true)} />

      <div className="pp-main">
        {creatingNew ? (
          <NewProjectForm onClose={() => setCreatingNew(false)} />
        ) : !activeProject ? (
          <div className="pp-no-project">
            <h2>Aucun projet sélectionné</h2>
            <p>Sélectionnez un projet dans la liste à gauche, ou créez-en un.</p>
          </div>
        ) : (
          <>
            <header className="pp-header">
              <div className="pp-header-main">
                <h2 className="pp-header-title">{activeProject.name}</h2>
                {activeProject.description && (
                  <p className="pp-header-desc">{activeProject.description}</p>
                )}
              </div>
              <div className="pp-header-actions">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={handleDelete}
                >
                  Supprimer le projet
                </button>
              </div>
            </header>

            <nav className="pp-tabs">
              <button type="button" className={`pp-tab${tab === 'general' ? ' active' : ''}`} onClick={() => setTab("general")}>Général</button>
              <button type="button" className={`pp-tab${tab === 'hardware' ? ' active' : ''}`} onClick={() => setTab("hardware")}>Matériel</button>
              <button type="button" className={`pp-tab${tab === 'content' ? ' active' : ''}`} onClick={() => setTab("content")}>Contenu</button>
              <button type="button" className={`pp-tab${tab === 'import' ? ' active' : ''}`} onClick={() => setTab("import")}>Importer</button>
            </nav>

            {tab === "general" && (
              <GeneralPanel
                projectId={activeProject.id}
                initialName={activeProject.name}
                initialDescription={activeProject.description}
              />
            )}
            {tab === "hardware" && (
              <HardwarePanel
                projectId={activeProject.id}
                initialHardware={activeProject.hardware}
              />
            )}
            {tab === "content" && <ContentPanel />}
            {tab === "import" && <ImportPanel />}
          </>
        )}
      </div>
    </div>
  );
}
