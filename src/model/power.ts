// Configuration de l'alimentation électrique du robot (niveau projet).
//
// Décrit les sources de puissance branchées sur les deux consommateurs majeurs :
//  - le contrôleur de servos (rail VS de puissance, + logique VL/« SL »)
//  - la carte de commande (microcontrôleur / SBC)
//
// On distingue le cas où la logique du contrôleur partage le rail des servos
// (cavalier VS=VL sur SSC-32U) de celui où elle est alimentée séparément.

/** Nature de la source : batterie(s), alimentation de bureau (secteur) ou port USB. */
export type PowerSourceKind = "battery" | "bench" | "usb";

/** Une alimentation branchée sur un consommateur (batterie ou alim externe). */
export interface PowerRail {
  /** Alimentation présente / branchée. */
  enabled: boolean;
  /** Type de source : batterie(s) ou alimentation de bureau. */
  kind: PowerSourceKind;
  /** Libellé libre de la source (ex. « LiPo 2S », « Ni-MH 7.2 V », « Alim labo »). */
  source: string;
  /** Tension nominale (V), null si non renseignée. */
  voltageV: number | null;
  /** Capacité (mAh) — pertinent pour une batterie ; null sinon. */
  capacityMah: number | null;
  /** Intensité maximale (A) — pertinent pour une alimentation de bureau ; null sinon. */
  maxCurrentA: number | null;
}

export interface ProjectPower {
  /** Alimentation de puissance vers le contrôleur de servos (rail VS). */
  servo: PowerRail;
  /**
   * Vrai si la logique du contrôleur (VL / « SL ») est alimentée par le même rail
   * que les servos (cavalier VS=VL sur SSC-32U). Faux : logique alimentée à part
   * (USB ou source dédiée).
   */
  servoLogicShared: boolean;
  /** Alimentation de la carte de commande. */
  command: PowerRail;
}

export function defaultPowerRail(): PowerRail {
  return { enabled: false, kind: "battery", source: "", voltageV: null, capacityMah: null, maxCurrentA: null };
}

export function defaultPower(): ProjectPower {
  return { servo: defaultPowerRail(), servoLogicShared: false, command: defaultPowerRail() };
}

function normRail(raw: Partial<PowerRail> | undefined | null): PowerRail {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    enabled: !!raw?.enabled,
    kind: raw?.kind === "bench" ? "bench" : raw?.kind === "usb" ? "usb" : "battery",
    source: typeof raw?.source === "string" ? raw.source : "",
    voltageV: num(raw?.voltageV),
    capacityMah: num(raw?.capacityMah),
    maxCurrentA: num(raw?.maxCurrentA),
  };
}

export function normalizePower(raw: Partial<ProjectPower> | undefined | null): ProjectPower {
  return {
    servo: normRail(raw?.servo),
    servoLogicShared: !!raw?.servoLogicShared,
    command: normRail(raw?.command),
  };
}
