// Configuration électronique du robot (niveau projet).
//
// Décrit comment piloter physiquement les 18 servomoteurs via la carte de
// contrôle définie dans le projet :
//  - liaison servo logique (0-17) ↔ canal physique de la carte
//  - offset de centre (position « 0 » mécanique au montage)
//  - inversion éventuelle du sens de rotation
//
// La connexion (port USB) elle-même est éphémère et gérée au runtime par
// useSerialStore — on ne persiste que les réglages reproductibles.

import { SERVOS } from "./hexapod";
import { clampAngle } from "./servo";
import { findServoType, type ServoSpec } from "./servoTypes";
import { findServoController, type ServoControllerSpec } from "./servoControllers";

export const SERVO_COUNT = SERVOS.length; // 18

/** Liaison d'un servo logique vers un canal physique + calibration mécanique. */
export interface ServoBinding {
  /** Canal physique sur la carte de commande (null = non câblé). */
  channel: number | null;
  /** Offset appliqué pour que l'angle « 0 » logiciel = position mécanique de référence. */
  centerOffsetDeg: number;
  /** Inverse le sens de rotation (palonnier monté à l'envers / côté miroir). */
  invert: boolean;
  /**
   * Butée logicielle min (deg, côté commande). `null` = pas de limite définie,
   * on retombe sur la plage du modèle (`ServoDef.minDeg`). Réglée via l'assistant
   * de calibration pour borner la course réelle du servo sur le robot.
   */
  minDeg: number | null;
  /** Butée logicielle max (deg, côté commande). `null` = plage du modèle. */
  maxDeg: number | null;
}

export interface SerialConnectionConfig {
  /** Vitesse de la liaison série (bauds). */
  baudRate: number;
}

export interface ProjectElectronics {
  serial: SerialConnectionConfig;
  /** Liaisons indexées par id de servo logique (0-17). */
  bindings: Record<number, ServoBinding>;
}

export const DEFAULT_BAUD_RATE = 115200;

export const COMMON_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 250000];

export function defaultBinding(servoId: number): ServoBinding {
  // Par défaut : canal = id du servo (mappage 1:1), sans offset, sans inversion,
  // sans butées personnalisées (plage du modèle).
  return { channel: servoId, centerOffsetDeg: 0, invert: false, minDeg: null, maxDeg: null };
}

export function defaultElectronics(): ProjectElectronics {
  const bindings: Record<number, ServoBinding> = {};
  for (let id = 0; id < SERVO_COUNT; id++) bindings[id] = defaultBinding(id);
  return { serial: { baudRate: DEFAULT_BAUD_RATE }, bindings };
}

/** Normalise une config électronique brute (issue du backend) — garantit 18 liaisons valides. */
export function normalizeElectronics(
  raw: Partial<ProjectElectronics> | undefined | null
): ProjectElectronics {
  const base = defaultElectronics();
  if (!raw) return base;
  const bindings: Record<number, ServoBinding> = {};
  for (let id = 0; id < SERVO_COUNT; id++) {
    const r = raw.bindings?.[id];
    bindings[id] = {
      channel:
        r && typeof r.channel === "number" && Number.isFinite(r.channel) ? r.channel : null,
      centerOffsetDeg:
        r && typeof r.centerOffsetDeg === "number" && Number.isFinite(r.centerOffsetDeg)
          ? r.centerOffsetDeg
          : 0,
      invert: !!r?.invert,
      minDeg:
        r && typeof r.minDeg === "number" && Number.isFinite(r.minDeg) ? r.minDeg : null,
      maxDeg:
        r && typeof r.maxDeg === "number" && Number.isFinite(r.maxDeg) ? r.maxDeg : null,
    };
  }
  return {
    serial: {
      baudRate:
        typeof raw.serial?.baudRate === "number" && raw.serial.baudRate > 0
          ? raw.serial.baudRate
          : DEFAULT_BAUD_RATE,
    },
    bindings,
  };
}

// ── Conversion angle → impulsion (µs) ────────────────────────────────────────

const DEFAULT_PULSE = { min: 500, center: 1500, max: 2500 };

/**
 * Convertit un angle logique (deg, plage modèle ±90°) en largeur d'impulsion (µs)
 * pour un servo donné, en appliquant calibration (offset/inversion) puis en
 * bornant à la plage du servo ∩ celle du contrôleur.
 */
export function angleToPulseUs(
  logicalDeg: number,
  binding: Pick<ServoBinding, "centerOffsetDeg" | "invert">,
  servo: ServoSpec | null,
  controller: ServoControllerSpec | null
): number {
  const effDeg = (binding.invert ? -logicalDeg : logicalDeg) + binding.centerOffsetDeg;

  const pulse = servo?.pulseUs ?? DEFAULT_PULSE;
  const center = pulse.center;
  // Demi-amplitude µs correspondant à 90° (servo standard ±90° → min..max).
  const halfSpan = (pulse.max - pulse.min) / 2;
  let us = center + (effDeg / 90) * halfSpan;

  // Borne : intersection plage servo / plage contrôleur.
  const lo = Math.max(pulse.min, controller?.pulseUs.min ?? pulse.min);
  const hi = Math.min(pulse.max, controller?.pulseUs.max ?? pulse.max);
  us = clampAngle(us, lo, hi);
  return Math.round(us);
}

/**
 * Conversion inverse : largeur d'impulsion (µs) → angle logique (deg, repère
 * servo), en défaisant calibration (offset/inversion). Réciproque exacte de
 * `angleToPulseUs` (au clamp et à l'arrondi près). Sert à « importer la pose du
 * robot » via le retour `QP` du SSC-32U et à vérifier la calibration.
 */
export function pulseUsToAngle(
  pulseUs: number,
  binding: Pick<ServoBinding, "centerOffsetDeg" | "invert">,
  servo: ServoSpec | null
): number {
  const pulse = servo?.pulseUs ?? DEFAULT_PULSE;
  const halfSpan = (pulse.max - pulse.min) / 2;
  if (halfSpan <= 0) return 0;
  const effDeg = ((pulseUs - pulse.center) / halfSpan) * 90;
  const logical = effDeg - binding.centerOffsetDeg;
  return binding.invert ? -logical : logical;
}

/**
 * Borne un angle de commande (deg, repère servo) aux **butées calibrées** du servo
 * (`minDeg`/`maxDeg`), avec repli sur la plage du modèle (±90°) si non définies.
 * À appliquer AVANT l'envoi d'une pose (Conception 3D / miroir live / séquence)
 * pour ne jamais forcer un servo au-delà de sa course réglée. NB : ne pas
 * l'appliquer au jog de calibration (sinon impossible de repousser une butée).
 */
export function clampToServoLimits(
  deg: number,
  binding: Pick<ServoBinding, "minDeg" | "maxDeg">,
  servoId: number
): number {
  const def = SERVOS[servoId];
  const lo = binding.minDeg ?? def?.minDeg ?? -90;
  const hi = binding.maxDeg ?? def?.maxDeg ?? 90;
  return Math.max(lo, Math.min(hi, deg));
}

/** Résout les specs servo/contrôleur depuis les ids matériel du projet. */
export function resolveHardwareSpecs(hardware: {
  servoTypeId: string | null;
  servoControllerId: string | null;
  customServoTypes?: ServoSpec[];
}): { servo: ServoSpec | null; controller: ServoControllerSpec | null } {
  return {
    servo: findServoType(hardware.servoTypeId, hardware.customServoTypes ?? []),
    controller: hardware.servoControllerId
      ? findServoController(hardware.servoControllerId) ?? null
      : null,
  };
}

// ── Protocoles série ─────────────────────────────────────────────────────────
//
// Abstraction minimale : chaque protocole sait formater un ordre de position et
// un relâchement (couple off). Ajouter un driver = ajouter une entrée ici.

export interface SerialProtocol {
  id: string;
  label: string;
  /** Ordre de position : canal → impulsion µs (timeMs = durée de transition). */
  move(channel: number, pulseUs: number, timeMs?: number): string;
  /**
   * Ordre de position GROUPÉ : plusieurs canaux en une seule commande. Sur le
   * SSC-32U, tous les servos démarrent/arrivent ensemble (un seul `T`) — idéal
   * pour le miroir live (un seul write au lieu de 18). `timeMs` = transition.
   */
  moveGroup(channels: { ch: number; us: number }[], timeMs?: number): string;
  /** Relâchement d'un canal (impulsion nulle = couple coupé sur SSC-32U / firmwares compatibles). */
  release(channel: number): string;
  /**
   * Requête « mouvement en cours ? » — la carte répond `+` (en cours) ou `.`
   * (terminé). Optionnel : seuls certains contrôleurs (SSC-32U) le gèrent.
   */
  queryMove?(): string;
  /**
   * Requête de largeur d'impulsion d'un canal — la carte répond 1 octet = µs/10.
   * Optionnel (SSC-32U). Permet de relire la position commandée d'un servo.
   */
  queryPulse?(channel: number): string;
  /** Arrêt d'un canal à sa position courante (sans couper le couple). Optionnel. */
  stop?(channel: number): string;
}

/** Lynxmotion SSC-32U — commandes ASCII `#<ch> P<us> T<ms>\r`. */
export const SSC32U_PROTOCOL: SerialProtocol = {
  id: "ssc32u",
  label: "SSC-32U (ASCII)",
  move: (ch, us, t = 0) => `#${ch} P${us}${t > 0 ? ` T${t}` : ""}\r`,
  // Une seule ligne `#0 P.. #1 P.. … T<ms>\r` : mouvement synchronisé.
  moveGroup: (channels, t = 0) =>
    channels.map((c) => `#${c.ch} P${c.us}`).join(" ") + (t > 0 ? ` T${t}` : "") + "\r",
  release: (ch) => `#${ch} P0\r`,
  queryMove: () => "Q\r",
  queryPulse: (ch) => `QP ${ch}\r`,
  stop: (ch) => `STOP${ch}\r`,
};

/**
 * Protocole générique ligne-par-ligne pour firmware Arduino/ESP custom
 * (ex. carte + PCA9685). Une commande par ligne, terminée par '\n'.
 *   `#<ch>P<us>` → position ; `#<ch>P0` → relâche.
 */
export const GENERIC_ASCII_PROTOCOL: SerialProtocol = {
  id: "generic-ascii",
  label: "Générique ASCII (firmware custom)",
  move: (ch, us) => `#${ch}P${us}\n`,
  // Firmware ligne-par-ligne : on concatène les lignes en un seul write.
  moveGroup: (channels) => channels.map((c) => `#${c.ch}P${c.us}`).join("\n") + "\n",
  release: (ch) => `#${ch}P0\n`,
};

export function protocolForController(controllerId: string | null | undefined): SerialProtocol {
  switch (controllerId) {
    case "lynxmotion-ssc-32u":
      return SSC32U_PROTOCOL;
    default:
      return GENERIC_ASCII_PROTOCOL;
  }
}
