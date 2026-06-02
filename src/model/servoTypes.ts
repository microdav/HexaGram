import { useCatalogStore } from "../store/useCatalogStore";

export interface ServoSpec {
  id: string;
  brand: string;
  model: string;
  torqueKgCm: { v6?: number; v7_4?: number; v8_4?: number };
  speedS60: { v6?: number; v7_4?: number; v8_4?: number };
  voltageRange: [number, number];
  currentMa: { idle: number; stall: number };
  weightG: number;
  dimensionsMm: { l: number; w: number; h: number };
  /** Décalage de l'axe de sortie (pignon) depuis le centre du corps, le long de
   *  la longueur, vers l'extrémité de sortie (mm). Absent ⇒ convention par défaut. */
  shaftOffsetMm?: number;
  /** Diamètre du pignon de sortie (cannelures, mm). Absent ⇒ valeur type. */
  pinionDiamMm?: number;
  pulseUs: { min: number; center: number; max: number };
  deadbandUs: number;
  gearType: "plastic" | "metal" | "titanium";
  bearing: "plain" | "ball" | "dual-ball";
  connector: "JR" | "Futaba" | "Hitec" | "BUS";
  notes?: string;
  custom?: boolean;
}

export const SERVO_CATALOG: ServoSpec[] = [
  {
    id: "rs-475hb",
    brand: "Renegade",
    model: "RS-475HB",
    torqueKgCm: { v6: 10.5, v7_4: 13.0 },
    speedS60: { v6: 0.17, v7_4: 0.14 },
    voltageRange: [5.0, 8.4],
    currentMa: { idle: 5, stall: 2200 },
    weightG: 57,
    dimensionsMm: { l: 40.7, w: 20.1, h: 37.8 },
    shaftOffsetMm: 10.0,
    pinionDiamMm: 6.0,
    pulseUs: { min: 500, center: 1500, max: 2500 },
    deadbandUs: 4,
    gearType: "metal",
    bearing: "dual-ball",
    connector: "JR",
    notes: "Servo haute performance pour hexapodes",
  },
  {
    id: "mg996r",
    brand: "Tower Pro",
    model: "MG996R",
    torqueKgCm: { v6: 9.4, v7_4: 11.0 },
    speedS60: { v6: 0.20, v7_4: 0.17 },
    voltageRange: [4.8, 7.2],
    currentMa: { idle: 10, stall: 2500 },
    weightG: 55,
    dimensionsMm: { l: 40.7, w: 19.7, h: 42.9 },
    shaftOffsetMm: 10.0,
    pinionDiamMm: 6.0,
    pulseUs: { min: 500, center: 1500, max: 2500 },
    deadbandUs: 5,
    gearType: "metal",
    bearing: "plain",
    connector: "JR",
    notes: "Servo économique très répandu en robotique",
  },
  {
    id: "ds3225",
    brand: "DSServo",
    model: "DS3225",
    torqueKgCm: { v6: 22.0, v7_4: 25.5 },
    speedS60: { v6: 0.18, v7_4: 0.15 },
    voltageRange: [4.8, 8.4],
    currentMa: { idle: 8, stall: 2800 },
    weightG: 65,
    dimensionsMm: { l: 40.6, w: 20.2, h: 38.0 },
    shaftOffsetMm: 10.0,
    pinionDiamMm: 6.0,
    pulseUs: { min: 500, center: 1500, max: 2500 },
    deadbandUs: 4,
    gearType: "metal",
    bearing: "dual-ball",
    connector: "JR",
    notes: "Servo métal haute performance, résistant à l'eau",
  },
  {
    id: "hs-485hb",
    brand: "Hitec",
    model: "HS-485HB",
    torqueKgCm: { v6: 4.8 },
    speedS60: { v6: 0.22 },
    voltageRange: [4.8, 6.0],
    currentMa: { idle: 8, stall: 800 },
    weightG: 43.9,
    dimensionsMm: { l: 40.4, w: 19.8, h: 36.5 },
    shaftOffsetMm: 10.0,
    pinionDiamMm: 6.0,
    pulseUs: { min: 900, center: 1500, max: 2100 },
    deadbandUs: 8,
    gearType: "plastic",
    bearing: "ball",
    connector: "Hitec",
    notes: "Servo de référence Hitec, précis et fiable",
  },
  {
    id: "sh-0257mg",
    brand: "Savöx",
    model: "SH-0257MG",
    torqueKgCm: { v6: 2.5 },
    speedS60: { v6: 0.09 },
    voltageRange: [4.8, 6.0],
    currentMa: { idle: 5, stall: 500 },
    weightG: 11.5,
    dimensionsMm: { l: 22.8, w: 12.0, h: 24.0 },
    shaftOffsetMm: 5.5,
    pinionDiamMm: 4.8,
    pulseUs: { min: 900, center: 1500, max: 2100 },
    deadbandUs: 3,
    gearType: "metal",
    bearing: "ball",
    connector: "JR",
    notes: "Micro servo métal très précis",
  },
];

const CUSTOM_KEY = "hexagram.customServoTypes";

export function loadCustomServoTypes(): ServoSpec[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as ServoSpec[]).map((s) => ({ ...s, custom: true }));
  } catch {
    return [];
  }
}

export function saveCustomServoType(spec: ServoSpec): void {
  const existing = loadCustomServoTypes();
  const idx = existing.findIndex((s) => s.id === spec.id);
  const updated = { ...spec, custom: true };
  if (idx >= 0) existing[idx] = updated;
  else existing.push(updated);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(existing));
  } catch {}
}

export function getAllServoTypes(extra: ServoSpec[] = []): ServoSpec[] {
  // Le catalogue de base provient désormais du store (hydraté depuis la base),
  // avec repli sur SERVO_CATALOG intégré tant que le store n'est pas peuplé.
  const base = useCatalogStore.getState().servoTypes;
  return [...(base.length ? base : SERVO_CATALOG), ...loadCustomServoTypes(), ...extra];
}

export function findServoType(
  id: string | null | undefined,
  extraCustom: ServoSpec[] = []
): ServoSpec | null {
  if (!id) return null;
  return getAllServoTypes(extraCustom).find((s) => s.id === id) ?? null;
}

/** Dimensions vue de dessus d'un servo, en MÈTRES (corps + pignon). */
export interface ServoDimsM {
  lengthM: number;
  widthM: number;
  /** Décalage du pignon depuis le centre du corps, vers la sortie (m). */
  shaftOffsetM: number;
  /** Rayon du pignon de sortie (m). */
  pinionRadiusM: number;
}

/** Repli générique quand aucun servo n'est sélectionné (gabarit ~ servo standard). */
export const DEFAULT_SERVO_DIMS_M: ServoDimsM = {
  lengthM: 0.0407,
  widthM: 0.0201,
  shaftOffsetM: 0.010,
  pinionRadiusM: 0.003,
};

/**
 * Dérive les dimensions vue de dessus (m) d'un servo depuis sa fiche catalogue.
 * Champs absents ⇒ conventions : axe de sortie proche d'une extrémité
 * (≈ longueur/2 − 10 mm), pignon Ø ~6 mm.
 */
export function coxaServoDimsM(spec: ServoSpec | null | undefined): ServoDimsM {
  if (!spec) return DEFAULT_SERVO_DIMS_M;
  const l = spec.dimensionsMm.l / 1000;
  const w = spec.dimensionsMm.w / 1000;
  const shaftOffsetM =
    spec.shaftOffsetMm != null ? spec.shaftOffsetMm / 1000 : Math.max(0, l / 2 - 0.010);
  const pinionRadiusM = (spec.pinionDiamMm != null ? spec.pinionDiamMm : 6) / 2000;
  return { lengthM: l, widthM: w, shaftOffsetM, pinionRadiusM };
}
