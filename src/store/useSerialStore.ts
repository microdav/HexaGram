import { create } from "zustand";
import { SerialLink, isWebSerialSupported } from "../serial/webSerial";
import {
  angleToPulseUs,
  protocolForController,
  resolveHardwareSpecs,
  GENERIC_ASCII_PROTOCOL,
  type ServoBinding,
} from "../model/electronics";
import { useProjectStore } from "./useProjectStore";
import { useToastStore } from "./useToastStore";

export type SerialStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * Carte sur laquelle l'USB est physiquement branché :
 *  - "controller" : directement sur le contrôleur de servos (ex. SSC-32U) —
 *    mode initialisation/calibration (protocole du contrôleur, en direct).
 *  - "command" : sur la carte de commande (ex. ESP32) qui relaie ensuite —
 *    mode exploitation (protocole firmware générique).
 */
export type ConnTarget = "controller" | "command";

const MAX_LOG = 40;

interface SerialState {
  status: SerialStatus;
  portLabel: string | null;
  baudRate: number;
  /** Carte ciblée par le câble USB (cf. ConnTarget). */
  target: ConnTarget;
  errorMsg: string | null;
  /** Journal des dernières commandes envoyées (debug / transparence). */
  log: string[];
  /** Angle de test logique courant par servo (éphémère, non persisté). */
  testAngles: Record<number, number>;
  /** Servo en cours d'identification (wiggle) — pour feedback UI. */
  identifying: number | null;

  setBaudRate: (b: number) => void;
  setTarget: (t: ConnTarget) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;

  /** Envoie un angle logique (deg) au servo via son canal. Met à jour testAngles. */
  sendServoAngle: (servoId: number, deg: number) => Promise<void>;
  /** Place un servo à son zéro logique (position mécanique de référence). */
  centerServo: (servoId: number) => Promise<void>;
  /** Tous les servos liés à leur zéro logique. */
  centerAll: () => Promise<void>;
  /** Arrêt d'urgence : coupe le couple de tous les canaux liés. */
  releaseAll: () => Promise<void>;
  /** Fait osciller un servo pour l'identifier physiquement. */
  identify: (servoId: number) => Promise<void>;
}

// Instance unique de liaison série pour toute l'app.
const link = new SerialLink();

const BAUD_KEY = "hexagram.serial.baud";
function readBaud(): number | null {
  try {
    const v = Number(localStorage.getItem(BAUD_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

const TARGET_KEY = "hexagram.serial.target";
function readTarget(): ConnTarget {
  try {
    const v = localStorage.getItem(TARGET_KEY);
    return v === "command" ? "command" : "controller";
  } catch {
    return "controller";
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Contexte matériel courant pour formater/convertir les commandes. */
function hardwareContext() {
  const project = useProjectStore.getState().activeProject;
  const hardware = project?.hardware;
  const electronics = hardware?.electronics ?? null;
  const target = useSerialStore.getState().target;
  // USB direct sur le contrôleur → protocole du contrôleur (SSC-32U ASCII).
  // USB sur la carte de commande (ESP32) → protocole firmware générique relayé.
  const protocol =
    target === "command"
      ? GENERIC_ASCII_PROTOCOL
      : protocolForController(hardware?.servoControllerId ?? null);
  const specs = resolveHardwareSpecs({
    servoTypeId: hardware?.servoTypeId ?? null,
    servoControllerId: hardware?.servoControllerId ?? null,
    customServoTypes: hardware?.customServoTypes ?? [],
  });
  return { electronics, protocol, target, ...specs };
}

function bindingFor(servoId: number): ServoBinding | null {
  const { electronics } = hardwareContext();
  return electronics?.bindings?.[servoId] ?? null;
}

export const useSerialStore = create<SerialState>((set, get) => ({
  status: isWebSerialSupported() ? "disconnected" : "unsupported",
  portLabel: null,
  baudRate: readBaud() ?? 115200,
  target: readTarget(),
  errorMsg: null,
  log: [],
  testAngles: {},
  identifying: null,

  setBaudRate: (b) => {
    try {
      localStorage.setItem(BAUD_KEY, String(b));
    } catch {
      /* ignore */
    }
    set({ baudRate: b });
  },

  setTarget: (t) => {
    try {
      localStorage.setItem(TARGET_KEY, t);
    } catch {
      /* ignore */
    }
    set({ target: t });
  },

  connect: async () => {
    if (get().status === "unsupported") return;
    set({ status: "connecting", errorMsg: null });
    try {
      const label = await link.connect(get().baudRate);
      set({ status: "connected", portLabel: label });
      useToastStore.getState().show(`Carte connectée (${label})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connexion échouée";
      // L'annulation du sélecteur de port n'est pas une vraie erreur.
      const cancelled = /No port selected|cancel/i.test(msg);
      set({
        status: cancelled ? "disconnected" : "error",
        errorMsg: cancelled ? null : msg,
      });
      if (!cancelled) useToastStore.getState().show(`Erreur : ${msg}`);
    }
  },

  disconnect: async () => {
    await link.disconnect();
    set({ status: "disconnected", portLabel: null, errorMsg: null });
    useToastStore.getState().show("Carte déconnectée");
  },

  sendServoAngle: async (servoId, deg) => {
    set((s) => ({ testAngles: { ...s.testAngles, [servoId]: deg } }));
    if (get().status !== "connected") return;
    const { protocol, servo, controller } = hardwareContext();
    const binding = bindingFor(servoId);
    if (!binding || binding.channel == null) return;
    const us = angleToPulseUs(deg, binding, servo, controller);
    const cmd = protocol.move(binding.channel, us);
    try {
      await link.writeString(cmd);
      set((s) => ({ log: [`→ ${cmd.trim()}`, ...s.log].slice(0, MAX_LOG) }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Écriture échouée";
      set({ status: "error", errorMsg: msg });
    }
  },

  centerServo: async (servoId) => {
    await get().sendServoAngle(servoId, 0);
  },

  centerAll: async () => {
    if (get().status !== "connected") return;
    const { electronics } = hardwareContext();
    if (!electronics) return;
    for (let id = 0; id < 18; id++) {
      if (electronics.bindings[id]?.channel != null) {
        await get().sendServoAngle(id, 0);
        await sleep(8);
      }
    }
    useToastStore.getState().show("Tous les servos centrés");
  },

  releaseAll: async () => {
    if (get().status !== "connected") return;
    const { protocol, electronics } = hardwareContext();
    if (!electronics) return;
    for (let id = 0; id < 18; id++) {
      const ch = electronics.bindings[id]?.channel;
      if (ch == null) continue;
      try {
        await link.writeString(protocol.release(ch));
        await sleep(8);
      } catch {
        /* on continue le relâchement des autres canaux malgré une erreur */
      }
    }
    set((s) => ({ log: ["→ RELÂCHE TOUT (couple off)", ...s.log].slice(0, MAX_LOG) }));
    useToastStore.getState().show("Couple coupé sur tous les servos");
  },

  identify: async (servoId) => {
    if (get().status !== "connected") return;
    const binding = bindingFor(servoId);
    if (!binding || binding.channel == null) return;
    set({ identifying: servoId });
    try {
      const seq = [15, -15, 15, -15, 0];
      for (const a of seq) {
        await get().sendServoAngle(servoId, a);
        await sleep(180);
      }
    } finally {
      set({ identifying: null });
    }
  },
}));
