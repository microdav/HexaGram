// Sous-onglet « Architecture » : vue 2D du matériel électronique défini dans
// le projet (carte de commande → contrôleur de servos → servomoteurs), avec
// une zone extensible pour les futurs capteurs / périphériques.
//
// Lecture seule pour l'instant : reflète hardware (useProjectStore). Les blocs
// « à venir » sont des emplacements désactivés, prêts à être activés quand le
// modèle gérera capteurs et périphériques.

import { useMemo } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { SERVOS, LEG_NAMES } from "../model/hexapod";
import { findServoController } from "../model/servoControllers";
import { findCommandElectronics } from "../model/commandElectronics";
import { findServoType } from "../model/servoTypes";
import { BoardSvg } from "./BoardSvg";

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

const FUTURE_ITEMS: Array<{ icon: string; label: string }> = [
  { icon: "🧭", label: "Boussole / IMU" },
  { icon: "📐", label: "Accéléromètre" },
  { icon: "📡", label: "Sonar / IR" },
  { icon: "🖥️", label: "Écran" },
  { icon: "💡", label: "LED" },
  { icon: "▦", label: "Matrice de LEDs" },
];

export function ElectroArchitecture() {
  const activeProject = useProjectStore((s) => s.activeProject);
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

  if (!hardware) return null;

  const nothingDefined = !board && !controller;

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
        {/* Carte de commande */}
        <div className={`arch-node${board ? "" : " arch-node--empty"}`}>
          <div className="arch-node-role">Carte de commande</div>
          {board ? (
            <>
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
            </>
          ) : (
            <div className="arch-node-placeholder">non défini</div>
          )}
        </div>

        {/* Lien commande → contrôleur */}
        <div className="arch-link">
          <span className="arch-link-label">{cmdToCtrl ?? "—"}</span>
          <div className="arch-link-line" />
          <span className="arch-link-arrow">▸</span>
        </div>

        {/* Contrôleur de servos */}
        <div className={`arch-node${controller ? "" : " arch-node--empty"}`}>
          <div className="arch-node-role">Contrôleur de servos</div>
          {controller ? (
            <>
              <BoardSvg
                brand={controller.brand}
                model={controller.model}
                dimensionsMm={controller.dimensionsMm}
                interfaces={controller.interfaces}
                channels={controller.channels}
                width={150}
              />
              <div className="arch-node-name">{controller.brand} {controller.model}</div>
              <div className="arch-node-meta">{controller.channels} canaux · {controller.pulseUs.min}–{controller.pulseUs.max} µs</div>
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

      {/* ── Alimentation (rappel) ──────────────────────────────────────── */}
      {controller && (
        <div className="arch-power">
          <span className="arch-power-icon">⚡</span>
          Alimentation servos : entrée <strong>VS</strong> du {controller.model}
          {controller.voltageServoV
            ? ` (${controller.voltageServoV[0]}–${controller.voltageServoV[1]} V)`
            : ""}{" "}
          — séparée de l'USB (logique uniquement).
        </div>
      )}

      {/* ── Extension future : capteurs & périphériques ────────────────── */}
      <div className="arch-future">
        <div className="arch-future-title">Capteurs &amp; périphériques <span className="arch-soon">à venir</span></div>
        <div className="arch-future-grid">
          {FUTURE_ITEMS.map((it) => (
            <div className="arch-future-chip" key={it.label}>
              <span className="arch-future-icon" aria-hidden="true">{it.icon}</span>
              <span>{it.label}</span>
            </div>
          ))}
        </div>
        <p className="arch-future-note">
          Ces modules pourront être ajoutés à l'architecture et reliés à la carte de commande
          (I2C, SPI, GPIO…) dans une prochaine version.
        </p>
      </div>
    </div>
  );
}
