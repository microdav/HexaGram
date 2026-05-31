// Référentiel des capteurs & périphériques pouvant être reliés à la carte de
// commande, et modèle de ceux sélectionnés dans un projet.
//
// Le catalogue est volontairement ouvert : ajouter une entrée = ajouter un objet
// à PERIPHERAL_CATALOG. Chaque périphérique sélectionné référence un id du
// catalogue (specId) + un placement (au-dessus / en-dessous de la carte) pour le
// schéma d'architecture.

export type PeripheralCategory =
  | "imu"
  | "distance"
  | "led"
  | "button"
  | "voltage"
  | "display"
  | "audio"
  | "other";

export interface PeripheralSpec {
  id: string;
  category: PeripheralCategory;
  name: string;
  description: string;
  /** Bus / type de liaison vers la carte de commande. */
  interfaces: string[];
  icon: string;
}

export const PERIPHERAL_CATEGORIES: Record<PeripheralCategory, { label: string; icon: string }> = {
  imu: { label: "Inclinaison / IMU", icon: "🧭" },
  distance: { label: "Distance", icon: "📡" },
  led: { label: "LED", icon: "💡" },
  button: { label: "Bouton", icon: "🔘" },
  voltage: { label: "Tension / courant", icon: "🔋" },
  display: { label: "Écran", icon: "🖥️" },
  audio: { label: "Son", icon: "🔊" },
  other: { label: "Autre", icon: "🧩" },
};

export const PERIPHERAL_CATALOG: PeripheralSpec[] = [
  // ── Inclinaison / IMU ──────────────────────────────────────────────────────
  { id: "mpu6050", category: "imu", name: "MPU6050", description: "Accéléromètre + gyroscope 6 axes (inclinaison)", interfaces: ["I2C"], icon: "🧭" },
  { id: "mpu9250", category: "imu", name: "MPU9250", description: "IMU 9 axes (accéléro + gyro + magnéto)", interfaces: ["I2C", "SPI"], icon: "🧭" },
  { id: "bno055", category: "imu", name: "BNO055", description: "IMU 9 axes avec fusion intégrée (orientation absolue)", interfaces: ["I2C"], icon: "🧭" },
  { id: "icm20948", category: "imu", name: "ICM-20948", description: "IMU 9 axes basse conso", interfaces: ["I2C", "SPI"], icon: "🧭" },
  { id: "adxl345", category: "imu", name: "ADXL345", description: "Accéléromètre 3 axes", interfaces: ["I2C", "SPI"], icon: "📐" },
  // ── Distance ────────────────────────────────────────────────────────────────
  { id: "hc-sr04", category: "distance", name: "HC-SR04", description: "Télémètre ultrason (2–400 cm)", interfaces: ["GPIO"], icon: "📡" },
  { id: "us-100", category: "distance", name: "US-100", description: "Télémètre ultrason (UART/GPIO, compensé température)", interfaces: ["UART", "GPIO"], icon: "📡" },
  { id: "vl53l0x", category: "distance", name: "VL53L0X", description: "Télémètre laser ToF (jusqu'à ~2 m)", interfaces: ["I2C"], icon: "📡" },
  { id: "gp2y0a21", category: "distance", name: "Sharp GP2Y0A21", description: "Capteur de distance IR analogique (10–80 cm)", interfaces: ["Analog"], icon: "📡" },
  { id: "ir-obstacle", category: "distance", name: "Capteur IR obstacle", description: "Détecteur d'obstacle infrarouge tout-ou-rien", interfaces: ["GPIO"], icon: "📡" },
  // ── LED ───────────────────────────────────────────────────────────────────────
  { id: "led", category: "led", name: "LED", description: "LED simple", interfaces: ["GPIO"], icon: "💡" },
  { id: "led-rgb", category: "led", name: "LED RGB", description: "LED RGB (3 canaux PWM)", interfaces: ["PWM"], icon: "🌈" },
  { id: "ws2812", category: "led", name: "NeoPixel WS2812", description: "Bandeau / anneau de LEDs adressables", interfaces: ["GPIO"], icon: "▦" },
  // ── Boutons poussoirs (couleurs) ──────────────────────────────────────────────
  { id: "btn-red", category: "button", name: "Bouton poussoir rouge", description: "Bouton poussoir momentané (rouge)", interfaces: ["GPIO"], icon: "🔴" },
  { id: "btn-green", category: "button", name: "Bouton poussoir vert", description: "Bouton poussoir momentané (vert)", interfaces: ["GPIO"], icon: "🟢" },
  { id: "btn-blue", category: "button", name: "Bouton poussoir bleu", description: "Bouton poussoir momentané (bleu)", interfaces: ["GPIO"], icon: "🔵" },
  { id: "btn-yellow", category: "button", name: "Bouton poussoir jaune", description: "Bouton poussoir momentané (jaune)", interfaces: ["GPIO"], icon: "🟡" },
  // ── Tension / courant ─────────────────────────────────────────────────────────
  { id: "voltage-divider", category: "voltage", name: "Détecteur de tension", description: "Module diviseur de tension (0–25 V)", interfaces: ["Analog"], icon: "🔋" },
  { id: "ina219", category: "voltage", name: "INA219", description: "Mesure tension + courant (I2C)", interfaces: ["I2C"], icon: "🔋" },
  { id: "ina226", category: "voltage", name: "INA226", description: "Mesure tension + courant haute précision (I2C)", interfaces: ["I2C"], icon: "🔋" },
  // ── Écran ──────────────────────────────────────────────────────────────────────
  { id: "ssd1306", category: "display", name: "OLED SSD1306", description: "Écran OLED 128×64 I2C", interfaces: ["I2C"], icon: "🖥️" },
  // ── Son ─────────────────────────────────────────────────────────────────────────
  { id: "buzzer", category: "audio", name: "Buzzer", description: "Buzzer piézo (signal sonore)", interfaces: ["GPIO"], icon: "🔊" },
];

export function findPeripheral(id: string): PeripheralSpec | undefined {
  return PERIPHERAL_CATALOG.find((p) => p.id === id);
}

// ── Périphériques sélectionnés dans un projet ────────────────────────────────

export type PeripheralPlacement = "above" | "below";

export interface ProjectPeripheral {
  /** Identifiant unique de cette instance. */
  uid: string;
  /** Référence vers une entrée du catalogue (PeripheralSpec.id). */
  specId: string;
  /** Libellé personnalisé éventuel (sinon nom du catalogue). */
  label?: string | null;
  /** Position dans le schéma : au-dessus / en-dessous de la carte de commande. */
  placement: PeripheralPlacement;
  /** Annotation libre (broche, usage…). */
  note?: string | null;
}

export function normalizePeripherals(raw: unknown): ProjectPeripheral[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r, i): ProjectPeripheral => ({
      uid: typeof r.uid === "string" && r.uid ? r.uid : `p-${i}-${String(r.specId ?? "x")}`,
      specId: typeof r.specId === "string" ? r.specId : "",
      label: typeof r.label === "string" ? r.label : null,
      placement: r.placement === "below" ? "below" : "above",
      note: typeof r.note === "string" ? r.note : null,
    }))
    .filter((p) => p.specId);
}

/** Génère un identifiant d'instance unique (contexte navigateur). */
export function newPeripheralUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
