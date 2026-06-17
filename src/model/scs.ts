// SCS — « SSC-32 ServoControlleur Séquenceur ».
//
// Logique pure (sans UI ni état) du séquenceur tabulaire : représente le flux de
// commandes RÉELLEMENT envoyé à la carte de contrôle, ligne par ligne. Chaque
// ligne = une trame groupée (`#ch P.. #ch P.. T..`) ; chaque colonne = un servo.
// Une case « envoyé ? » par servo permet de ne commander que les canaux qui
// bougent (groupes natifs SSC-32U), une position (deg, repère servo) et un temps.
//
// Le « temps faisable » d'une ligne est calculé depuis la vitesse servo
// (`speedS60`) et l'amplitude du mouvement : c'est le plancher physique du `T`.
// Contrairement à la lecture 3D (cadence fixe), ceci reflète ce que le robot peut
// réellement exécuter — cf. docs et useProgramRunStore (lecture room).

import { SERVOS, LEG_NAMES } from "./hexapod";
import {
  SERVO_COUNT,
  angleToPulseUs,
  clampToServoLimits,
  defaultBinding,
  protocolForController,
  resolveHardwareSpecs,
  type ServoBinding,
  type ProjectElectronics,
  type SerialProtocol,
} from "./electronics";
import type { ServoSpec } from "./servoTypes";
import type { ServoControllerSpec } from "./servoControllers";

/** Tolérance (deg) en-deçà de laquelle un servo est considéré « inchangé ». */
const CHANGE_EPS = 0.05;
/** Plancher (ms) appliqué aux lignes en `T` automatique (évite un saut instantané). */
export const AUTO_FLOOR_MS = 150;

/** Une ligne du SCS : pour chaque servo, envoyé ? + position (deg) ; `T` de ligne. */
export interface ScsRow {
  id: string;
  name: string;
  /** Indexé par id de servo (0-17) : le canal est-il inclus dans la trame ? */
  send: boolean[];
  /** Position commandée (deg, repère servo) par servo, même si non envoyée. */
  deg: number[];
  /** Durée de la trame (T, ms). `null` = automatique (= temps faisable, plancher). */
  timeMs: number | null;
}

/** Matériel résolu nécessaire pour formater/temporiser les trames. */
export interface ScsHardware {
  bindings: Record<number, ServoBinding>;
  servo: ServoSpec | null;
  controller: ServoControllerSpec | null;
  protocol: SerialProtocol;
}

/** Méta d'une colonne servo (libellé complet + court). */
export interface ScsServoMeta {
  id: number;
  legIndex: number;
  joint: "coxa" | "femur" | "tibia";
  label: string;
  short: string;
}

/** Colonnes du SCS, dans l'ordre des servos (S0…S17), groupées par patte. */
export const SCS_SERVOS: ScsServoMeta[] = SERVOS.map((s) => ({
  id: s.id,
  legIndex: s.legIndex,
  joint: s.joint,
  label: `${LEG_NAMES[s.legIndex]} - ${s.joint} (S${s.id})`,
  short: `S${s.id}`,
}));

/** Résout le matériel SCS depuis le `hardware` du projet (bindings, specs, protocole). */
export function resolveScsHardware(
  hardware:
    | {
        electronics?: ProjectElectronics | null;
        servoTypeId?: string | null;
        servoControllerId?: string | null;
        customServoTypes?: ServoSpec[];
      }
    | null
    | undefined
): ScsHardware {
  const electronics = hardware?.electronics ?? null;
  const bindings: Record<number, ServoBinding> = {};
  for (let id = 0; id < SERVO_COUNT; id++) {
    bindings[id] = electronics?.bindings?.[id] ?? defaultBinding(id);
  }
  const specs = resolveHardwareSpecs({
    servoTypeId: hardware?.servoTypeId ?? null,
    servoControllerId: hardware?.servoControllerId ?? null,
    customServoTypes: hardware?.customServoTypes ?? [],
  });
  return {
    bindings,
    servo: specs.servo,
    controller: specs.controller,
    protocol: protocolForController(hardware?.servoControllerId ?? null),
  };
}

/**
 * Vitesse servo en secondes pour 60° : préfère 7,4 V (cas usuel d'un hexapode),
 * repli 6 V puis 8,4 V, puis défaut prudent (~servo standard) si inconnue.
 */
export function servoSecPer60(servo: ServoSpec | null): number {
  const s = servo?.speedS60;
  const v = s?.v7_4 ?? s?.v6 ?? s?.v8_4;
  return v && v > 0 ? v : 0.18;
}

/**
 * Temps physique minimal (ms) pour exécuter une ligne depuis la pose précédente :
 * le servo le plus sollicité fixe le plancher (`|Δθ| × secPer60 / 60`). Ne tient
 * compte que des servos envoyés (`send`). 0 si aucune vitesse exploitable.
 */
export function feasibleTimeMs(prevDeg: number[], row: ScsRow, secPer60: number): number {
  if (!(secPer60 > 0)) return 0;
  let max = 0;
  for (let id = 0; id < SERVO_COUNT; id++) {
    if (!row.send[id]) continue;
    const delta = Math.abs((row.deg[id] ?? 0) - (prevDeg[id] ?? 0));
    const t = (delta / 60) * secPer60 * 1000;
    if (t > max) max = t;
  }
  return Math.round(max);
}

/** Temps faisable par ligne (ms) pour affichage : ligne 0 = 0 (départ inconnu). */
export function feasibleTimesForRows(rows: ScsRow[], secPer60: number): number[] {
  return rows.map((row, i) => (i === 0 ? 0 : feasibleTimeMs(rows[i - 1].deg, row, secPer60)));
}

/** Durée effective (ms) appliquée à l'envoi : respecte le plancher faisable. */
export function effectiveRowTimeMs(row: ScsRow, feasible: number): number {
  if (row.timeMs != null) return Math.max(row.timeMs, feasible);
  return Math.max(feasible, AUTO_FLOOR_MS);
}

/** Impulsion (µs) d'une cellule pour affichage (infobulle). `null` si non câblé. */
export function scsCellUs(row: ScsRow, servoId: number, hw: ScsHardware): number | null {
  const b = hw.bindings[servoId] ?? defaultBinding(servoId);
  if (b.channel == null) return null;
  return angleToPulseUs(row.deg[servoId] ?? 0, b, hw.servo, hw.controller);
}

/**
 * Construit la trame série (terminateur compris) d'une ligne : seuls les servos
 * cochés ET câblés sont inclus, triés par canal, avec la durée `timeMs`. Renvoie
 * "" si aucun canal à envoyer.
 */
export function rowToCommand(row: ScsRow, hw: ScsHardware, timeMs: number): string {
  const channels: { ch: number; us: number }[] = [];
  for (let id = 0; id < SERVO_COUNT; id++) {
    if (!row.send[id]) continue;
    const b = hw.bindings[id] ?? defaultBinding(id);
    if (b.channel == null) continue;
    channels.push({ ch: b.channel, us: angleToPulseUs(row.deg[id] ?? 0, b, hw.servo, hw.controller) });
  }
  if (channels.length === 0) return "";
  channels.sort((a, b) => a.ch - b.ch);
  return hw.protocol.moveGroup(channels, Math.max(0, Math.round(timeMs)));
}

/**
 * Convertit une liste de keyframes (poses définies aplaties d'un programme) en
 * lignes SCS. Ne coche QUE les servos qui changent par rapport à la ligne
 * précédente ; la 1ʳᵉ ligne envoie la pose complète des canaux câblés. Les
 * positions sont bornées aux butées calibrées.
 */
export function programToScsRows(
  keyframes: { pose: number[]; name: string; id: string }[],
  hw: ScsHardware
): ScsRow[] {
  const rows: ScsRow[] = [];
  let prev: number[] | null = null;
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    const deg = new Array<number>(SERVO_COUNT).fill(0);
    const send = new Array<boolean>(SERVO_COUNT).fill(false);
    for (let id = 0; id < SERVO_COUNT; id++) {
      const b = hw.bindings[id] ?? defaultBinding(id);
      const raw = Number.isFinite(kf.pose[id]) ? kf.pose[id] : 0;
      deg[id] = Math.round(clampToServoLimits(raw, b, id) * 10) / 10;
      if (b.channel == null) continue; // non câblé : jamais envoyé
      send[id] = prev == null ? true : Math.abs(deg[id] - prev[id]) > CHANGE_EPS;
    }
    rows.push({ id: `scs-${i}-${kf.id}`, name: kf.name || `Ligne ${i + 1}`, send, deg, timeMs: null });
    prev = deg;
  }
  return rows;
}

/** Crée une ligne vierge (aucun servo envoyé), copiant les positions fournies. */
export function makeBlankRow(id: string, baseDeg?: number[]): ScsRow {
  return {
    id,
    name: "Nouvelle ligne",
    send: new Array<boolean>(SERVO_COUNT).fill(false),
    deg: baseDeg ? baseDeg.slice() : new Array<number>(SERVO_COUNT).fill(0),
    timeMs: null,
  };
}
