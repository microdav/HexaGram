// Génération du script série d'une séquence pour la carte de contrôle des servos.
//
// À partir des images d'une séquence (étapes définies + interpolées) et de la
// configuration électronique du projet, produit un script lisible : une ligne de
// commande par image, groupant tous les canaux câblés.
//
//   SSC-32U : `#<ch> P<us> #<ch> P<us> … T<ms>` (déplacement coordonné, durée T)
//   Générique : `#<ch>P<us> #<ch>P<us> …`        (firmware custom, sans durée)
//
// Le terminateur de ligne (\r pour SSC-32U, \n sinon) n'est PAS inclus ici : la
// zone de code l'affiche sans caractère parasite, et l'envoi l'ajoute au moment
// d'écrire chaque ligne.

import { SERVO_COUNT, angleToPulseUs, type ServoBinding } from "./electronics";
import type { ServoSpec } from "./servoTypes";
import type { ServoControllerSpec } from "./servoControllers";

/** Image minimale exploitée par le générateur (compatible SequencerStep). */
export interface ScriptStep {
  name: string;
  type?: "defined" | "interpolated";
  pose: number[];
}

export interface ScriptOptions {
  /** Durée T (ms) appliquée à chaque déplacement (0 = pas de T). */
  moveTimeMs: number;
  /** Insère des lignes de commentaire (`;`) repérant les étapes définies. */
  comments: boolean;
  /** Nom de la séquence (entête de commentaire). */
  sequenceName: string;
}

export interface ScriptHardware {
  bindings: Record<number, ServoBinding>;
  servo: ServoSpec | null;
  controller: ServoControllerSpec | null;
  /** Identifiant du protocole série (cf. SerialProtocol.id). */
  protocolId: string;
}

export interface BuiltScript {
  /** Script complet, prêt pour la zone de code (lignes séparées par \n). */
  text: string;
  /** Nombre d'images (lignes de mouvement). */
  frameCount: number;
  /** Nombre de servos câblés (canaux émis par image). */
  channelCount: number;
  /** Durée totale estimée d'exécution (ms) = frameCount × moveTimeMs. */
  totalMs: number;
}

/** Liste triée des servos câblés (canal défini). */
function boundServoIds(bindings: Record<number, ServoBinding>): number[] {
  const ids: number[] = [];
  for (let id = 0; id < SERVO_COUNT; id++) {
    const b = bindings[id];
    if (b && b.channel != null) ids.push(id);
  }
  return ids;
}

/** Construit la commande groupée pour une image (pose = angles logiques par servo). */
function frameCommand(
  pose: number[],
  boundIds: number[],
  hw: ScriptHardware,
  moveTimeMs: number,
  isSsc: boolean
): string {
  const parts = boundIds
    .map((id) => {
      const b = hw.bindings[id];
      const ch = b.channel as number;
      const us = angleToPulseUs(pose[id] ?? 0, b, hw.servo, hw.controller);
      return { ch, us };
    })
    .sort((a, b) => a.ch - b.ch);
  if (parts.length === 0) return "";
  if (isSsc) {
    const moves = parts.map((p) => `#${p.ch} P${p.us}`).join(" ");
    return moveTimeMs > 0 ? `${moves} T${moveTimeMs}` : moves;
  }
  return parts.map((p) => `#${p.ch}P${p.us}`).join(" ");
}

/**
 * Génère le script série d'une séquence. `steps` est la liste d'images déjà
 * préparée par l'appelant (définies seules, ou définies + interpolées).
 */
export function buildSequenceScript(
  steps: readonly ScriptStep[],
  opts: ScriptOptions,
  hw: ScriptHardware
): BuiltScript {
  const isSsc = hw.protocolId === "ssc32u";
  const boundIds = boundServoIds(hw.bindings);
  const lines: string[] = [];

  if (opts.comments) {
    lines.push(`; HexaGram — séquence « ${opts.sequenceName} »`);
    lines.push(
      `; ${steps.length} image(s) · ${boundIds.length} servo(s) câblé(s) · protocole ${
        isSsc ? "SSC-32U" : hw.protocolId
      }`
    );
    if (boundIds.length === 0) {
      lines.push("; ⚠ Aucun servo câblé — définissez les canaux dans « Liaison & calibration ».");
    } else if (isSsc && opts.moveTimeMs > 0) {
      lines.push(`; T${opts.moveTimeMs} = durée de déplacement par image (ms).`);
    }
    lines.push("");
  }

  let definedNo = 0;
  for (const step of steps) {
    const isDefined = !step.type || step.type === "defined";
    if (isDefined) {
      definedNo++;
      if (opts.comments) lines.push(`; ── Étape ${definedNo} : ${step.name} ──`);
    }
    const cmd = frameCommand(step.pose, boundIds, hw, opts.moveTimeMs, isSsc);
    if (cmd) lines.push(cmd);
  }

  return {
    text: lines.join("\n"),
    frameCount: steps.length,
    channelCount: boundIds.length,
    totalMs: steps.length * Math.max(0, opts.moveTimeMs),
  };
}
