// Sous-onglet « Architecture » : vue 2D du matériel électronique défini dans
// le projet (carte de commande → contrôleur de servos → servomoteurs), avec
// une zone extensible pour les futurs capteurs / périphériques.
//
// Lecture seule pour l'instant : reflète hardware (useProjectStore). Les blocs
// « à venir » sont des emplacements désactivés, prêts à être activés quand le
// modèle gérera capteurs et périphériques.

import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useDebouncedCallback } from "./useDebouncedCallback";
import type { PowerRail, PowerSourceKind, ProjectPower } from "../model/power";
import {
  assessServoRail,
  assessCommandRail,
  buildPowerAdvice,
  type RailBudget,
  type Verdict,
  type AdviceSeverity,
} from "../model/powerBudget";
import { SERVOS, LEG_NAMES } from "../model/hexapod";
import { findServoController } from "../model/servoControllers";
import { findCommandElectronics } from "../model/commandElectronics";
import { findServoType } from "../model/servoTypes";
import { BoardSvg, Ssc32uBoard } from "./BoardSvg";
import { Ssc32uHelp } from "./Ssc32uHelp";
import { DecimalInput } from "./DecimalInput";
import { PeripheralPicker } from "./PeripheralPicker";
import {
  PERIPHERAL_CATEGORIES,
  findPeripheral,
  newPeripheralUid,
  type PeripheralPlacement,
  type ProjectPeripheral,
} from "../model/peripherals";

// Guide officiel SSC-32U (déposé dans public/docs/, servi à la racine), FR + EN.
const SSC32U_DOC_URLS: Record<"fr" | "en", string> = {
  fr: "/docs/lynxmotion_ssc-32u_usb_user_guide-fr.pdf",
  en: "/docs/lynxmotion_ssc-32u_usb_user_guide-en.pdf",
};

/** Interface de liaison la plus probable entre deux cartes (intersection). */
function linkInterface(a: string[], b: string[]): string {
  const norm = (s: string) => s.toLowerCase();
  const inA = (kw: string) => a.some((i) => norm(i).includes(kw));
  const inB = (kw: string) => b.some((i) => norm(i).includes(kw));
  for (const kw of ["uart", "i2c", "spi", "usb"]) {
    if (inA(kw) && inB(kw)) return kw.toUpperCase();
  }
  return "Série";
}

/** Petit pictogramme de servo (boîtier + palonnier). */
function ServoGlyph() {
  return (
    <svg viewBox="0 0 40 30" className="arch-servo-glyph" aria-hidden="true">
      <rect x="6" y="8" width="22" height="18" rx="2" fill="#2b3240" stroke="var(--border)" />
      <rect x="2" y="12" width="4" height="10" fill="#2b3240" stroke="var(--border)" />
      <rect x="28" y="12" width="4" height="10" fill="#2b3240" stroke="var(--border)" />
      <circle cx="17" cy="11" r="5" fill="#1a1d24" stroke="var(--accent)" />
      <line x1="17" y1="11" x2="34" y2="6" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="34" cy="6" r="2" fill="var(--accent)" />
    </svg>
  );
}

/** Champs éditables d'une alimentation (présence, source, tension, capacité). */
function PowerRailFields({
  rail,
  onChange,
  allowUsb = false,
}: {
  rail: PowerRail;
  onChange: (partial: Partial<PowerRail>) => void;
  allowUsb?: boolean;
}) {
  const isUsb = rail.kind === "usb";
  const onKind = (k: PowerSourceKind) => {
    if (k === "usb") {
      // USB : ≈ 5 V, courant limité par le port — pré-remplit des valeurs sensées.
      onChange({ kind: "usb", source: "USB", voltageV: 5, maxCurrentA: rail.maxCurrentA ?? 0.5 });
    } else {
      onChange({ kind: k });
    }
  };
  return (
    <div className={`arch-power-fields${rail.enabled ? "" : " arch-power-fields--off"}`}>
      <label className="arch-power-toggle">
        <input
          type="checkbox"
          checked={rail.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        Alimentation branchée
      </label>
      <div className="arch-power-row">
        <label className="arch-power-field">
          Type
          <select value={rail.kind} onChange={(e) => onKind(e.target.value as PowerSourceKind)}>
            <option value="battery">Batterie(s)</option>
            <option value="bench">Alimentation de bureau</option>
            {allowUsb && <option value="usb">USB</option>}
          </select>
        </label>
        {!isUsb && (
          <label className="arch-power-field">
            Source
            <input
              type="text"
              value={rail.source}
              placeholder={
                rail.kind === "bench" ? "ex. Alim labo 6 V" : "ex. LiPo 2S, Ni-MH 7.2 V…"
              }
              onChange={(e) => onChange({ source: e.target.value })}
            />
          </label>
        )}
      </div>
      {isUsb ? (
        <>
          <label className="arch-power-field">
            Courant dispo (A)
            <DecimalInput
              value={rail.maxCurrentA}
              placeholder="0.5"
              ariaLabel="Courant USB disponible en ampères"
              onChange={(v) => onChange({ maxCurrentA: v })}
            />
          </label>
          <div className="arch-power-note">
            ≈ 5 V · limité par le port (USB 2.0 ~0,5 A, USB 3.0 ~0,9 A, USB-C davantage). Alimente la
            logique uniquement.
          </div>
        </>
      ) : (
        <div className="arch-power-row">
          <label className="arch-power-field">
            Tension (V)
            <DecimalInput
              value={rail.voltageV}
              placeholder="—"
              ariaLabel="Tension en volts"
              onChange={(v) => onChange({ voltageV: v })}
            />
          </label>
          {rail.kind === "bench" ? (
            <label className="arch-power-field">
              Intensité max (A)
              <DecimalInput
                value={rail.maxCurrentA}
                placeholder="—"
                ariaLabel="Intensité maximale en ampères"
                onChange={(v) => onChange({ maxCurrentA: v })}
              />
            </label>
          ) : (
            <label className="arch-power-field">
              Capacité (mAh)
              <DecimalInput
                value={rail.capacityMah}
                placeholder="—"
                ariaLabel="Capacité en mAh"
                onChange={(v) => onChange({ capacityMah: v })}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

const VERDICT_ICON: Record<Verdict, string> = {
  ok: "✓",
  oversized: "✓",
  tight: "△",
  warn: "⚠",
  insufficient: "✗",
  unknown: "·",
  info: "ℹ",
};

const ADVICE_ICON: Record<AdviceSeverity, string> = { danger: "⛔", warn: "⚠", tip: "🔧", ok: "✓" };

/** Affiche le bilan d'un rail : verdict en tête + lignes de détail. */
function BudgetView({ budget }: { budget: RailBudget }) {
  return (
    <div className="arch-budget">
      <div className={`arch-budget-headline v-${budget.headline.verdict}`}>
        <span className="arch-budget-ico">{VERDICT_ICON[budget.headline.verdict]}</span>
        <span>{budget.headline.value}</span>
      </div>
      {budget.lines.map((l, i) => (
        <div key={i} className={`arch-budget-line v-${l.verdict}`}>
          <span className="arch-budget-ico">{VERDICT_ICON[l.verdict]}</span>
          <span className="arch-budget-label">{l.label}</span>
          <span className="arch-budget-val">{l.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Puce d'alimentation affichée dans le nœud du schéma quand le rail est branché. */
function PowerChip({ rail, shared }: { rail: PowerRail; shared?: boolean }) {
  if (!rail.enabled) return null;
  const kindLabel = rail.kind === "bench" ? "Alim de bureau" : rail.kind === "usb" ? "USB" : "Batterie";
  const bits: string[] = [rail.source || kindLabel];
  if (rail.voltageV != null) bits.push(`${rail.voltageV} V`);
  if (rail.kind !== "battery" && rail.maxCurrentA != null) bits.push(`${rail.maxCurrentA} A`);
  if (rail.kind === "battery" && rail.capacityMah != null) bits.push(`${rail.capacityMah} mAh`);
  return (
    <div className="arch-node-power" title="Alimentation branchée">
      <span aria-hidden="true">⚡</span> {bits.join(" · ")}
      {shared ? " · VS=VL" : ""}
    </div>
  );
}

/** Puce d'un périphérique dans le schéma (autour de la carte de commande). */
function PeriphChip({ periph }: { periph: ProjectPeripheral }) {
  const spec = findPeripheral(periph.specId);
  const label = periph.label || spec?.name || periph.specId;
  const icon = spec?.icon ?? "🧩";
  const bus = spec?.interfaces[0];
  return (
    <div className="arch-periph-chip" title={spec?.description ?? label}>
      <span aria-hidden="true">{icon}</span> {label}
      {bus ? <span className="arch-periph-bus">{bus}</span> : null}
    </div>
  );
}

export function ElectroArchitecture() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const updateHardware = useProjectStore((s) => s.updateHardware);
  const hardware = activeProject?.hardware;

  const board = useMemo(
    () => (hardware?.commandElectronicsId ? findCommandElectronics(hardware.commandElectronicsId) ?? null : null),
    [hardware?.commandElectronicsId]
  );
  const controller = useMemo(
    () => (hardware?.servoControllerId ? findServoController(hardware.servoControllerId) ?? null : null),
    [hardware?.servoControllerId]
  );
  const servoType = useMemo(
    () => findServoType(hardware?.servoTypeId ?? null, hardware?.customServoTypes ?? []),
    [hardware?.servoTypeId, hardware?.customServoTypes]
  );

  const electronics = hardware?.electronics ?? null;
  const wiredCount = useMemo(() => {
    if (!electronics) return 0;
    let n = 0;
    for (const s of SERVOS) if (electronics.bindings[s.id]?.channel != null) n++;
    return n;
  }, [electronics]);

  const cmdToCtrl = board && controller ? linkInterface(board.interfaces, controller.interfaces) : null;

  // État local optimiste de l'alimentation : l'UI réagit instantanément, et la
  // persistance projet est différée (anti-rebond) pour ne pas émettre un PUT à
  // chaque frappe. `dirtyRef` empêche un retour serveur d'écraser une saisie en
  // cours pendant qu'une sauvegarde est en attente.
  const hardwarePower = activeProject?.hardware?.power ?? null;
  const [localPower, setLocalPower] = useState<ProjectPower | null>(hardwarePower);
  const dirtyRef = useRef(false);
  const saveHardwarePower = useDebouncedCallback((p: ProjectPower) => {
    void useProjectStore
      .getState()
      .updateHardware({ power: p })
      .finally(() => {
        dirtyRef.current = false;
      });
  }, 400);
  useEffect(() => {
    if (!dirtyRef.current) setLocalPower(hardwarePower);
  }, [hardwarePower]);

  // Popin d'aide sur la carte contrôleur (remplace l'ancien sous-onglet « Aide carte »).
  const [archTab, setArchTab] = useState<"power" | "sensors">("power");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTab, setHelpTab] = useState<"aide" | "doc">("aide");
  const [docLang, setDocLang] = useState<"fr" | "en">("fr");
  const [helpMaximized, setHelpMaximized] = useState(false);
  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelpOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  if (!hardware) return null;

  const nothingDefined = !board && !controller;

  // Alimentation + activation de la carte de commande (persistés au niveau projet).
  // `power` vient de l'état local optimiste ; les écritures sont différées.
  const power = localPower ?? hardware.power;
  const commandEnabled = hardware.commandEnabled;
  const commandActive = commandEnabled && !!board;

  const patchPower = (partial: Partial<ProjectPower>) => {
    const next = { ...power, ...partial };
    dirtyRef.current = true;
    setLocalPower(next);
    saveHardwarePower(next);
  };
  const patchRail = (key: "servo" | "command", partial: Partial<PowerRail>) => {
    patchPower({ [key]: { ...power[key], ...partial } });
  };
  // L'activation de la carte de commande est un interrupteur ponctuel : on
  // l'enregistre immédiatement, en joignant l'alimentation locale courante pour
  // ne pas réécrire une version périmée du `power`.
  const setCommandEnabled = (v: boolean) => {
    void updateHardware({ commandEnabled: v, power });
  };

  // ── Capteurs & périphériques ────────────────────────────────────────────────
  const peripherals = hardware.peripherals ?? [];
  const savePeripherals = (next: ProjectPeripheral[]) => void updateHardware({ peripherals: next });
  const addPeripheral = (specId: string) =>
    savePeripherals([...peripherals, { uid: newPeripheralUid(), specId, placement: "above" }]);
  const removePeripheral = (uid: string) =>
    savePeripherals(peripherals.filter((p) => p.uid !== uid));
  const setPeripheralPlacement = (uid: string, placement: PeripheralPlacement) =>
    savePeripherals(peripherals.map((p) => (p.uid === uid ? { ...p, placement } : p)));
  const periphsAbove = peripherals.filter((p) => p.placement === "above");
  const periphsBelow = peripherals.filter((p) => p.placement === "below");

  // Nombre de servos pour l'estimation : ceux câblés, sinon les 18 nominaux.
  const nServos = wiredCount > 0 ? wiredCount : SERVOS.length;
  const servoBudget = assessServoRail({ rail: power.servo, servo: servoType, controller, nServos });
  const commandBudget = assessCommandRail({ rail: power.command, board });
  const advice = buildPowerAdvice({
    servoRail: power.servo,
    commandRail: power.command,
    servoLogicShared: power.servoLogicShared,
    commandActive,
    servo: servoType,
    board,
    nServos,
  });

  return (
    <div className="arch">
      <p className="arch-intro">
        Vue d'ensemble de l'électronique définie dans ce projet. Les éléments proviennent de l'onglet{" "}
        <strong>Projet → Matériel</strong>. Le flux de commande va de la carte de commande vers le
        contrôleur de servos, puis vers les 18 servomoteurs.
      </p>

      {nothingDefined && (
        <div className="electro-banner electro-banner--info">
          Aucune carte n'est encore définie. Renseignez la carte de commande et le contrôleur de
          servos dans <strong>Projet → Matériel</strong> pour voir l'architecture.
        </div>
      )}

      {/* ── Chaîne de commande ─────────────────────────────────────────── */}
      <div className="arch-chain">
        {/* Colonne carte de commande : capteurs au-dessus / nœud / capteurs en-dessous */}
        <div className="arch-cmd-stack">
          {periphsAbove.length > 0 && (
            <div className="arch-periphs arch-periphs--above">
              <div className="arch-periph-chips">
                {periphsAbove.map((p) => (
                  <PeriphChip key={p.uid} periph={p} />
                ))}
              </div>
              <div className="arch-periph-link" />
            </div>
          )}

          {/* Carte de commande */}
          <div
            className={`arch-node${board ? "" : " arch-node--empty"}${
              board && !commandEnabled ? " arch-node--disabled" : ""
            }`}
          >
          <div className="arch-node-role">Carte de commande</div>
          {board ? (
            <>
              <label className="arch-node-toggle" title="Activer ou non la carte de commande">
                <input
                  type="checkbox"
                  checked={commandEnabled}
                  onChange={(e) => setCommandEnabled(e.target.checked)}
                />
                {commandEnabled ? "Activée" : "Désactivée"}
              </label>
              <BoardSvg
                brand={board.brand}
                model={board.model}
                dimensionsMm={board.dimensionsMm}
                interfaces={board.interfaces}
                gpio={board.gpio}
                width={150}
              />
              <div className="arch-node-name">{board.brand} {board.model}</div>
              <div className="arch-node-meta">{board.cpu}</div>
              {commandEnabled && <PowerChip rail={power.command} />}
              {!commandEnabled && (
                <div className="arch-node-meta arch-node-bypass">
                  Hors chaîne — USB direct sur le contrôleur
                </div>
              )}
            </>
          ) : (
            <div className="arch-node-placeholder">non défini</div>
          )}
          </div>

          {periphsBelow.length > 0 && (
            <div className="arch-periphs arch-periphs--below">
              <div className="arch-periph-link" />
              <div className="arch-periph-chips">
                {periphsBelow.map((p) => (
                  <PeriphChip key={p.uid} periph={p} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Lien commande → contrôleur */}
        <div className="arch-link">
          <span className="arch-link-label">{commandActive ? (cmdToCtrl ?? "—") : "USB"}</span>
          <div className={`arch-link-line${commandActive ? "" : " arch-link-line--bypass"}`} />
          <span className="arch-link-arrow">▸</span>
        </div>

        {/* Contrôleur de servos */}
        <div className={`arch-node arch-node--ctrl${controller ? "" : " arch-node--empty"}`}>
          <div className="arch-node-role">Contrôleur de servos</div>
          {controller ? (
            <>
              <button
                type="button"
                className="arch-help-btn"
                onClick={() => setHelpOpen(true)}
                title="Aide sur cette carte"
                aria-label="Aide sur cette carte"
              >
                ?
              </button>
              {controller.id === "lynxmotion-ssc-32u" ? (
                <Ssc32uBoard width={150} />
              ) : (
                <BoardSvg
                  brand={controller.brand}
                  model={controller.model}
                  dimensionsMm={controller.dimensionsMm}
                  interfaces={controller.interfaces}
                  channels={controller.channels}
                  width={150}
                />
              )}
              <div className="arch-node-name">{controller.brand} {controller.model}</div>
              <div className="arch-node-meta">{controller.channels} canaux · {controller.pulseUs.min}–{controller.pulseUs.max} µs</div>
              <PowerChip rail={power.servo} shared={power.servoLogicShared} />
            </>
          ) : (
            <div className="arch-node-placeholder">non défini</div>
          )}
        </div>

        {/* Lien contrôleur → servos */}
        <div className="arch-link">
          <span className="arch-link-label">PWM</span>
          <div className="arch-link-line" />
          <span className="arch-link-arrow">▸</span>
        </div>

        {/* Servomoteurs */}
        <div className="arch-node arch-node--servos">
          <div className="arch-node-role">Servomoteurs</div>
          <div className="arch-servo-grid">
            {[0, 1, 2, 3, 4, 5].map((leg) => (
              <div className="arch-leg" key={leg} title={LEG_NAMES[leg]}>
                <ServoGlyph />
                <ServoGlyph />
                <ServoGlyph />
                <span className="arch-leg-label">{LEG_NAMES[leg]}</span>
              </div>
            ))}
          </div>
          <div className="arch-node-meta">
            18 servos · {wiredCount} câblé{wiredCount > 1 ? "s" : ""}
            {servoType ? ` · ${servoType.brand} ${servoType.model}` : ""}
          </div>
        </div>
      </div>

      {/* ── Onglets sous le schéma : Alimentation / Capteurs ───────────── */}
      <div className="arch-tabs">
        <button
          type="button"
          className={`arch-tab${archTab === "power" ? " active" : ""}`}
          onClick={() => setArchTab("power")}
        >
          ⚡ Alimentation
        </button>
        <button
          type="button"
          className={`arch-tab${archTab === "sensors" ? " active" : ""}`}
          onClick={() => setArchTab("sensors")}
        >
          Capteurs &amp; périphériques
        </button>
      </div>

      {/* ── Onglet Alimentation ────────────────────────────────────────── */}
      {archTab === "power" && (
        <div className="arch-tab-panel">
          {!controller && !commandActive && (
            <div className="electro-banner electro-banner--info">
              Définissez la carte de commande et/ou le contrôleur de servos (Projet → Matériel) pour
              renseigner leur alimentation.
            </div>
          )}
          {/* Ordre aligné sur le schéma : carte de commande (gauche) puis contrôleur. */}
          <div className="arch-power-grid">
            {/* Alim → carte de commande */}
            {commandActive && board && (
              <div className="arch-power-card">
                <div className="arch-power-card-head">
                  <span className="arch-power-card-title">→ Carte de commande</span>
                  <span className="arch-power-card-target">
                    {board.brand} {board.model} · logique {board.voltageV} V
                  </span>
                </div>
                <PowerRailFields
                  rail={power.command}
                  onChange={(p) => patchRail("command", p)}
                  allowUsb
                />
                <BudgetView budget={commandBudget} />
              </div>
            )}

            {/* Alim → contrôleur de servos (rail VS) */}
            {controller && (
              <div className="arch-power-card">
                <div className="arch-power-card-head">
                  <span className="arch-power-card-title">→ Contrôleur de servos</span>
                  <span className="arch-power-card-target">
                    {controller.model} · rail <strong>VS</strong>
                    {controller.voltageServoV
                      ? ` (${controller.voltageServoV[0]}–${controller.voltageServoV[1]} V)`
                      : ""}
                  </span>
                </div>
                <PowerRailFields rail={power.servo} onChange={(p) => patchRail("servo", p)} />
                <label className="arch-power-toggle arch-power-shared">
                  <input
                    type="checkbox"
                    checked={power.servoLogicShared}
                    onChange={(e) => patchPower({ servoLogicShared: e.target.checked })}
                  />
                  Logique (SL/VL) sur la même alim que les servos
                </label>
                <div className="arch-power-note">
                  {power.servoLogicShared
                    ? "Servo = logique : un seul rail alimente VS et VL (cavalier VS=VL)."
                    : "Servo ≠ logique : la logique (SL/VL) est alimentée séparément (USB ou source dédiée)."}
                </div>
                <BudgetView budget={servoBudget} />
              </div>
            )}
          </div>

          {(controller || commandActive) && advice.length > 0 && (
            <div className="arch-advice">
              <div className="arch-advice-title">Conseils &amp; composants</div>
              {advice.map((a, i) => (
                <div key={i} className={`arch-advice-item adv-${a.severity}`}>
                  <span className="arch-advice-ico" aria-hidden="true">
                    {ADVICE_ICON[a.severity]}
                  </span>
                  <div className="arch-advice-text">
                    <strong>{a.title}</strong>
                    <div className="arch-advice-detail">{a.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Onglet Capteurs & périphériques ────────────────────────────── */}
      {archTab === "sensors" && (
        <div className="arch-tab-panel">
          <div className="arch-periph-bar">
            <span className="arch-periph-count">
              {peripherals.length} élément{peripherals.length > 1 ? "s" : ""} relié
              {peripherals.length > 1 ? "s" : ""} à la carte de commande
            </span>
            <button type="button" className="btn btn-primary" onClick={() => setPickerOpen(true)}>
              + Ajouter un capteur / périphérique
            </button>
          </div>

          {peripherals.length === 0 ? (
            <div className="electro-banner electro-banner--info">
              Aucun capteur ni périphérique. Cliquez « Ajouter » pour en choisir dans le référentiel
              (MPU6050, HC-SR04, LEDs, boutons, détecteur de tension…). Ils apparaîtront autour de la
              carte de commande dans le schéma.
            </div>
          ) : (
            <table className="arch-periph-table">
              <thead>
                <tr>
                  <th aria-label="Icône"></th>
                  <th>Nom</th>
                  <th>Catégorie</th>
                  <th>Liaison</th>
                  <th>Emplacement</th>
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {peripherals.map((p) => {
                  const spec = findPeripheral(p.specId);
                  return (
                    <tr key={p.uid}>
                      <td className="arch-periph-td-icon" aria-hidden="true">
                        {spec?.icon ?? "🧩"}
                      </td>
                      <td>
                        <div className="arch-periph-td-name">{p.label || spec?.name || p.specId}</div>
                        {spec?.description && (
                          <div className="arch-periph-td-desc">{spec.description}</div>
                        )}
                      </td>
                      <td>{spec ? PERIPHERAL_CATEGORIES[spec.category].label : "—"}</td>
                      <td>{spec?.interfaces.join(" · ") ?? "—"}</td>
                      <td>
                        <select
                          value={p.placement}
                          onChange={(e) =>
                            setPeripheralPlacement(p.uid, e.target.value as PeripheralPlacement)
                          }
                          aria-label="Emplacement dans le schéma"
                        >
                          <option value="above">Au-dessus</option>
                          <option value="below">En-dessous</option>
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => removePeripheral(p.uid)}
                          title="Retirer"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <PeripheralPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={addPeripheral}
      />

      {/* ── Popin d'aide carte ─────────────────────────────────────────── */}
      {helpOpen && (
        <div
          className="electro-help-modal-backdrop"
          onClick={() => setHelpOpen(false)}
          role="presentation"
        >
          <div
            className={`electro-help-modal${helpMaximized ? " electro-help-modal--max" : ""}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Aide sur la carte contrôleur"
          >
            <button
              type="button"
              className="electro-help-modal-expand"
              onClick={() => setHelpMaximized((v) => !v)}
              title={helpMaximized ? "Réduire" : "Agrandir"}
              aria-label={helpMaximized ? "Réduire la fenêtre" : "Agrandir la fenêtre"}
            >
              {helpMaximized ? "🗗" : "⛶"}
            </button>
            <button
              type="button"
              className="electro-help-modal-close"
              onClick={() => setHelpOpen(false)}
              aria-label="Fermer l'aide"
            >
              ✕
            </button>

            <div className="electro-help-tabs">
              <button
                type="button"
                className={`electro-help-tab${helpTab === "aide" ? " active" : ""}`}
                onClick={() => setHelpTab("aide")}
              >
                Aide rapide
              </button>
              <button
                type="button"
                className={`electro-help-tab${helpTab === "doc" ? " active" : ""}`}
                onClick={() => setHelpTab("doc")}
              >
                Documentation complète
              </button>
            </div>

            <div className="electro-help-modal-body">
              {helpTab === "aide" ? (
                <div className="electro-help-scroll">
                  <Ssc32uHelp controllerId={hardware?.servoControllerId ?? null} />
                </div>
              ) : (
                <>
                  <div className="electro-help-doc-bar">
                    <div className="electro-help-doc-lang">
                      <span>Guide officiel Lynxmotion SSC-32U</span>
                      <button
                        type="button"
                        className={`electro-help-lang-btn${docLang === "fr" ? " active" : ""}`}
                        onClick={() => setDocLang("fr")}
                      >
                        Français
                      </button>
                      <button
                        type="button"
                        className={`electro-help-lang-btn${docLang === "en" ? " active" : ""}`}
                        onClick={() => setDocLang("en")}
                      >
                        English
                      </button>
                    </div>
                    <a href={SSC32U_DOC_URLS[docLang]} target="_blank" rel="noopener noreferrer">
                      Ouvrir dans un nouvel onglet ↗
                    </a>
                  </div>
                  <iframe
                    className="electro-help-doc-frame"
                    src={SSC32U_DOC_URLS[docLang]}
                    title={`Documentation SSC-32U (${docLang === "fr" ? "français" : "anglais"})`}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
