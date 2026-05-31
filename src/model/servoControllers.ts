import { useCatalogStore } from "../store/useCatalogStore";

export interface ServoControllerSpec {
  id: string;
  brand: string;
  model: string;
  channels: number;
  interfaces: string[];
  voltageInputV: [number, number];
  voltageServoV?: [number, number];
  pulseUs: { min: number; max: number };
  resolutionUs: number;
  weightG: number;
  dimensionsMm: { l: number; w: number; h: number };
  notes?: string;
}

export const SERVO_CONTROLLER_CATALOG: ServoControllerSpec[] = [
  {
    id: "lynxmotion-ssc-32u",
    brand: "Lynxmotion",
    model: "SSC-32U",
    channels: 32,
    interfaces: ["USB", "UART"],
    voltageInputV: [6.0, 9.0],
    voltageServoV: [4.8, 6.0],
    pulseUs: { min: 500, max: 2500 },
    resolutionUs: 1,
    weightG: 20,
    dimensionsMm: { l: 58, w: 40, h: 12 },
    notes: "Contrôleur série 32 canaux USB/UART. Résolution 1 µs, commandes ASCII. Référence BotBoarduino-compatible.",
  },
  {
    id: "pololu-maestro-6",
    brand: "Pololu",
    model: "Mini Maestro 6",
    channels: 6,
    interfaces: ["USB", "UART", "TTL"],
    voltageInputV: [5.0, 16.0],
    pulseUs: { min: 64, max: 3280 },
    resolutionUs: 0.25,
    weightG: 4,
    dimensionsMm: { l: 31, w: 25, h: 8 },
    notes: "6 canaux, résolution 0,25 µs, logiciel de configuration Pololu Maestro.",
  },
  {
    id: "pololu-maestro-12",
    brand: "Pololu",
    model: "Mini Maestro 12",
    channels: 12,
    interfaces: ["USB", "UART", "TTL"],
    voltageInputV: [5.0, 16.0],
    pulseUs: { min: 64, max: 3280 },
    resolutionUs: 0.25,
    weightG: 5,
    dimensionsMm: { l: 50, w: 25, h: 8 },
    notes: "12 canaux, résolution 0,25 µs.",
  },
  {
    id: "pololu-maestro-18",
    brand: "Pololu",
    model: "Mini Maestro 18",
    channels: 18,
    interfaces: ["USB", "UART", "TTL"],
    voltageInputV: [5.0, 16.0],
    pulseUs: { min: 64, max: 3280 },
    resolutionUs: 0.25,
    weightG: 7,
    dimensionsMm: { l: 62, w: 25, h: 8 },
    notes: "18 canaux — idéal hexapode 6×3 DOF.",
  },
  {
    id: "pololu-maestro-24",
    brand: "Pololu",
    model: "Mini Maestro 24",
    channels: 24,
    interfaces: ["USB", "UART", "TTL"],
    voltageInputV: [5.0, 16.0],
    pulseUs: { min: 64, max: 3280 },
    resolutionUs: 0.25,
    weightG: 9,
    dimensionsMm: { l: 79, w: 25, h: 8 },
    notes: "24 canaux.",
  },
  {
    id: "adafruit-pca9685",
    brand: "Adafruit",
    model: "PCA9685",
    channels: 16,
    interfaces: ["I2C"],
    voltageInputV: [3.0, 5.5],
    voltageServoV: [4.8, 6.0],
    pulseUs: { min: 500, max: 2500 },
    resolutionUs: 4,
    weightG: 10,
    dimensionsMm: { l: 62, w: 25, h: 10 },
    notes: "16 canaux PWM I2C. Résolution 12 bits. Plusieurs cartes chainables.",
  },
  {
    id: "robotis-usb2dynamixel",
    brand: "Robotis",
    model: "USB2Dynamixel",
    channels: 254,
    interfaces: ["USB", "Dynamixel TTL", "Dynamixel RS-485"],
    voltageInputV: [5.0, 5.0],
    pulseUs: { min: 0, max: 0 },
    resolutionUs: 0,
    weightG: 15,
    dimensionsMm: { l: 66, w: 18, h: 14 },
    notes: "Adaptateur USB pour bus Dynamixel (TTL et RS-485). Non compatible servo PWM standard.",
  },
  {
    id: "sequencer-esp32-i2c-pca9685",
    brand: "Générique",
    model: "ESP32 + PCA9685",
    channels: 32,
    interfaces: ["WiFi", "BLE", "I2C", "UART"],
    voltageInputV: [3.3, 5.0],
    voltageServoV: [4.8, 7.4],
    pulseUs: { min: 500, max: 2500 },
    resolutionUs: 4,
    weightG: 18,
    dimensionsMm: { l: 80, w: 40, h: 15 },
    notes: "Combo ESP32 + 2× PCA9685 en cascade. Solution DIY courante pour hexapodes WiFi.",
  },
];

export function findServoController(id: string): ServoControllerSpec | undefined {
  const base = useCatalogStore.getState().servoControllers;
  return (base.length ? base : SERVO_CONTROLLER_CATALOG).find((c) => c.id === id);
}
