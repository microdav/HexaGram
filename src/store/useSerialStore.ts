import { create } from "zustand";
import { SerialLink, isWebSerialSupported } from "../serial/webSerial";
import {
  angleToPulseUs,
  protocolForController,
  resolveHardwareSpecs,
  defaultBinding,
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

// Plafond de l'historique console (session) : assez large pour conserver une
// session de calibration complète (commandes + réponses) consultable à tout
// moment depuis la console électronique transverse.
const MAX_LOG = 1000;

/** Une entrée de console série : émission (tx), réception (rx) ou info locale. */
export interface SerialLogEntry {
  dir: "tx" | "rx" | "info";
  text: string;
  /** Horodatage ms (rempli au moment de l'ajout). */
  t: number;
}

interface SerialState {
  status: SerialStatus;
  portLabel: string | null;
  baudRate: number;
  /** Carte ciblée par le câble USB (cf. ConnTarget). */
  target: ConnTarget;
  errorMsg: string | null;
  /** Console série : commandes émises (tx), messages reçus (rx), infos. Ordre chronologique. */
  log: SerialLogEntry[];
  /** Total d'octets bruts reçus depuis la connexion (diagnostic RX). */
  rxByteCount: number;
  /** Panneau console bas : ouvert / hauteur (px), persistés localement. */
  consoleOpen: boolean;
  consoleHeight: number;
  /** Angle de test logique courant par servo (éphémère, non persisté). */
  testAngles: Record<number, number>;
  /** Servo en cours d'identification (wiggle) — pour feedback UI. */
  identifying: number | null;

  setBaudRate: (b: number) => void;
  setTarget: (t: ConnTarget) => void;
  setConsoleOpen: (v: boolean) => void;
  setConsoleHeight: (h: number) => void;
  clearLog: () => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;

  /** Envoie un angle logique (deg) au servo via son canal. Met à jour testAngles. */
  sendServoAngle: (servoId: number, deg: number) => Promise<void>;
  /** Place un servo à son zéro logique (position mécanique de référence). */
  centerServo: (servoId: number) => Promise<void>;
  /** Tous les servos liés à leur zéro logique. */
  centerAll: () => Promise<void>;
  /**
   * Envoie une pose complète (18 angles logiques, indexés par servo) à tous les
   * servos câblés. `timeMs` > 0 demande une transition douce (T sur SSC-32U).
   */
  sendPose: (pose: number[], timeMs?: number) => Promise<void>;
  /** Arrêt d'urgence : coupe le couple de tous les canaux liés. */
  releaseAll: () => Promise<void>;
  /** Fait osciller un servo pour l'identifier physiquement. */
  identify: (servoId: number) => Promise<void>;
  /** Interroge la version firmware (SSC-32U : commande `VER`). Test de présence. */
  testVersion: () => Promise<void>;
  /**
   * Envoie une commande brute déjà formatée (terminateur compris) telle quelle à
   * la carte, et la journalise. Utilisé par l'envoi de script de séquence, où les
   * lignes sont construites en amont (groupes de canaux, T…).
   */
  sendRaw: (cmd: string) => Promise<void>;
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

const CONSOLE_KEY = "hexagram.serial.console";
function readConsole(): { open: boolean; height: number } {
  try {
    const raw = localStorage.getItem(CONSOLE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { open?: boolean; height?: number };
      return { open: !!p.open, height: p.height && p.height > 0 ? p.height : 200 };
    }
  } catch {
    /* ignore */
  }
  return { open: false, height: 200 };
}
function writeConsole(open: boolean, height: number): void {
  try {
    localStorage.setItem(CONSOLE_KEY, JSON.stringify({ open, height }));
  } catch {
    /* ignore */
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Ajoute une entrée tx/info à la console. Les lignes vides sont ignorées. */
function pushLog(
  set: (fn: (s: SerialState) => Partial<SerialState>) => void,
  dir: SerialLogEntry["dir"],
  text: string
) {
  const clean = text.replace(/\r/g, "").replace(/\n+$/g, "");
  if (!clean) return;
  set((s) => ({ log: [...s.log, { dir, text: clean, t: nowMs() }].slice(-MAX_LOG) }));
}

/**
 * Journalise un fragment RX brut SANS jamais le perdre : texte si imprimable,
 * sinon représentation hex. Met à jour le compteur d'octets reçus. Indispensable
 * au diagnostic : permet de distinguer « rien ne revient » de « ça revient mais
 * ce ne sont que des CR/octets non imprimables ».
 */
function pushRx(
  set: (fn: (s: SerialState) => Partial<SerialState>) => void,
  bytes: Uint8Array,
  text: string
) {
  const printable = text.replace(/\r/g, "").replace(/\n+$/g, "");
  const display =
    printable.length > 0
      ? printable
      : "[" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ") + "]";
  set((s) => ({
    log: [...s.log, { dir: "rx" as const, text: display, t: nowMs() }].slice(-MAX_LOG),
    rxByteCount: s.rxByteCount + bytes.length,
  }));
}

// Date.now() est interdit dans certains contextes harness mais OK ici (runtime navigateur).
function nowMs(): number {
  return Date.now();
}

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

function bindingFor(servoId: number): ServoBinding {
  // Même fallback que l'UI (defaultBinding) : sinon le store renverrait null
  // quand electronics est absent alors que le slider, lui, reste actif sur le
  // canal par défaut → commande silencieusement ignorée et non tracée.
  const { electronics } = hardwareContext();
  return electronics?.bindings?.[servoId] ?? defaultBinding(servoId);
}

const _console = readConsole();

export const useSerialStore = create<SerialState>((set, get) => ({
  status: isWebSerialSupported() ? "disconnected" : "unsupported",
  portLabel: null,
  baudRate: readBaud() ?? 115200,
  target: readTarget(),
  errorMsg: null,
  log: [],
  rxByteCount: 0,
  consoleOpen: _console.open,
  consoleHeight: _console.height,
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

  setConsoleOpen: (v) => {
    writeConsole(v, get().consoleHeight);
    set({ consoleOpen: v });
  },

  setConsoleHeight: (h) => {
    writeConsole(get().consoleOpen, h);
    set({ consoleHeight: h });
  },

  clearLog: () => set({ log: [], rxByteCount: 0 }),

  connect: async () => {
    if (get().status === "unsupported") return;
    set({ status: "connecting", errorMsg: null });
    try {
      const label = await link.connect(get().baudRate);
      set({ status: "connected", portLabel: label, rxByteCount: 0 });
      pushLog(set, "info", `Connecté à ${label} @ ${get().baudRate} bauds`);
      // Démarre l'écoute des réponses de la carte (← rx). On journalise les
      // octets bruts pour ne jamais perdre une réponse (même non imprimable).
      link.startReader((bytes) => pushRx(set, bytes, link.decode(bytes)));
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
    pushLog(set, "info", "Déconnecté");
    useToastStore.getState().show("Carte déconnectée");
  },

  sendServoAngle: async (servoId, deg) => {
    set((s) => ({ testAngles: { ...s.testAngles, [servoId]: deg } }));
    if (get().status !== "connected") return;
    const { protocol, servo, controller } = hardwareContext();
    const binding = bindingFor(servoId);
    if (binding.channel == null) {
      pushLog(set, "info", `Servo ${servoId} non câblé (aucun canal) — commande ignorée`);
      return;
    }
    const us = angleToPulseUs(deg, binding, servo, controller);
    const cmd = protocol.move(binding.channel, us);
    try {
      await link.writeString(cmd);
      pushLog(set, "tx", cmd);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Écriture échouée";
      set({ status: "error", errorMsg: msg });
      pushLog(set, "info", `Erreur écriture : ${msg}`);
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

  sendPose: async (pose, timeMs = 0) => {
    if (get().status !== "connected") return;
    const { protocol, servo, controller, electronics } = hardwareContext();
    if (!electronics) return;
    let count = 0;
    for (let id = 0; id < 18; id++) {
      const binding = electronics.bindings[id] ?? defaultBinding(id);
      if (binding.channel == null) continue;
      const deg = Number.isFinite(pose[id]) ? pose[id] : 0;
      const us = angleToPulseUs(deg, binding, servo, controller);
      const cmd = protocol.move(binding.channel, us, timeMs);
      try {
        await link.writeString(cmd);
        pushLog(set, "tx", cmd);
        set((s) => ({ testAngles: { ...s.testAngles, [id]: deg } }));
        count++;
        await sleep(6);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Écriture échouée";
        set({ status: "error", errorMsg: msg });
        pushLog(set, "info", `Erreur écriture : ${msg}`);
        break;
      }
    }
    useToastStore.getState().show(`Position envoyée (${count} servo${count > 1 ? "s" : ""})`);
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
    pushLog(set, "info", "Relâche tout (couple off)");
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

  testVersion: async () => {
    if (get().status !== "connected") return;
    // SSC-32U : `VER<CR>` renvoie la chaîne de version (test de présence carte).
    // Pour les autres protocoles, on tente la même commande — sans garantie de réponse.
    const cmd = "VER\r";
    try {
      await link.writeString(cmd);
      pushLog(set, "tx", cmd);
      pushLog(set, "info", "VER envoyé — réponse attendue ci-dessous (si la carte répond)");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Écriture échouée";
      set({ status: "error", errorMsg: msg });
      pushLog(set, "info", `Erreur écriture : ${msg}`);
    }
  },

  sendRaw: async (cmd) => {
    if (get().status !== "connected") return;
    try {
      await link.writeString(cmd);
      pushLog(set, "tx", cmd);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Écriture échouée";
      set({ status: "error", errorMsg: msg });
      pushLog(set, "info", `Erreur écriture : ${msg}`);
    }
  },
}));
