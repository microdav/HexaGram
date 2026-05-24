import { useEffect, useMemo, useRef, useState } from "react";
import { LEG_NAMES, type LegLayout } from "../model/hexapod";
import {
  SERVO_CATALOG,
  loadCustomServoTypes,
  saveCustomServoType,
  type ServoSpec,
} from "../model/servoTypes";
import {
  DEFAULT_SERVO_CALIB,
  useHexapodStore,
  type ServoCalibration,
} from "../store/useHexapodStore";
import { DEFAULT_COLLISION_PREFS, type CollisionPrefs } from "../model/collisions";
import { useProfilesStore } from "../store/useProfilesStore";
import { useToastStore } from "../store/useToastStore";
import { Modal } from "./Modal";

type Tab = "general" | "servos" | "collisions";

const JOINTS = ["coxa", "femur", "tibia"] as const;
const JOINT_LABELS: Record<string, string> = { coxa: "Coxa", femur: "Fémur", tibia: "Tibia" };
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

// ── Combobox ─────────────────────────────────────────────────────────────────

function ServoCombobox({
  value,
  onChange,
  types,
  onNew,
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
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = types.find((t) => t.id === value);
  const filtered = useMemo(() => {
    if (!search) return types;
    const q = search.toLowerCase();
    return types.filter(
      (t) =>
        t.brand.toLowerCase().includes(q) || t.model.toLowerCase().includes(q)
    );
  }, [types, search]);

  return (
    <div ref={ref} className="servo-combobox">
      <button
        type="button"
        className="servo-combobox-trigger"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      >
        <span>
          {selected ? (
            <>
              <span className="sct-brand">{selected.brand}</span>{" "}
              <strong>{selected.model}</strong>
              {selected.custom && <span className="sco-tag">custom</span>}
            </>
          ) : (
            <span className="sct-none">— aucun —</span>
          )}
        </span>
        <span className="sct-caret">▼</span>
      </button>

      {open && (
        <div className="servo-combobox-dropdown">
          <input
            ref={inputRef}
            className="servo-combobox-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une référence…"
          />
          <div className="servo-combobox-list">
            <button
              type="button"
              className={`servo-combobox-option${value === null ? " selected" : ""}`}
              onClick={() => { onChange(null); setOpen(false); setSearch(""); }}
            >
              <span className="sco-model">— aucun —</span>
            </button>
            {filtered.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`servo-combobox-option${t.id === value ? " selected" : ""}`}
                onClick={() => { onChange(t.id); setOpen(false); setSearch(""); }}
              >
                <span className="sco-brand">{t.brand}</span>
                <span className="sco-model">{t.model}</span>
                {t.custom && <span className="sco-tag">custom</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="servo-combobox-empty">Aucun résultat</div>
            )}
          </div>
          <button
            type="button"
            className="servo-combobox-new"
            onClick={() => { onNew(); setOpen(false); setSearch(""); }}
          >
            + Nouveau servo…
          </button>
        </div>
      )}
    </div>
  );
}

// ── Fiche technique ──────────────────────────────────────────────────────────

function ServoSpecCard({ spec }: { spec: ServoSpec }) {
  const torque = spec.torqueKgCm.v7_4
    ? `${spec.torqueKgCm.v7_4} kg·cm @ 7,4V`
    : spec.torqueKgCm.v6
    ? `${spec.torqueKgCm.v6} kg·cm @ 6V`
    : "—";

  const speed = spec.speedS60.v7_4
    ? `${spec.speedS60.v7_4} s/60° @ 7,4V`
    : spec.speedS60.v6
    ? `${spec.speedS60.v6} s/60° @ 6V`
    : "—";

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

// ── Formulaire nouveau servo ─────────────────────────────────────────────────

function NewServoForm({
  onSave,
  onCancel,
}: {
  onSave: (spec: ServoSpec) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Partial<ServoSpec>>({ ...EMPTY_SERVO });

  const set = (field: string, value: unknown) =>
    setD((prev) => ({ ...prev, [field]: value }));

  const setNested = (field: string, key: string, value: unknown) =>
    setD((prev) => ({
      ...prev,
      [field]: { ...(prev[field as keyof ServoSpec] as Record<string, unknown>), [key]: value },
    }));

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
        <label className="nsf-field">
          <span className="nsf-label">Marque</span>
          <input className="nsf-input" value={d.brand ?? ""} onChange={(e) => set("brand", e.target.value)} placeholder="ex : Tower Pro" />
        </label>
        <label className="nsf-field">
          <span className="nsf-label">Modèle</span>
          <input className="nsf-input" value={d.model ?? ""} onChange={(e) => set("model", e.target.value)} placeholder="ex : MG995" />
        </label>

        <label className="nsf-field">
          <span className="nsf-label">Couple @ 6V (kg·cm)</span>
          <input className="nsf-input" type="number" step="0.1" value={n(d.torqueKgCm?.v6)} onChange={(e) => setNested("torqueKgCm", "v6", parseFloat(e.target.value))} />
        </label>
        <label className="nsf-field">
          <span className="nsf-label">Couple @ 7,4V (kg·cm)</span>
          <input className="nsf-input" type="number" step="0.1" value={n(d.torqueKgCm?.v7_4)} onChange={(e) => setNested("torqueKgCm", "v7_4", parseFloat(e.target.value))} />
        </label>

        <label className="nsf-field">
          <span className="nsf-label">Vitesse @ 6V (s/60°)</span>
          <input className="nsf-input" type="number" step="0.01" value={n(d.speedS60?.v6)} onChange={(e) => setNested("speedS60", "v6", parseFloat(e.target.value))} />
        </label>
        <label className="nsf-field">
          <span className="nsf-label">Vitesse @ 7,4V (s/60°)</span>
          <input className="nsf-input" type="number" step="0.01" value={n(d.speedS60?.v7_4)} onChange={(e) => setNested("speedS60", "v7_4", parseFloat(e.target.value))} />
        </label>

        <label className="nsf-field">
          <span className="nsf-label">Tension min (V)</span>
          <input className="nsf-input" type="number" step="0.1" value={d.voltageRange?.[0] ?? 4.8} onChange={(e) => set("voltageRange", [parseFloat(e.target.value), d.voltageRange?.[1] ?? 7.4])} />
        </label>
        <label className="nsf-field">
          <span className="nsf-label">Tension max (V)</span>
          <input className="nsf-input" type="number" step="0.1" value={d.voltageRange?.[1] ?? 7.4} onChange={(e) => set("voltageRange", [d.voltageRange?.[0] ?? 4.8, parseFloat(e.target.value)])} />
        </label>

        <label className="nsf-field">
          <span className="nsf-label">Courant repos (mA)</span>
          <input className="nsf-input" type="number" value={d.currentMa?.idle ?? 5} onChange={(e) => setNested("currentMa", "idle", parseInt(e.target.value))} />
        </label>
        <label className="nsf-field">
          <span className="nsf-label">Courant blocage (mA)</span>
          <input className="nsf-input" type="number" value={d.currentMa?.stall ?? 1500} onChange={(e) => setNested("currentMa", "stall", parseInt(e.target.value))} />
        </label>

        <label className="nsf-field">
          <span className="nsf-label">Poids (g)</span>
          <input className="nsf-input" type="number" step="0.1" value={d.weightG ?? 0} onChange={(e) => set("weightG", parseFloat(e.target.value))} />
        </label>
        <label className="nsf-field">
          <span className="nsf-label">Zone morte (µs)</span>
          <input className="nsf-input" type="number" value={d.deadbandUs ?? 4} onChange={(e) => set("deadbandUs", parseInt(e.target.value))} />
        </label>

        <div className="nsf-field">
          <span className="nsf-label">Dim. L × l × h (mm)</span>
          <div className="nsf-dim-row">
            <input className="nsf-input" type="number" step="0.1" aria-label="Longueur (mm)" placeholder="L" value={d.dimensionsMm?.l ?? 0} onChange={(e) => setNested("dimensionsMm", "l", parseFloat(e.target.value))} />
            <input className="nsf-input" type="number" step="0.1" aria-label="Largeur (mm)" placeholder="l" value={d.dimensionsMm?.w ?? 0} onChange={(e) => setNested("dimensionsMm", "w", parseFloat(e.target.value))} />
            <input className="nsf-input" type="number" step="0.1" aria-label="Hauteur (mm)" placeholder="h" value={d.dimensionsMm?.h ?? 0} onChange={(e) => setNested("dimensionsMm", "h", parseFloat(e.target.value))} />
          </div>
        </div>
        <div className="nsf-field">
          <span className="nsf-label">Impulsions min / centre / max (µs)</span>
          <div className="nsf-dim-row">
            <input className="nsf-input" type="number" aria-label="Impulsion min (µs)" placeholder="min" value={d.pulseUs?.min ?? 500} onChange={(e) => setNested("pulseUs", "min", parseInt(e.target.value))} />
            <input className="nsf-input" type="number" aria-label="Impulsion centre (µs)" placeholder="ctr" value={d.pulseUs?.center ?? 1500} onChange={(e) => setNested("pulseUs", "center", parseInt(e.target.value))} />
            <input className="nsf-input" type="number" aria-label="Impulsion max (µs)" placeholder="max" value={d.pulseUs?.max ?? 2500} onChange={(e) => setNested("pulseUs", "max", parseInt(e.target.value))} />
          </div>
        </div>

        <label className="nsf-field">
          <span className="nsf-label">Réducteur</span>
          <select className="nsf-select" value={d.gearType ?? "metal"} onChange={(e) => set("gearType", e.target.value)}>
            <option value="plastic">Plastique</option>
            <option value="metal">Métal</option>
            <option value="titanium">Titane</option>
          </select>
        </label>
        <label className="nsf-field">
          <span className="nsf-label">Roulements</span>
          <select className="nsf-select" value={d.bearing ?? "ball"} onChange={(e) => set("bearing", e.target.value)}>
            <option value="plain">Lisse</option>
            <option value="ball">Billes</option>
            <option value="dual-ball">Billes doubles</option>
          </select>
        </label>

        <label className="nsf-field">
          <span className="nsf-label">Connecteur</span>
          <select className="nsf-select" value={d.connector ?? "JR"} onChange={(e) => set("connector", e.target.value)}>
            <option value="JR">JR</option>
            <option value="Futaba">Futaba</option>
            <option value="Hitec">Hitec</option>
            <option value="BUS">BUS</option>
          </select>
        </label>
        <label className="nsf-field">
          <span className="nsf-label">Notes</span>
          <input className="nsf-input" value={d.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Description courte" />
        </label>
      </div>

      <div className="nsf-actions">
        <button type="button" className="btn" onClick={onCancel}>Annuler</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!d.brand?.trim() || !d.model?.trim()}
          onClick={handleSave}
        >
          Créer
        </button>
      </div>
    </div>
  );
}

// ── Calibration d'un servo ───────────────────────────────────────────────────

function ServoCalibBlock({
  joint,
  calib,
  onChange,
}: {
  joint: string;
  calib: ServoCalibration;
  onChange: (field: keyof ServoCalibration, value: number | boolean) => void;
}) {
  return (
    <div className="servo-calib-block">
      <div className="scb-joint-label">{JOINT_LABELS[joint]}</div>

      <div className="scb-row">
        <span className="scb-label">Offset zéro</span>
        <div className="scb-inputs">
          <input
            className="scb-num-input"
            type="number"
            step={1}
            min={-180}
            max={180}
            aria-label={`Offset zéro ${JOINT_LABELS[joint]}`}
            value={calib.zeroOffsetDeg}
            onChange={(e) => onChange("zeroOffsetDeg", parseFloat(e.target.value) || 0)}
          />
          <span className="scb-unit">°</span>
        </div>
      </div>

      <div className="scb-row">
        <span className="scb-label">Limites physiques</span>
        <div className="scb-inputs">
          <input className="scb-num-input" type="number" step={1}
            aria-label={`Limite physique min ${JOINT_LABELS[joint]}`}
            value={calib.hardMinDeg}
            onChange={(e) => onChange("hardMinDeg", parseFloat(e.target.value) || 0)} />
          <span className="scb-arrow">→</span>
          <input className="scb-num-input" type="number" step={1}
            aria-label={`Limite physique max ${JOINT_LABELS[joint]}`}
            value={calib.hardMaxDeg}
            onChange={(e) => onChange("hardMaxDeg", parseFloat(e.target.value) || 0)} />
          <span className="scb-unit">°</span>
        </div>
      </div>

      <div className="scb-row">
        <span className="scb-label">Limites logicielles</span>
        <div className="scb-inputs">
          <input className="scb-num-input" type="number" step={1}
            min={calib.hardMinDeg} max={calib.hardMaxDeg}
            aria-label={`Limite logicielle min ${JOINT_LABELS[joint]}`}
            value={calib.softMinDeg}
            onChange={(e) => onChange("softMinDeg", parseFloat(e.target.value) || 0)} />
          <span className="scb-arrow">→</span>
          <input className="scb-num-input" type="number" step={1}
            min={calib.hardMinDeg} max={calib.hardMaxDeg}
            aria-label={`Limite logicielle max ${JOINT_LABELS[joint]}`}
            value={calib.softMaxDeg}
            onChange={(e) => onChange("softMaxDeg", parseFloat(e.target.value) || 0)} />
          <span className="scb-unit">°</span>
        </div>
      </div>

      <div className="scb-row">
        <span className="scb-label">Inversé</span>
        <label className="scb-invert-label">
          <input
            type="checkbox"
            checked={calib.invert}
            onChange={(e) => onChange("invert", e.target.checked)}
          />
          <span>{calib.invert ? "Oui" : "Non"}</span>
        </label>
      </div>
    </div>
  );
}

// ── Modal principale ─────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProfileSettingsModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const [localName, setLocalName] = useState("");
  const [localDesc, setLocalDesc] = useState("");
  const [localLegLayout, setLocalLegLayout] = useState<LegLayout>("star");
  const [globalServoTypeId, setGlobalServoTypeId] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<Record<number, ServoCalibration>>({});
  const [customTypes, setCustomTypes] = useState<ServoSpec[]>([]);
  const [showNewServoForm, setShowNewServoForm] = useState(false);
  const [expandedLegs, setExpandedLegs] = useState<Set<number>>(new Set());
  const [localCollisionPrefs, setLocalCollisionPrefs] = useState<CollisionPrefs>({ ...DEFAULT_COLLISION_PREFS });
  const [saving, setSaving] = useState(false);

  const activeProfileId = useProfilesStore((s) => s.activeProfileId);
  const profiles = useProfilesStore((s) => s.profiles);
  const rename = useProfilesStore((s) => s.rename);
  const update = useProfilesStore((s) => s.update);

  const storeDescription = useHexapodStore((s) => s.description);
  const storeGlobalServoTypeId = useHexapodStore((s) => s.globalServoTypeId);
  const storeCalibration = useHexapodStore((s) => s.servoCalibration);
  const storeGeometry = useHexapodStore((s) => s.geometry);
  const storeCollisionPrefs = useHexapodStore((s) => s.collisionPrefs);
  const setDescription = useHexapodStore((s) => s.setDescription);
  const setGlobalServoTypeIdStore = useHexapodStore((s) => s.setGlobalServoTypeId);
  const setServoCalibrationAll = useHexapodStore((s) => s.setServoCalibrationAll);
  const setCollisionPrefs = useHexapodStore((s) => s.setCollisionPrefs);
  const setGeometry = useHexapodStore((s) => s.setGeometry);

  const showToast = useToastStore((s) => s.show);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  useEffect(() => {
    if (!open) return;
    setTab("general");
    setLocalName(activeProfile?.name ?? "");
    setLocalDesc(storeDescription);
    setLocalLegLayout(storeGeometry.legLayout ?? "star");
    setGlobalServoTypeId(storeGlobalServoTypeId);
    setCalibration({ ...storeCalibration });
    setLocalCollisionPrefs({ ...storeCollisionPrefs });
    setCustomTypes(loadCustomServoTypes());
    setShowNewServoForm(false);
    setExpandedLegs(new Set());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTypes = useMemo(
    () => [...SERVO_CATALOG, ...customTypes],
    [customTypes]
  );

  const selectedType = allTypes.find((t) => t.id === globalServoTypeId) ?? null;

  const handleCalibChange = (
    servoId: number,
    field: keyof ServoCalibration,
    value: number | boolean
  ) => {
    setCalibration((prev) => ({
      ...prev,
      [servoId]: { ...(prev[servoId] ?? DEFAULT_SERVO_CALIB), [field]: value },
    }));
  };

  const toggleLeg = (leg: number) =>
    setExpandedLegs((prev) => {
      const next = new Set(prev);
      if (next.has(leg)) next.delete(leg);
      else next.add(leg);
      return next;
    });

  const handleNewServoSave = (spec: ServoSpec) => {
    saveCustomServoType(spec);
    const refreshed = loadCustomServoTypes();
    setCustomTypes(refreshed);
    setGlobalServoTypeId(spec.id);
    setShowNewServoForm(false);
    showToast(`Servo « ${spec.model} » ajouté`);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (activeProfileId && localName.trim() && localName !== activeProfile?.name) {
        await rename(activeProfileId, localName.trim());
      }
      setDescription(localDesc);
      setGeometry({ legLayout: localLegLayout });
      setGlobalServoTypeIdStore(globalServoTypeId);
      setServoCalibrationAll(calibration);
      setCollisionPrefs(localCollisionPrefs);
      if (activeProfileId) {
        await update(activeProfileId);
        showToast("Paramètres enregistrés");
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} className="modal-wide">
      <h3 className="modal-title">Paramètres du profil</h3>

      <div className="settings-layout">
        {/* ── Onglets verticaux ── */}
        <nav className="settings-tabs">
          <button
            type="button"
            className={`settings-tab${tab === "general" ? " active" : ""}`}
            onClick={() => setTab("general")}
          >
            Général
          </button>
          <button
            type="button"
            className={`settings-tab${tab === "servos" ? " active" : ""}`}
            onClick={() => setTab("servos")}
          >
            Servo-Moteurs
          </button>
          <button
            type="button"
            className={`settings-tab${tab === "collisions" ? " active" : ""}`}
            onClick={() => setTab("collisions")}
          >
            Collisions
          </button>
        </nav>

        {/* ── Contenu ── */}
        <div className="settings-content">

          {/* Tab Général */}
          {tab === "general" && (
            <div className="modal-form">
              <label className="modal-field">
                <span>Nom du profil</span>
                <input
                  type="text"
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  placeholder="ex : Hexapode v1"
                />
              </label>
              <label className="modal-field">
                <span>Description</span>
                <textarea
                  className="settings-textarea"
                  rows={4}
                  value={localDesc}
                  onChange={(e) => setLocalDesc(e.target.value)}
                  placeholder="Notes sur ce profil (configuration, notes de calibration…)"
                />
              </label>

              <div className="modal-field">
                <span>Position des pattes</span>
                <div className="leg-layout-picker">
                  {(["star", "linear"] as LegLayout[]).map((layout) => (
                    <button
                      key={layout}
                      type="button"
                      className={`leg-layout-btn${localLegLayout === layout ? " active" : ""}`}
                      onClick={() => setLocalLegLayout(layout)}
                    >
                      <svg viewBox="0 0 60 40" className="leg-layout-svg" aria-hidden="true">
                        {/* Châssis */}
                        <rect x="20" y="12" width="20" height="16" rx="2"
                          fill="none" stroke="currentColor" strokeWidth="1.5" />
                        {layout === "star" ? (
                          <>
                            {/* Avant gauche +45° */}
                            <line x1="20" y1="16" x2="9"  y2="5"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            {/* Milieu gauche +90° */}
                            <line x1="20" y1="20" x2="6"  y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            {/* Arrière gauche +135° */}
                            <line x1="20" y1="24" x2="9"  y2="35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            {/* Avant droite -45° */}
                            <line x1="40" y1="16" x2="51" y2="5"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            {/* Milieu droite -90° */}
                            <line x1="40" y1="20" x2="54" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            {/* Arrière droite -135° */}
                            <line x1="40" y1="24" x2="51" y2="35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </>
                        ) : (
                          <>
                            {/* 3 pattes gauche toutes à 90° */}
                            <line x1="20" y1="15" x2="6"  y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <line x1="20" y1="20" x2="6"  y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <line x1="20" y1="25" x2="6"  y2="25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            {/* 3 pattes droite toutes à -90° */}
                            <line x1="40" y1="15" x2="54" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <line x1="40" y1="20" x2="54" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <line x1="40" y1="25" x2="54" y2="25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </>
                        )}
                      </svg>
                      <span>{layout === "star" ? "Étoile" : "Rectiligne"}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab Servo-Moteurs */}
          {tab === "servos" && (
            <div className="servos-tab">
              <div className="servos-section">
                <div className="servos-section-title">Type de servo global</div>
                <ServoCombobox
                  value={globalServoTypeId}
                  onChange={(id) => {
                    setGlobalServoTypeId(id);
                    setShowNewServoForm(false);
                  }}
                  types={allTypes}
                  onNew={() => setShowNewServoForm(true)}
                />
              </div>

              {showNewServoForm ? (
                <NewServoForm
                  onSave={handleNewServoSave}
                  onCancel={() => setShowNewServoForm(false)}
                />
              ) : selectedType ? (
                <ServoSpecCard spec={selectedType} />
              ) : (
                <div className="servos-hint">
                  Sélectionnez un modèle de servo-moteur pour afficher sa fiche technique,
                  ou cliquez sur « + Nouveau servo… » pour créer une référence personnalisée.
                </div>
              )}

              {/* Config par patte */}
              {!showNewServoForm && (
                <div className="servos-section">
                  <div className="servos-section-title">Configuration par patte</div>
                  <div className="leg-calib-sections">
                    {Array.from({ length: 6 }, (_, legIndex) => {
                      const expanded = expandedLegs.has(legIndex);
                      return (
                        <div key={legIndex} className="leg-accordion">
                          <button
                            type="button"
                            className="leg-accordion-header"
                            onClick={() => toggleLeg(legIndex)}
                          >
                            <span className="leg-index-badge">{legIndex}</span>
                            {LEG_NAMES[legIndex]}
                            <span className="leg-accordion-caret">{expanded ? "▲" : "▼"}</span>
                          </button>
                          {expanded && (
                            <div className="leg-accordion-content">
                              {JOINTS.map((joint, ji) => {
                                const servoId = legIndex * 3 + ji;
                                const calib = calibration[servoId] ?? DEFAULT_SERVO_CALIB;
                                return (
                                  <ServoCalibBlock
                                    key={joint}
                                    joint={joint}
                                    calib={calib}
                                    onChange={(field, val) => handleCalibChange(servoId, field, val)}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Tab Collisions */}
          {tab === "collisions" && (
            <div className="collision-prefs-tab">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={localCollisionPrefs.enabled}
                  onChange={(e) => setLocalCollisionPrefs((p) => ({ ...p, enabled: e.target.checked }))}
                />
                <span>Activer l&apos;affichage des collisions</span>
                <span className="hint">
                  {localCollisionPrefs.enabled
                    ? "Les segments en collision s'affichent en rouge"
                    : "Détection désactivée"}
                </span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={localCollisionPrefs.includeBody}
                  onChange={(e) => setLocalCollisionPrefs((p) => ({ ...p, includeBody: e.target.checked }))}
                />
                <span>Corps et pattes</span>
                <span className="hint">
                  {localCollisionPrefs.includeBody
                    ? "Détecte aussi les collisions entre les pattes et le châssis"
                    : "Uniquement les collisions entre pattes"}
                </span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={localCollisionPrefs.showArrow}
                  onChange={(e) => setLocalCollisionPrefs((p) => ({ ...p, showArrow: e.target.checked }))}
                />
                <span>Flèche de marquage</span>
                <span className="hint">
                  {localCollisionPrefs.showArrow
                    ? "Affiche une flèche 3D pointant vers le centre de collision"
                    : "Pas de flèche de marquage"}
                </span>
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="modal-actions settings-modal-actions">
        <button type="button" className="btn" onClick={onClose}>Annuler</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </Modal>
  );
}
