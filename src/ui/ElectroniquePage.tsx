import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useSerialStore } from "../store/useSerialStore";
import { useToolboxStore } from "../store/useToolboxStore";
import { SERVOS, LEG_NAMES } from "../model/hexapod";
import { JOINT_REFERENCE_DEG } from "../model/pose";
import { sliderEndLabels } from "../model/servoDirection";
import { useHexapodStore } from "../store/useHexapodStore";
import {
  COMMON_BAUD_RATES,
  defaultBinding,
  protocolForController,
  GENERIC_ASCII_PROTOCOL,
  type ProjectElectronics,
  type ServoBinding,
} from "../model/electronics";
import type { ConnTarget } from "../store/useSerialStore";
import { findServoController } from "../model/servoControllers";
import { findCommandElectronics } from "../model/commandElectronics";
import { BoardSvg, Ssc32uBoard } from "./BoardSvg";
import { ElectroArchitecture } from "./ElectroArchitecture";
import { ElectroSequencePanel } from "./ElectroSequencePanel";
import { CalibrationWizard } from "./CalibrationWizard";

const JOINT_LABEL: Record<string, string> = {
  coxa: "Coxa",
  femur: "Fémur",
  tibia: "Tibia",
};

const STATUS_LABEL: Record<string, string> = {
  unsupported: "Web Serial non supporté",
  disconnected: "Déconnecté",
  connecting: "Connexion…",
  connected: "Connecté",
  error: "Erreur",
};

export function ElectroniquePage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const updateElectronics = useProjectStore((s) => s.updateElectronics);
  const geometry = useHexapodStore((s) => s.geometry);

  const status = useSerialStore((s) => s.status);
  const portLabel = useSerialStore((s) => s.portLabel);
  const baudRate = useSerialStore((s) => s.baudRate);
  const setBaudRate = useSerialStore((s) => s.setBaudRate);
  const target = useSerialStore((s) => s.target);
  const setTarget = useSerialStore((s) => s.setTarget);
  const errorMsg = useSerialStore((s) => s.errorMsg);
  const log = useSerialStore((s) => s.log);
  const testAngles = useSerialStore((s) => s.testAngles);
  const identifying = useSerialStore((s) => s.identifying);
  const connect = useSerialStore((s) => s.connect);
  const disconnect = useSerialStore((s) => s.disconnect);
  const sendServoAngle = useSerialStore((s) => s.sendServoAngle);
  const centerAll = useSerialStore((s) => s.centerAll);
  const releaseAll = useSerialStore((s) => s.releaseAll);
  const identify = useSerialStore((s) => s.identify);
  const testVersion = useSerialStore((s) => s.testVersion);
  const clearLog = useSerialStore((s) => s.clearLog);
  const consoleOpen = useSerialStore((s) => s.consoleOpen);
  const setConsoleOpen = useSerialStore((s) => s.setConsoleOpen);
  const consoleHeight = useSerialStore((s) => s.consoleHeight);
  const setConsoleHeight = useSerialStore((s) => s.setConsoleHeight);
  const rxByteCount = useSerialStore((s) => s.rxByteCount);

  // Sous-onglet routé via l'URL (persisté dans uiPrefs). L'ancien onglet « aide »
  // a été remplacé par une popin dans Architecture : on replie toute valeur héritée
  // (dont "aide") sur "architecture".
  const storedSubTab = useToolboxStore((s) => s.uiPrefs.electroSubTab);
  const setSubTab = useToolboxStore((s) => s.setElectroSubTab);
  const subTab =
    storedSubTab === "calibration" || storedSubTab === "sequence" ? storedSubTab : "architecture";
  useEffect(() => {
    if ((storedSubTab as string) === "aide") setSubTab("architecture");
  }, [storedSubTab, setSubTab]);
  // Rappel « alim servo absente » : masquable une fois lu (la carte ne remonte
  // pas l'état réel de VS, c'est un avertissement contextuel).
  const [powerNoteDismissed, setPowerNoteDismissed] = useState(false);
  // Assistant de calibration guidé (sens de rotation + butées) — modale.
  const [wizardOpen, setWizardOpen] = useState(false);

  // Auto-scroll de la console vers le bas à chaque nouveau message.
  const consoleBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = consoleBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, consoleOpen]);

  // Redimensionnement du panneau console (poignée haute).
  const resizeRef = useRef<{ y: number; h: number } | null>(null);
  const startConsoleResize = (e: React.PointerEvent) => {
    e.preventDefault();
    resizeRef.current = { y: e.clientY, h: consoleHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return;
      const dy = resizeRef.current.y - ev.clientY;
      setConsoleHeight(Math.max(120, Math.min(560, resizeRef.current.h + dy)));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const fmtTime = (t: number) => {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const rxCount = log.filter((e) => e.dir === "rx").length;

  const hardware = activeProject?.hardware;
  const electronics = hardware?.electronics ?? null;

  const controller = useMemo(
    () => (hardware?.servoControllerId ? findServoController(hardware.servoControllerId) ?? null : null),
    [hardware?.servoControllerId]
  );
  const board = useMemo(
    () => (hardware?.commandElectronicsId ? findCommandElectronics(hardware.commandElectronicsId) ?? null : null),
    [hardware?.commandElectronicsId]
  );
  const protocol = useMemo(
    () =>
      target === "command"
        ? GENERIC_ASCII_PROTOCOL
        : protocolForController(hardware?.servoControllerId ?? null),
    [target, hardware?.servoControllerId]
  );
  const channelCount = controller?.channels ?? 32;
  const isSsc = hardware?.servoControllerId === "lynxmotion-ssc-32u";
  const hasController = !!hardware?.servoControllerId;
  const hasCommand = !!hardware?.commandElectronicsId;
  const targetLabel =
    target === "command"
      ? board
        ? `${board.brand} ${board.model}`
        : "Carte de commande"
      : controller
        ? `${controller.brand} ${controller.model} (direct)`
        : "Contrôleur (direct)";

  // Normalise la cible si la carte choisie n'existe pas dans le projet.
  useEffect(() => {
    if (target === "command" && !hasCommand && hasController) setTarget("controller");
    if (target === "controller" && !hasController && hasCommand) setTarget("command");
  }, [target, hasCommand, hasController, setTarget]);

  // Synchronise la vitesse série persistée (projet) vers le store de runtime.
  useEffect(() => {
    if (electronics?.serial.baudRate) setBaudRate(electronics.serial.baudRate);
  }, [electronics?.serial.baudRate, setBaudRate]);

  // Détection des canaux en double (câblage incohérent).
  const dupChannels = useMemo(() => {
    const seen = new Map<number, number>();
    const dup = new Set<number>();
    if (electronics) {
      for (let id = 0; id < SERVOS.length; id++) {
        const ch = electronics.bindings[id]?.channel;
        if (ch == null) continue;
        seen.set(ch, (seen.get(ch) ?? 0) + 1);
      }
      for (const [ch, n] of seen) if (n > 1) dup.add(ch);
    }
    return dup;
  }, [electronics]);

  // Liste des servos câblés (canal défini) avec leur libellé articulation.
  const boundServos = useMemo(() => {
    const out: Array<{ id: number; channel: number; label: string }> = [];
    if (electronics) {
      for (const s of SERVOS) {
        const ch = electronics.bindings[s.id]?.channel;
        if (ch != null) {
          out.push({ id: s.id, channel: ch, label: `${LEG_NAMES[s.legIndex]} · ${JOINT_LABEL[s.joint]}` });
        }
      }
      out.sort((a, b) => a.channel - b.channel);
    }
    return out;
  }, [electronics]);

  if (!activeProject) return null;

  const connected = status === "connected";
  const busy = status === "connecting";

  // Construit une copie complète des liaisons avec une modification ponctuelle.
  function buildBindings(servoId: number, partial: Partial<ServoBinding>): Record<number, ServoBinding> {
    const next: Record<number, ServoBinding> = {};
    for (let id = 0; id < SERVOS.length; id++) {
      const cur = electronics?.bindings[id] ?? defaultBinding(id);
      next[id] = id === servoId ? { ...cur, ...partial } : { ...cur };
    }
    return next;
  }

  function patchBinding(servoId: number, partial: Partial<ServoBinding>) {
    const patch: Partial<ProjectElectronics> = { bindings: buildBindings(servoId, partial) };
    return updateElectronics(patch);
  }

  // Ajuste l'offset d'un servo PUIS renvoie l'angle de test COURANT (sans bouger le
  // slider), pour voir l'effet sur place. L'ordre importe : updateElectronics est
  // async, sinon la commande partirait avec l'ancien offset.
  async function bumpOffset(servoId: number, delta: number, atAngle: number) {
    const b = electronics?.bindings[servoId];
    const cur = b?.centerOffsetDeg ?? 0;
    await patchBinding(servoId, { centerOffsetDeg: +(cur + delta).toFixed(1) });
    if (connected && b?.channel != null) void sendServoAngle(servoId, atAngle);
  }

  function onChangeBaud(b: number) {
    setBaudRate(b);
    void updateElectronics({ serial: { baudRate: b } });
  }

  function autoMap() {
    const next: Record<number, ServoBinding> = {};
    for (let id = 0; id < SERVOS.length; id++) {
      const cur = electronics?.bindings[id] ?? defaultBinding(id);
      next[id] = { ...cur, channel: id };
    }
    void updateElectronics({ bindings: next });
  }

  function resetAllCalibration() {
    const next: Record<number, ServoBinding> = {};
    for (let id = 0; id < SERVOS.length; id++) {
      const cur = electronics?.bindings[id] ?? defaultBinding(id);
      next[id] = { ...cur, centerOffsetDeg: 0 };
    }
    void updateElectronics({ bindings: next });
  }

  return (
    <div className="electro-page">
      {/* ── Haut : titre (30%) + bloc de connexion (70%) ───────────────── */}
      <div className="electro-top">
        <header className="electro-header">
          <div className="electro-title">
            <h2>Électronique</h2>
            <p className="electro-sub">
              Connexion USB, liaison des servomoteurs aux articulations et calibration du zéro
              mécanique.
            </p>
          </div>
        </header>

        {/* ── Bloc de connexion ────────────────────────────────────────── */}
        <section className="electro-conn">
          <div className="electro-conn-info">
            {target === "command" && board ? (
              <BoardSvg
                brand={board.brand}
                model={board.model}
                dimensionsMm={board.dimensionsMm}
                interfaces={board.interfaces}
                gpio={board.gpio}
                width={76}
                className="electro-conn-thumb"
              />
            ) : controller && isSsc ? (
              <Ssc32uBoard width={76} className="electro-conn-thumb" />
            ) : controller ? (
              <BoardSvg
                brand={controller.brand}
                model={controller.model}
                dimensionsMm={controller.dimensionsMm}
                interfaces={controller.interfaces}
                channels={controller.channels}
                width={76}
                className="electro-conn-thumb"
              />
            ) : null}
            <span className={`electro-dot electro-dot--${status}`} />
            <div>
              <div className="electro-conn-status">{STATUS_LABEL[status] ?? status}</div>
              <div className="electro-conn-detail">
                Cible USB : <strong>{targetLabel}</strong>
                {portLabel ? ` · ${portLabel}` : ""}
              </div>
              <div className="electro-conn-detail electro-conn-proto">
                Protocole : {protocol.label}
              </div>
            </div>
          </div>

          <div className="electro-conn-actions">
            {!connected && (hasController || hasCommand) && (
              <label className="electro-baud">
                Cible USB
                <select
                  value={hasCommand && !hasController ? "command" : target}
                  disabled={busy}
                  onChange={(e) => setTarget(e.target.value as ConnTarget)}
                >
                  {hasController && (
                    <option value="controller">
                      {controller ? `${controller.model} (direct)` : "Contrôleur (direct)"}
                    </option>
                  )}
                  {hasCommand && (
                    <option value="command">{board ? board.model : "Carte de commande"}</option>
                  )}
                </select>
              </label>
            )}

            <label className="electro-baud">
              Vitesse
              <select
                value={baudRate}
                disabled={connected || busy}
                onChange={(e) => onChangeBaud(Number(e.target.value))}
              >
                {COMMON_BAUD_RATES.map((b) => (
                  <option key={b} value={b}>
                    {b} bauds{isSsc && b === 9600 ? " (défaut SSC-32U)" : ""}
                  </option>
                ))}
              </select>
            </label>

            {connected ? (
              <>
                <button type="button" className="btn btn-danger" onClick={() => void releaseAll()}>
                  ⏻ Arrêt d'urgence (couple off)
                </button>
                <button type="button" className="btn" onClick={() => void disconnect()}>
                  Déconnecter
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={status === "unsupported" || busy}
                onClick={() => void connect()}
              >
                {busy ? "Connexion…" : "Connecter la carte (USB)"}
              </button>
            )}
          </div>
        </section>
      </div>

      {status === "unsupported" && (
        <div className="electro-banner electro-banner--warn">
          ⚠ Ce navigateur ne supporte pas la <strong>Web Serial API</strong>. Utilisez Chrome ou
          Edge sur ordinateur pour piloter la carte par USB.
        </div>
      )}

      {!hardware?.servoControllerId && (
        <div className="electro-banner electro-banner--info">
          Aucun contrôleur de servos n'est défini dans le projet (onglet Projet → Matériel). Les
          impulsions seront calculées avec des valeurs par défaut (500–2500 µs, centre 1500 µs).
        </div>
      )}

      {!connected && hasController && hasCommand && (
        <div className="electro-banner electro-banner--info">
          Ce projet utilise <strong>deux cartes</strong> : {board?.model} (commande) et{" "}
          {controller?.model} (contrôleur servos). Pour <strong>l'initialisation et la
          calibration</strong>, branchez l'USB <strong>directement sur le {controller?.model}</strong>{" "}
          et choisissez-le comme « Cible USB » ci-dessus. La carte de commande ({board?.model})
          servira ensuite en exploitation.
        </div>
      )}

      {errorMsg && <div className="electro-banner electro-banner--warn">{errorMsg}</div>}

      {/* ── Connecté : infos détaillées + rappel alimentation servo ─────── */}
      {connected && (
        <>
          {!powerNoteDismissed && (
            <div className="electro-banner electro-banner--warn electro-power-note">
              <div>
                ⚡ <strong>Carte connectée en USB.</strong> L'USB n'alimente que la logique : sans
                alimentation <strong>VS1/VS2</strong> (≈ 6 V), les commandes partent bien mais{" "}
                <strong>les servos ne bougeront pas</strong>. Branchez une alim servo sur VS1
                (cavalier VS1=VS2) pour les faire tourner.
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPowerNoteDismissed(true)}
              >
                J'ai compris
              </button>
            </div>
          )}

          <section className="electro-infogrid">
            <div className="electro-info">
              <span className="electro-info-k">Cible USB</span>
              <span className="electro-info-v">{targetLabel}</span>
            </div>
            <div className="electro-info">
              <span className="electro-info-k">Port</span>
              <span className="electro-info-v">{portLabel ?? "—"}</span>
            </div>
            <div className="electro-info">
              <span className="electro-info-k">Protocole</span>
              <span className="electro-info-v">{protocol.label}</span>
            </div>
            <div className="electro-info">
              <span className="electro-info-k">Vitesse</span>
              <span className="electro-info-v">{baudRate} bauds</span>
            </div>
            <div className="electro-info">
              <span className="electro-info-k">Servos câblés</span>
              <span className="electro-info-v">
                {boundServos.length} / {SERVOS.length}
              </span>
            </div>
            <div className="electro-info">
              <span className="electro-info-k">Dernière commande</span>
              <span className="electro-info-v electro-info-mono">
                {log.length ? log[log.length - 1].text : "aucune"}
              </span>
            </div>
          </section>

          {boundServos.length > 0 && (
            <div className="electro-bound-list">
              Câblage : {boundServos.map((b) => `canal ${b.channel} → ${b.label}`).join("  ·  ")}
            </div>
          )}
        </>
      )}

      {/* ── Corps : sous-onglets verticaux ─────────────────────────────── */}
      <div className="electro-body">
        <nav className="electro-subnav">
          <button
            type="button"
            className={`electro-subtab${subTab === "architecture" ? " active" : ""}`}
            onClick={() => setSubTab("architecture")}
          >
            Architecture
          </button>
          <button
            type="button"
            className={`electro-subtab${subTab === "calibration" ? " active" : ""}`}
            onClick={() => setSubTab("calibration")}
          >
            Liaison &amp; calibration
          </button>
          <button
            type="button"
            className={`electro-subtab${subTab === "sequence" ? " active" : ""}`}
            onClick={() => setSubTab("sequence")}
          >
            Séquence → carte
          </button>
        </nav>

        <div className="electro-subpanel">
          {subTab === "architecture" && <ElectroArchitecture />}

          {subTab === "calibration" && (
            <>
              {/* ── Actions globales ─────────────────────────────────── */}
              <section className="electro-globals">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setWizardOpen(true)}
                  title="Vérifier le sens de rotation et régler les butées, patte par patte"
                >
                  🧭 Assistant de calibration guidé
                </button>
                <button type="button" className="btn" onClick={autoMap}>
                  Auto-mapper les canaux (0–17)
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!connected}
                  onClick={() => void centerAll()}
                >
                  Tout centrer
                </button>
                <button type="button" className="btn" onClick={resetAllCalibration}>
                  Réinitialiser les offsets
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!connected}
                  onClick={() => void testVersion()}
                  title="Envoie VER : la carte renvoie sa version (test de présence, visible dans la console)"
                >
                  Tester la carte (VER)
                </button>
                <span className="electro-hint">
                  Les flèches sous chaque slider indiquent le mouvement <strong>attendu</strong>{" "}
                  (modèle) : si une patte part à l'inverse, cochez « Inverser ». « Neutre » amène à
                  la position de repos ; réglez ensuite le « Zéro » pour l'alignement mécanique.
                  Enregistrement automatique.
                </span>
              </section>

              {/* ── Liaisons par patte ───────────────────────────────── */}
              <section className="electro-legs">
                {[0, 1, 2, 3, 4, 5].map((legIdx) => (
          <div className="electro-leg" key={legIdx}>
            <div className="electro-leg-title">{LEG_NAMES[legIdx]}</div>
            {SERVOS.filter((s) => s.legIndex === legIdx).map((s) => {
              const binding = electronics?.bindings[s.id] ?? defaultBinding(s.id);
              const angle = testAngles[s.id] ?? 0;
              const isDup = binding.channel != null && dupChannels.has(binding.channel);
              const isIdentifying = identifying === s.id;
              // Direction attendue (modèle 3D) à chaque extrémité du slider — c'est la
              // référence vers laquelle régler « Inverser » (indépendant de son état).
              const dirs = sliderEndLabels(geometry, legIdx, s.joint);
              return (
                <div
                  className={`electro-servo${isIdentifying ? " electro-servo--ident" : ""}`}
                  key={s.id}
                >
                  <div className="electro-servo-head">
                    <span className="electro-servo-name">{JOINT_LABEL[s.joint]}</span>
                    <label className={`electro-channel${isDup ? " electro-channel--dup" : ""}`}>
                      Canal
                      <input
                        type="number"
                        min={0}
                        max={channelCount - 1}
                        value={binding.channel ?? ""}
                        placeholder="—"
                        onChange={(e) => {
                          const v = e.target.value;
                          patchBinding(s.id, {
                            channel: v === "" ? null : Math.max(0, Math.floor(Number(v))),
                          });
                        }}
                      />
                      {isDup && <span className="electro-dup-flag" title="Canal en double">⚠</span>}
                    </label>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!connected || binding.channel == null}
                      onClick={() => void sendServoAngle(s.id, JOINT_REFERENCE_DEG[s.joint])}
                      title="Amener à la position neutre (coxa/fémur : aligné ; tibia : perpendiculaire)"
                    >
                      Neutre
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!connected || binding.channel == null}
                      onClick={() => void identify(s.id)}
                      title="Faire osciller pour identifier le servo"
                    >
                      Identifier
                    </button>
                    <label className="electro-invert">
                      <input
                        type="checkbox"
                        checked={binding.invert}
                        onChange={(e) => patchBinding(s.id, { invert: e.target.checked })}
                      />
                      Inverser
                    </label>
                  </div>

                  <div className="electro-servo-test">
                    <span className="electro-dir" title="Mouvement attendu (modèle) à cette extrémité">
                      {dirs.low}
                    </span>
                    <input
                      type="range"
                      min={s.minDeg}
                      max={s.maxDeg}
                      step={1}
                      value={angle}
                      disabled={!connected || binding.channel == null}
                      onChange={(e) => void sendServoAngle(s.id, Number(e.target.value))}
                      aria-label={`Test ${LEG_NAMES[legIdx]} ${JOINT_LABEL[s.joint]}`}
                    />
                    <span className="electro-dir" title="Mouvement attendu (modèle) à cette extrémité">
                      {dirs.high}
                    </span>
                    <span className="electro-angle">{angle.toFixed(0)}°</span>
                  </div>

                  <div className="electro-servo-cal">
                    <span
                      className="electro-cal-label"
                      title="Décalage entre le 0 du servo et le 0 mécanique attendu"
                    >
                      Zéro&nbsp;:
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void bumpOffset(s.id, -90, angle)}
                      title="Quart de tour (ex. tibia perpendiculaire)"
                    >
                      −90°
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void bumpOffset(s.id, -5, angle)}
                    >
                      −5°
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void bumpOffset(s.id, -0.5, angle)}
                    >
                      −
                    </button>
                    <span className="electro-cal-val">{binding.centerOffsetDeg.toFixed(1)}°</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void bumpOffset(s.id, 0.5, angle)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void bumpOffset(s.id, 5, angle)}
                    >
                      +5°
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void bumpOffset(s.id, 90, angle)}
                      title="Quart de tour (ex. tibia perpendiculaire)"
                    >
                      +90°
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm electro-cal-reset"
                      onClick={() => void patchBinding(s.id, { centerOffsetDeg: 0 })}
                      title="Remettre l'offset à 0"
                    >
                      RAZ
                    </button>
                    {(binding.minDeg != null || binding.maxDeg != null) && (
                      <span
                        className="electro-cal-limits"
                        title="Butées définies via l'assistant de calibration"
                      >
                        ⟦ {binding.minDeg ?? s.minDeg}° … {binding.maxDeg ?? s.maxDeg}° ⟧
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
                  </div>
                ))}
              </section>
            </>
          )}

          {subTab === "sequence" && <ElectroSequencePanel />}
        </div>
      </div>

      {/* ── Assistant de calibration guidé (modale) ────────────────────── */}
      {wizardOpen && <CalibrationWizard onClose={() => setWizardOpen(false)} />}

      {/* ── Panneau console série bas (escamotable) ────────────────────── */}
      <div
        className={`electro-console${consoleOpen ? " open" : ""}`}
        // eslint-disable-next-line react/forbid-component-props
        style={{ "--electro-console-h": `${consoleHeight}px` } as React.CSSProperties}
      >
        <button
          type="button"
          className="electro-console-handle"
          onClick={() => setConsoleOpen(!consoleOpen)}
          title={`${consoleOpen ? "Fermer" : "Ouvrir"} la console série`}
        >
          Console série
          {rxCount > 0 ? ` · ${rxCount} reçu${rxCount > 1 ? "s" : ""}` : ""} {consoleOpen ? "▾" : "▴"}
        </button>

        <div className="electro-console-content">
          <div className="electro-console-resize" onPointerDown={startConsoleResize} />

          <div className="electro-console-bar">
            <span className="electro-console-title">
              Émission <span className="ec-tx">→</span> / Réception <span className="ec-rx">←</span>
            </span>
            <span className="electro-console-count">
              {log.length} ligne{log.length > 1 ? "s" : ""} · RX {rxByteCount} octet{rxByteCount > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={clearLog}
              disabled={log.length === 0}
              title="Vider la console"
            >
              Clean
            </button>
          </div>

          <div className="electro-console-body" ref={consoleBodyRef}>
            {log.length === 0 ? (
              <div className="electro-console-empty">
                Aucun échange. Connectez la carte puis bougez un servo, ou cliquez « Tester la carte
                (VER) ».
              </div>
            ) : (
              log.map((e, i) => (
                <div key={i} className={`ec-line ec-line--${e.dir}`}>
                  <span className="ec-time">{fmtTime(e.t)}</span>
                  <span className="ec-arrow">
                    {e.dir === "tx" ? "→" : e.dir === "rx" ? "←" : "•"}
                  </span>
                  <span className="ec-text">{e.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
