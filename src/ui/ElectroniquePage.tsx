import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useSerialStore } from "../store/useSerialStore";
import { SERVOS, LEG_NAMES } from "../model/hexapod";
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
import { Ssc32uHelp } from "./Ssc32uHelp";
import { BoardSvg } from "./BoardSvg";

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
  const centerServo = useSerialStore((s) => s.centerServo);
  const centerAll = useSerialStore((s) => s.centerAll);
  const releaseAll = useSerialStore((s) => s.releaseAll);
  const identify = useSerialStore((s) => s.identify);

  type SubTab = "calibration" | "aide" | "journal";
  const [subTab, setSubTab] = useState<SubTab>("calibration");

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
    void updateElectronics(patch);
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
      <header className="electro-header">
        <div className="electro-title">
          <h2>Électronique</h2>
          <p className="electro-sub">
            Connexion USB, liaison des servomoteurs aux articulations et calibration du zéro mécanique.
          </p>
        </div>
      </header>

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

      {/* ── Barre de connexion ─────────────────────────────────────────── */}
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

      {/* ── Corps : sous-onglets verticaux ─────────────────────────────── */}
      <div className="electro-body">
        <nav className="electro-subnav">
          <button
            type="button"
            className={`electro-subtab${subTab === "calibration" ? " active" : ""}`}
            onClick={() => setSubTab("calibration")}
          >
            Liaison &amp; calibration
          </button>
          <button
            type="button"
            className={`electro-subtab${subTab === "aide" ? " active" : ""}`}
            onClick={() => setSubTab("aide")}
          >
            Aide carte
          </button>
          <button
            type="button"
            className={`electro-subtab${subTab === "journal" ? " active" : ""}`}
            onClick={() => setSubTab("journal")}
          >
            Journal{log.length > 0 ? ` (${log.length})` : ""}
          </button>
        </nav>

        <div className="electro-subpanel">
          {subTab === "aide" && (
            <Ssc32uHelp controllerId={hardware?.servoControllerId ?? null} />
          )}

          {subTab === "journal" && (
            <pre className="electro-log">
              {log.length === 0 ? "Aucune commande envoyée." : log.join("\n")}
            </pre>
          )}

          {subTab === "calibration" && (
            <>
              {/* ── Actions globales ─────────────────────────────────── */}
              <section className="electro-globals">
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
                <span className="electro-hint">
                  Calibration : amenez le servo à <strong>0°</strong>, puis ajustez l'offset −/+
                  jusqu'à l'alignement mécanique. Enregistrement automatique.
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
                    <span className="electro-angle">{angle.toFixed(0)}°</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!connected || binding.channel == null}
                      onClick={() => void centerServo(s.id)}
                      title="Envoyer le zéro logique"
                    >
                      Centrer
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
                  </div>

                  <div className="electro-servo-cal">
                    <span className="electro-cal-label">Offset 0&nbsp;:</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        patchBinding(s.id, { centerOffsetDeg: binding.centerOffsetDeg - 0.5 });
                        if (connected && binding.channel != null) void sendServoAngle(s.id, 0);
                      }}
                    >
                      −
                    </button>
                    <span className="electro-cal-val">{binding.centerOffsetDeg.toFixed(1)}°</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        patchBinding(s.id, { centerOffsetDeg: binding.centerOffsetDeg + 0.5 });
                        if (connected && binding.channel != null) void sendServoAngle(s.id, 0);
                      }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm electro-cal-reset"
                      onClick={() => patchBinding(s.id, { centerOffsetDeg: 0 })}
                      title="Remettre l'offset à 0"
                    >
                      RAZ
                    </button>
                  </div>
                </div>
              );
            })}
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
