// Bilan d'alimentation : confronte les sources de puissance renseignées aux
// besoins estimés des consommateurs (servos via le contrôleur, carte de commande).
//
// Les courants servo réels dépendent fortement de la charge mécanique et ne sont
// pas connus précisément : on raisonne en fractions du courant de calage (stall)
// fourni par la fiche servo, sous des hypothèses explicites (cf. coefficients).
// L'objectif est un ORDRE DE GRANDEUR pour dire « ça suffit / c'est juste / c'est
// insuffisant / c'est large », pas une mesure.

import type { ServoSpec } from "./servoTypes";
import type { ServoControllerSpec } from "./servoControllers";
import type { CommandElectronicsSpec } from "./commandElectronics";
import type { PowerRail } from "./power";

export type Verdict = "ok" | "tight" | "warn" | "insufficient" | "oversized" | "unknown" | "info";

export interface BudgetLine {
  label: string;
  value: string;
  verdict: Verdict;
}

export interface RailBudget {
  headline: BudgetLine;
  lines: BudgetLine[];
}

// Fractions du courant de calage (stall) par servo, moyennées sur l'ensemble :
//  - maintien : les servos tiennent la pose sous le poids du châssis ;
//  - marche   : déplacement lent (ce que produit l'app), charge modérée ;
//  - pic      : accélération/démarrage quasi simultané de tous les servos.
export const HOLD_FRACTION = 0.15;
export const WALK_FRACTION = 0.35;
export const PEAK_FRACTION = 0.6;

const fmtA = (a: number) => `${a.toFixed(a < 10 ? 1 : 0)} A`;
const fmtMin = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} min` : `${Math.round(min)} min`;

/** Verdict d'une demande (A) face à une source (A) : marge confortable → insuffisant. */
function ratioVerdict(needA: number, supplyA: number): Verdict {
  if (supplyA <= 0) return "unknown";
  const r = supplyA / needA;
  if (r >= 1.3) return "oversized";
  if (r >= 1.05) return "ok";
  if (r >= 0.9) return "tight";
  return "insufficient";
}

/** Plage de tension servo admissible = intersection fiche servo ∩ rail VS du contrôleur. */
function servoVoltageWindow(
  servo: ServoSpec | null,
  controller: ServoControllerSpec | null
): [number, number] | null {
  const mins: number[] = [];
  const maxs: number[] = [];
  if (servo) {
    mins.push(servo.voltageRange[0]);
    maxs.push(servo.voltageRange[1]);
  }
  if (controller?.voltageServoV) {
    mins.push(controller.voltageServoV[0]);
    maxs.push(controller.voltageServoV[1]);
  }
  if (mins.length === 0) return null;
  return [Math.max(...mins), Math.min(...maxs)];
}

function voltageLine(v: number | null, window: [number, number] | null): BudgetLine | null {
  if (window === null) return null;
  const [lo, hi] = window;
  const range = `${lo}–${hi} V`;
  if (v === null) {
    return { label: "Tension", value: `à renseigner (plage ${range})`, verdict: "unknown" };
  }
  if (v > hi + 0.05) {
    return { label: "Tension", value: `${v} V > ${hi} V — surtension, risque servo`, verdict: "warn" };
  }
  if (v < lo - 0.05) {
    return { label: "Tension", value: `${v} V < ${lo} V — sous-alimenté (couple réduit)`, verdict: "warn" };
  }
  return { label: "Tension", value: `${v} V dans la plage ${range}`, verdict: "ok" };
}

/** Bilan du rail de puissance servos (contrôleur). */
export function assessServoRail(args: {
  rail: PowerRail;
  servo: ServoSpec | null;
  controller: ServoControllerSpec | null;
  nServos: number;
}): RailBudget {
  const { rail, servo, controller, nServos } = args;
  const window = servoVoltageWindow(servo, controller);
  const vLine = voltageLine(rail.voltageV, window);
  const lines: BudgetLine[] = [];

  if (!rail.enabled) {
    return {
      headline: { label: "État", value: "Alimentation non branchée", verdict: "unknown" },
      lines: vLine ? [vLine] : [],
    };
  }
  if (!servo) {
    return {
      headline: {
        label: "Besoins",
        value: "Type de servo non défini (Projet → Matériel)",
        verdict: "unknown",
      },
      lines: vLine ? [vLine] : [],
    };
  }

  const stallA = servo.currentMa.stall / 1000;
  const holdA = Math.max((servo.currentMa.idle / 1000) * nServos, nServos * stallA * HOLD_FRACTION);
  const walkA = nServos * stallA * WALK_FRACTION;
  const peakA = nServos * stallA * PEAK_FRACTION;
  const ceilA = nServos * stallA;

  const supplyA = rail.kind === "bench" ? rail.maxCurrentA : null;

  // Lignes de besoin (avec verdict relatif à la source pour une alim de bureau).
  const needLine = (label: string, needA: number): BudgetLine => ({
    label,
    value: supplyA != null ? `≈ ${fmtA(needA)}` : `≈ ${fmtA(needA)} (estimé)`,
    verdict: supplyA != null ? ratioVerdict(needA, supplyA) : "unknown",
  });
  lines.push(needLine(`Maintien (pose tenue, ${nServos} servos)`, holdA));
  lines.push(needLine("Marche (déplacement lent)", walkA));
  lines.push(needLine("Pic (démarrage simultané)", peakA));

  if (vLine) lines.push(vLine);

  // ── Alimentation de bureau : comparaison directe en ampères ────────────────
  if (rail.kind === "bench") {
    if (supplyA == null || supplyA <= 0) {
      return {
        headline: { label: "Capacité", value: "Renseignez l'intensité max (A)", verdict: "unknown" },
        lines,
      };
    }
    let headline: BudgetLine;
    if (supplyA < holdA) {
      headline = { label: "Verdict", value: `${fmtA(supplyA)} insuffisant même à l'arrêt`, verdict: "insufficient" };
    } else if (supplyA < walkA) {
      headline = { label: "Verdict", value: `${fmtA(supplyA)} : tient à l'arrêt, insuffisant en marche`, verdict: "warn" };
    } else if (supplyA < peakA) {
      headline = {
        label: "Verdict",
        value: `${fmtA(supplyA)} : OK en marche, risque de chute au pic`,
        verdict: "tight",
      };
    } else if (supplyA < peakA * 1.3) {
      headline = { label: "Verdict", value: `${fmtA(supplyA)} couvre les pics`, verdict: "ok" };
    } else {
      headline = {
        label: "Verdict",
        value: `${fmtA(supplyA)} : marge large (≥ pic ×1,3)`,
        verdict: "oversized",
      };
    }
    lines.push({
      label: "Pic théorique max",
      value: `${fmtA(ceilA)} (tous calés — improbable)`,
      verdict: "info",
    });
    return { headline, lines };
  }

  // ── Batterie : autonomie + taux de décharge requis ─────────────────────────
  if (rail.capacityMah == null || rail.capacityMah <= 0) {
    return {
      headline: { label: "Capacité", value: "Renseignez la capacité (mAh) pour l'autonomie", verdict: "unknown" },
      lines,
    };
  }
  const capAh = rail.capacityMah / 1000;
  const runtimeWalkMin = (capAh / walkA) * 60;
  const runtimeHoldMin = (capAh / holdA) * 60;
  const cPeak = peakA / capAh; // taux de décharge requis au pic (en « C »)

  lines.push({
    label: "Autonomie (marche)",
    value: `≈ ${fmtMin(runtimeWalkMin)} · à l'arrêt ≈ ${fmtMin(runtimeHoldMin)}`,
    verdict: "ok",
  });
  const cVerdict: Verdict = cPeak > 15 ? "warn" : cPeak > 8 ? "tight" : "ok";
  lines.push({
    label: "Décharge requise au pic",
    value: `≈ ${cPeak.toFixed(0)} C (pack à débit ≥ ${cPeak.toFixed(0)} C)`,
    verdict: cVerdict,
  });

  const headline: BudgetLine =
    cVerdict === "warn"
      ? {
          label: "Verdict",
          value: `Autonomie OK, mais ${cPeak.toFixed(0)} C exigés au pic — vérifiez le C-rating`,
          verdict: "warn",
        }
      : {
          label: "Verdict",
          value: `Autonomie ≈ ${fmtMin(runtimeWalkMin)} en marche`,
          verdict: cVerdict === "tight" ? "tight" : "ok",
        };
  return { headline, lines };
}

/** Bilan du rail de la carte de commande. */
export function assessCommandRail(args: {
  rail: PowerRail;
  board: CommandElectronicsSpec | null;
}): RailBudget {
  const { rail, board } = args;
  const lines: BudgetLine[] = [];
  if (!board) {
    return { headline: { label: "État", value: "Carte non définie", verdict: "unknown" }, lines };
  }
  const activeA = board.currentMa.active / 1000;
  const idleA = board.currentMa.idle / 1000;
  lines.push({ label: "Conso active", value: `≈ ${(board.currentMa.active).toFixed(0)} mA`, verdict: "ok" });

  // Tension : indicative (beaucoup de cartes régulent via VIN sur une plage).
  if (rail.voltageV != null) {
    const v = rail.voltageV;
    const warn = v < board.voltageV - 0.3;
    lines.push({
      label: "Tension",
      value: warn
        ? `${v} V < ${board.voltageV} V logique — prévoir un régulateur/boost`
        : `${v} V (logique ${board.voltageV} V, souvent via régulateur VIN)`,
      verdict: warn ? "warn" : "ok",
    });
  }

  if (!rail.enabled) {
    return { headline: { label: "État", value: "Alimentation non branchée", verdict: "unknown" }, lines };
  }

  // Sources limitées en courant : alim de bureau ou port USB.
  if (rail.kind === "bench" || rail.kind === "usb") {
    const supplyA = rail.maxCurrentA ?? (rail.kind === "usb" ? 0.5 : null);
    if (supplyA == null || supplyA <= 0) {
      return { headline: { label: "Capacité", value: "Renseignez l'intensité max (A)", verdict: "unknown" }, lines };
    }
    const ok = supplyA >= activeA;
    const src = rail.kind === "usb" ? "USB" : "Alim";
    return {
      headline: {
        label: "Verdict",
        value: ok
          ? `${src} ${fmtA(supplyA)} : suffisant (conso ≈ ${board.currentMa.active} mA)`
          : `${src} ${fmtA(supplyA)} insuffisant pour ${board.currentMa.active} mA`,
        verdict: ok ? (rail.kind === "usb" ? "ok" : "oversized") : "insufficient",
      },
      lines,
    };
  }

  // Batterie
  if (rail.capacityMah == null || rail.capacityMah <= 0) {
    return { headline: { label: "Capacité", value: "Renseignez la capacité (mAh)", verdict: "unknown" }, lines };
  }
  const capAh = rail.capacityMah / 1000;
  const runtimeMin = (capAh / activeA) * 60;
  const runtimeIdleMin = (capAh / Math.max(idleA, 0.001)) * 60;
  lines.push({
    label: "Autonomie",
    value: `≈ ${fmtMin(runtimeMin)} en charge · ${fmtMin(runtimeIdleMin)} au repos`,
    verdict: "ok",
  });
  return {
    headline: { label: "Verdict", value: `Autonomie ≈ ${fmtMin(runtimeMin)}`, verdict: "ok" },
    lines,
  };
}

// ── Conseils d'architecture électrique & composants ──────────────────────────

export type AdviceSeverity = "danger" | "warn" | "tip" | "ok";

export interface Advice {
  severity: AdviceSeverity;
  title: string;
  detail: string;
}

/** Arrondit au calibre de fusible standard supérieur (séries courantes). */
function fuseRating(a: number): number {
  const std = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50];
  return std.find((s) => s >= a) ?? Math.ceil(a / 10) * 10;
}

/**
 * Produit des recommandations contextuelles sur l'architecture électrique et les
 * composants à ajouter pour équilibrer besoins ↔ dangers (chutes de tension,
 * surintensité, redémarrages logiques, surtension, câblage).
 */
export function buildPowerAdvice(args: {
  servoRail: PowerRail;
  commandRail: PowerRail;
  servoLogicShared: boolean;
  commandActive: boolean;
  servo: ServoSpec | null;
  board: CommandElectronicsSpec | null;
  nServos: number;
}): Advice[] {
  const { servoRail, commandRail, servoLogicShared, commandActive, servo, board, nServos } = args;
  const out: Advice[] = [];

  const stallA = servo ? servo.currentMa.stall / 1000 : null;
  const peakA = stallA != null ? nServos * stallA * PEAK_FRACTION : null;
  const vServo = servoRail.voltageV;

  // 1) Schéma d'architecture recommandé (toujours, en tête).
  out.push({
    severity: "tip",
    title: "Schéma d'alimentation recommandé",
    detail:
      "Source → interrupteur général → fusible → barre de distribution VS → contrôleur (gros condensateur au plus près). " +
      "Dériver la logique (carte de commande / VL) via un régulateur dédié, pas directement sur le rail servos.",
  });

  // 2) Condensateur de découplage (anti-brownout / pics).
  if (servoRail.enabled) {
    const capV = vServo != null ? Math.max(16, Math.ceil((vServo * 2) / 5) * 5) : 16;
    out.push({
      severity: "tip",
      title: "Condensateur de réservoir sur VS",
      detail:
        `Ajoutez un condensateur électrolytique 2200–4700 µF / ≥ ${capV} V entre VS et GND, au plus près du contrôleur. ` +
        "Il absorbe les appels de courant au démarrage des servos et limite les chutes de tension (cause de tremblements/resets).",
    });
  }

  // 3) Protection surintensité (fusible).
  if (peakA != null) {
    const f = fuseRating(peakA);
    out.push({
      severity: "tip",
      title: "Protection contre les surintensités",
      detail:
        `Insérez un fusible (ou disjoncteur réarmable) sur le rail VS, calibre ≈ ${f} A (au-dessus du pic estimé ${fmtA(
          peakA
        )}). ` + "Protège batterie et câblage en cas de calage prolongé ou de court-circuit.",
    });
  }

  // 4) Logique vs puissance : séparation.
  if (servoLogicShared) {
    out.push({
      severity: "warn",
      title: "Logique alimentée par le rail servos (VS=VL)",
      detail:
        "Les chutes de tension dues aux servos se répercutent sur la logique du contrôleur → risques de resets et de tremblements. " +
        "Préférez alimenter la logique séparément (USB, ou régulateur dédié), ou n'utilisez le cavalier VS=VL qu'avec une alim très stable + condensateur.",
    });
  } else {
    out.push({
      severity: "ok",
      title: "Logique et puissance séparées",
      detail: "Bonne pratique : la logique reste stable même quand le rail servos chute sous charge.",
    });
  }

  // 5) Régulation pour la carte de commande (BEC / DC-DC).
  if (commandActive && board) {
    const sharedSource = !commandRail.enabled && servoRail.enabled; // carte tirée du rail servos
    if ((vServo != null && vServo > board.voltageV + 0.3) || sharedSource) {
      out.push({
        severity: "tip",
        title: `Régulateur ${board.voltageV} V pour la carte de commande`,
        detail:
          `La logique de la ${board.model} fonctionne en ${board.voltageV} V. Pour la dériver d'une source ${
            vServo != null ? `${vServo} V` : "supérieure"
          }, ` +
          `utilisez un BEC/convertisseur abaisseur (UBEC ${board.voltageV} V, ≥ 3 A). N'alimentez jamais la logique en direct sur VS.`,
      });
    }
  }

  // 6) Surtension servos.
  if (servo && vServo != null && vServo > servo.voltageRange[1] + 0.05) {
    out.push({
      severity: "danger",
      title: "Surtension servos",
      detail:
        `${vServo} V dépasse le maximum admissible des ${servo.model} (${servo.voltageRange[1]} V). ` +
        "Réduisez la tension (moins de cellules) ou ajoutez un régulateur abaisseur sur VS, sous peine d'endommager les servos.",
    });
  }

  // 7) Câblage / distribution pour 18 servos.
  if (peakA != null && peakA >= 5) {
    out.push({
      severity: "warn",
      title: "Câblage de puissance & distribution",
      detail:
        `Au pic (~${fmtA(
          peakA
        )}), prévoyez des fils d'alim épais et courts, une masse commune solide et une barre/PCB de distribution : ` +
        "les pistes d'un contrôleur ne sont pas dimensionnées pour alimenter 18 servos à pleine charge à travers la carte.",
    });
  }

  // 8) Batterie : exigence de débit (C-rating).
  if (servoRail.enabled && servoRail.kind === "battery" && servoRail.capacityMah && peakA != null) {
    const cPeak = peakA / (servoRail.capacityMah / 1000);
    if (cPeak > 8) {
      out.push({
        severity: "warn",
        title: "Débit batterie au pic élevé",
        detail:
          `Le pic exige ≈ ${cPeak.toFixed(0)} C de votre pack. Choisissez une batterie à fort C-rating (LiPo) ` +
          "ou augmentez la capacité ; un pack à résistance interne élevée (Ni-MH usé) s'effondrera et fera trembler les servos.",
      });
    }
  }

  // 9) Coupure & protection inverse.
  out.push({
    severity: "tip",
    title: "Interrupteur général & anti-inversion",
    detail:
      "Un interrupteur de puissance et une protection contre l'inversion de polarité (diode/MOSFET) évitent les manipulations dangereuses et les destructions à la connexion.",
  });

  return out;
}
