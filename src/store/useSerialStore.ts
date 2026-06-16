import { create } from "zustand";
import { SerialLink, isWebSerialSupported } from "../serial/webSerial";
import {
  angleToPulseUs,
  pulseUsToAngle,
  clampToServoLimits,
  protocolForController,
  resolveHardwareSpecs,
  defaultBinding,
  GENERIC_ASCII_PROTOCOL,
  type ServoBinding,
} from "../model/electronics";
import { useProjectStore } from "./useProjectStore";
import { useToastStore } from "./useToastStore";
import { useHexapodStore } from "./useHexapodStore";

export type SerialStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * Nature d'une erreur de liaison, pour remonter un message distinct (cf. P1) :
 *  - "port-lost"     : port USB perdu (débranchement / réinitialisation carte).
 *  - "write-failed"  : échec d'écriture alors que le port semble encore ouvert.
 *  - "connect-failed": échec à l'ouverture du port.
 *  - "not-connected" : commande émise sans liaison active.
 */
export type SerialErrorKind =
  | "port-lost"
  | "write-failed"
  | "connect-failed"
  | "not-connected"
  | null;

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
  /** Nature de la dernière erreur (pilote le message et le bouton « Reconnecter »). */
  errorKind: SerialErrorKind;
  /** Watchdog couple-off : couper le couple après une inactivité prolongée en mode Live. Persisté. */
  watchdogEnabled: boolean;
  /** Durée de transition par défaut (ms) des envois HORS live (pose, centrage). Persisté. */
  transitionMs: number;
  /** Console série : commandes émises (tx), messages reçus (rx), infos. Ordre chronologique. */
  log: SerialLogEntry[];
  /** Total d'octets bruts reçus depuis la connexion (diagnostic RX). */
  rxByteCount: number;
  /** Panneau console bas : ouvert / hauteur (px), persistés localement. */
  consoleOpen: boolean;
  consoleHeight: number;
  /** Miroir live : la pose 3D (useHexapodStore.pose) est streamée au robot en
   *  temps réel tant que ce mode est actif ET la carte connectée. Persisté. */
  liveMirror: boolean;
  /** Miroir live : n'envoyer qu'EN FIN DE MOUVEMENT (au relâchement souris) plutôt
   *  qu'en continu — supprime les saccades. Défaut activé. Persisté. */
  mirrorOnRelease: boolean;
  /** Horodatage (ms) du dernier envoi du miroir live — indicateur d'activité UI. */
  lastMirrorAt: number | null;
  /** Angle de test logique courant par servo (éphémère, non persisté). */
  testAngles: Record<number, number>;
  /** Servo en cours d'identification (wiggle) — pour feedback UI. */
  identifying: number | null;

  setBaudRate: (b: number) => void;
  setTarget: (t: ConnTarget) => void;
  setConsoleOpen: (v: boolean) => void;
  setConsoleHeight: (h: number) => void;
  /** Active/désactive le miroir live (envoie la pose courante à l'activation si connecté). */
  setLiveMirror: (v: boolean) => void;
  /** Bascule « envoyer en fin de mouvement » du miroir live. */
  setMirrorOnRelease: (v: boolean) => void;
  /** Active/désactive le watchdog couple-off (réarmé/désarmé immédiatement). */
  setWatchdogEnabled: (v: boolean) => void;
  /** Règle la durée de transition par défaut (ms) des envois hors live. */
  setTransitionMs: (ms: number) => void;
  clearLog: () => void;
  connect: () => Promise<void>;
  /** Rouvre la liaison après une perte, sans re-sélection manuelle du port. */
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;

  /**
   * Envoie un angle logique (deg) au servo via son canal. Met à jour testAngles.
   * `timeMs` > 0 demande une transition douce (T sur SSC-32U) — 0 = instantané
   * (jog de calibration). Le centrage l'utilise pour un recentrage en douceur.
   */
  sendServoAngle: (servoId: number, deg: number, timeMs?: number) => Promise<void>;
  /** Place un servo à son zéro logique (position mécanique de référence). */
  centerServo: (servoId: number) => Promise<void>;
  /** Tous les servos liés à leur zéro logique. */
  centerAll: () => Promise<void>;
  /**
   * Envoie une pose complète (18 angles logiques, indexés par servo) à tous les
   * servos câblés. `timeMs` > 0 demande une transition douce (T sur SSC-32U).
   */
  sendPose: (pose: number[], timeMs?: number) => Promise<void>;
  /**
   * Envoi GROUPÉ et silencieux d'une pose (un seul write, T=0) pour le miroir
   * live haute fréquence — pas de toast, pas de log par trame (sinon inondation).
   */
  sendPoseLive: (pose: number[]) => Promise<void>;
  /** Arrêt d'urgence : coupe le couple de tous les canaux liés. */
  releaseAll: () => Promise<void>;
  /**
   * Interroge la carte : un mouvement est-il en cours ? (`Q` → `+`/`.` sur
   * SSC-32U). Renvoie `true`/`false`, ou `null` si non supporté / pas de réponse.
   * Socle de la synchronisation pas-à-pas de la locomotion (P3).
   */
  queryMoving: () => Promise<boolean | null>;
  /**
   * Lit la largeur d'impulsion d'un canal (`QP`) et la convertit en angle logique
   * (deg, repère servo). Renvoie `null` si non supporté / pas de réponse. Debug console.
   */
  queryPulseChannel: (channel: number) => Promise<number | null>;
  /** Arrête un canal à sa position courante (`STOP` SSC-32U), sans couper le couple. */
  sendStop: (channel: number) => Promise<void>;
  /**
   * Lit la position commandée de tous les servos câblés (`QP`) et l'applique à la
   * pose 3D — « importer la pose du robot ». Utile pour vérifier la calibration.
   */
  importPoseFromRobot: () => Promise<void>;
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

const LIVE_MIRROR_KEY = "hexagram.serial.liveMirror";
function readLiveMirror(): boolean {
  try {
    return localStorage.getItem(LIVE_MIRROR_KEY) === "1";
  } catch {
    return false;
  }
}
function writeLiveMirror(v: boolean): void {
  try {
    localStorage.setItem(LIVE_MIRROR_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const MIRROR_RELEASE_KEY = "hexagram.serial.mirrorOnRelease";
function readMirrorOnRelease(): boolean {
  // Défaut activé : seul "0" explicite désactive (moins de saccades par défaut).
  try {
    return localStorage.getItem(MIRROR_RELEASE_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeMirrorOnRelease(v: boolean): void {
  try {
    localStorage.setItem(MIRROR_RELEASE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const WATCHDOG_KEY = "hexagram.serial.watchdog";
function readWatchdog(): boolean {
  // Défaut activé : seul "0" explicite désactive (sécurité par défaut).
  try {
    return localStorage.getItem(WATCHDOG_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeWatchdog(v: boolean): void {
  try {
    localStorage.setItem(WATCHDOG_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const TRANSITION_KEY = "hexagram.serial.transitionMs";
const DEFAULT_TRANSITION_MS = 500;
function readTransition(): number {
  try {
    const v = Number(localStorage.getItem(TRANSITION_KEY));
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_TRANSITION_MS;
  } catch {
    return DEFAULT_TRANSITION_MS;
  }
}
function writeTransition(ms: number): void {
  try {
    localStorage.setItem(TRANSITION_KEY, String(ms));
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
  // Affichage fidèle : on ne montre le texte décodé que si TOUS les octets sont
  // imprimables (ASCII visible + CR/LF/TAB). Sinon → représentation hex, sans
  // quoi une réponse binaire (ex. l'octet d'un QP, y compris 0x00) donnerait une
  // ligne vide ou un caractère de remplacement trompeur.
  const allPrintable = bytes.every(
    (b) => (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d
  );
  const printable = text.trim();
  const display =
    allPrintable && printable.length > 0
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

/**
 * Marque une erreur d'écriture sur le store et renvoie le message. Distingue
 * « write échoué » (port encore ouvert) de « port perdu » (liaison déjà morte,
 * p.ex. débranchement détecté entre-temps) en s'appuyant sur l'état du lien.
 */
function markWriteError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Écriture échouée";
  useSerialStore.setState({
    status: "error",
    errorKind: link.connected ? "write-failed" : "port-lost",
    errorMsg: msg,
  });
  return msg;
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

/** Liaison dont le canal physique vaut `channel` (pour interpréter une réponse QP). */
function bindingForChannel(channel: number): ServoBinding | null {
  const { electronics } = hardwareContext();
  if (!electronics) return null;
  for (let id = 0; id < 18; id++) {
    if (electronics.bindings[id]?.channel === channel) return electronics.bindings[id];
  }
  return null;
}

const _console = readConsole();

export const useSerialStore = create<SerialState>((set, get) => ({
  status: isWebSerialSupported() ? "disconnected" : "unsupported",
  portLabel: null,
  baudRate: readBaud() ?? 115200,
  target: readTarget(),
  errorMsg: null,
  errorKind: null,
  watchdogEnabled: readWatchdog(),
  transitionMs: readTransition(),
  log: [],
  rxByteCount: 0,
  consoleOpen: _console.open,
  consoleHeight: _console.height,
  liveMirror: readLiveMirror(),
  mirrorOnRelease: readMirrorOnRelease(),
  lastMirrorAt: null,
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

  setLiveMirror: (v) => {
    writeLiveMirror(v);
    set({ liveMirror: v });
    // À l'activation, on pousse immédiatement la pose 3D courante (sinon il faut
    // bouger un servo pour amorcer le miroir) — ce qui arme aussi le watchdog.
    if (v && get().status === "connected") {
      void get().sendPoseLive(useHexapodStore.getState().pose);
    } else {
      stopWatchdog();
    }
  },

  setMirrorOnRelease: (v) => {
    writeMirrorOnRelease(v);
    set({ mirrorOnRelease: v });
  },

  setWatchdogEnabled: (v) => {
    writeWatchdog(v);
    set({ watchdogEnabled: v });
    if (v) armWatchdog();
    else stopWatchdog();
  },

  setTransitionMs: (ms) => {
    const clean = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : DEFAULT_TRANSITION_MS;
    writeTransition(clean);
    set({ transitionMs: clean });
  },

  clearLog: () => set({ log: [], rxByteCount: 0 }),

  connect: async () => {
    if (get().status === "unsupported") return;
    set({ status: "connecting", errorMsg: null, errorKind: null });
    try {
      const label = await link.connect(get().baudRate);
      set({ status: "connected", portLabel: label, rxByteCount: 0, errorMsg: null, errorKind: null });
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
        errorKind: cancelled ? null : "connect-failed",
      });
      if (!cancelled) useToastStore.getState().show(`Erreur : ${msg}`);
    }
  },

  reconnect: async () => {
    if (get().status === "unsupported") return;
    set({ status: "connecting", errorMsg: null, errorKind: null });
    try {
      const label = await link.reconnect(get().baudRate);
      set({ status: "connected", portLabel: label, rxByteCount: 0, errorMsg: null, errorKind: null });
      link.startReader((bytes) => pushRx(set, bytes, link.decode(bytes)));
      pushLog(set, "info", `Reconnecté à ${label} @ ${get().baudRate} bauds`);
      useToastStore.getState().show(`Carte reconnectée (${label})`);
      // Reprend le miroir live s'il était actif (réengage le couple en douceur).
      if (get().liveMirror) void get().sendPoseLive(useHexapodStore.getState().pose);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Reconnexion échouée";
      const cancelled = /No port selected|cancel/i.test(msg);
      set({
        status: cancelled ? "disconnected" : "error",
        errorMsg: cancelled ? null : msg,
        errorKind: cancelled ? null : "port-lost",
      });
      if (!cancelled) useToastStore.getState().show(`Reconnexion échouée : ${msg}`);
    }
  },

  disconnect: async () => {
    stopWatchdog();
    await link.disconnect();
    set({ status: "disconnected", portLabel: null, errorMsg: null, errorKind: null });
    pushLog(set, "info", "Déconnecté");
    useToastStore.getState().show("Carte déconnectée");
  },

  sendServoAngle: async (servoId, deg, timeMs = 0) => {
    set((s) => ({ testAngles: { ...s.testAngles, [servoId]: deg } }));
    if (get().status !== "connected") return;
    const { protocol, servo, controller } = hardwareContext();
    const binding = bindingFor(servoId);
    if (binding.channel == null) {
      pushLog(set, "info", `Servo ${servoId} non câblé (aucun canal) — commande ignorée`);
      return;
    }
    const us = angleToPulseUs(deg, binding, servo, controller);
    const cmd = protocol.move(binding.channel, us, timeMs);
    try {
      await link.writeString(cmd);
      pushLog(set, "tx", cmd);
    } catch (e) {
      pushLog(set, "info", `Erreur écriture : ${markWriteError(e)}`);
    }
  },

  centerServo: async (servoId) => {
    // Recentrage en douceur (transition par défaut) plutôt qu'un saut brutal.
    await get().sendServoAngle(servoId, 0, get().transitionMs);
  },

  centerAll: async () => {
    if (get().status !== "connected") return;
    const { electronics } = hardwareContext();
    if (!electronics) return;
    const timeMs = get().transitionMs;
    for (let id = 0; id < 18; id++) {
      if (electronics.bindings[id]?.channel != null) {
        await get().sendServoAngle(id, 0, timeMs);
        await sleep(8);
      }
    }
    useToastStore.getState().show("Tous les servos centrés");
  },

  sendPose: async (pose, timeMs) => {
    if (get().status !== "connected") return;
    // Transition douce par défaut (réglage partagé) : supprime les à-coups des
    // envois ponctuels. Un appelant peut forcer une durée précise (0 = instantané).
    const t = timeMs ?? get().transitionMs;
    const { protocol, servo, controller, electronics } = hardwareContext();
    if (!electronics) return;
    let count = 0;
    for (let id = 0; id < 18; id++) {
      const binding = electronics.bindings[id] ?? defaultBinding(id);
      if (binding.channel == null) continue;
      const raw = Number.isFinite(pose[id]) ? pose[id] : 0;
      const deg = clampToServoLimits(raw, binding, id); // sécurité : ne pas forcer au-delà des butées
      const us = angleToPulseUs(deg, binding, servo, controller);
      const cmd = protocol.move(binding.channel, us, t);
      try {
        await link.writeString(cmd);
        pushLog(set, "tx", cmd);
        set((s) => ({ testAngles: { ...s.testAngles, [id]: deg } }));
        count++;
        await sleep(6);
      } catch (e) {
        pushLog(set, "info", `Erreur écriture : ${markWriteError(e)}`);
        break;
      }
    }
    useToastStore.getState().show(`Position envoyée (${count} servo${count > 1 ? "s" : ""})`);
  },

  sendPoseLive: async (pose) => {
    if (get().status !== "connected") return;
    const { protocol, servo, controller, electronics } = hardwareContext();
    if (!electronics) return;
    const channels: { ch: number; us: number }[] = [];
    const nextTest: Record<number, number> = {};
    for (let id = 0; id < 18; id++) {
      const binding = electronics.bindings[id] ?? defaultBinding(id);
      if (binding.channel == null) continue;
      const raw = Number.isFinite(pose[id]) ? pose[id] : 0;
      const deg = clampToServoLimits(raw, binding, id); // sécurité : ne pas forcer au-delà des butées
      channels.push({ ch: binding.channel, us: angleToPulseUs(deg, binding, servo, controller) });
      nextTest[id] = deg;
    }
    if (channels.length === 0) return;
    const cmd = protocol.moveGroup(channels, 0);
    try {
      await link.writeString(cmd);
      // Auto-rétablissement : un envoi qui repasse après une erreur transitoire
      // (le lien étant toujours ouvert) ramène l'UI en « connecté ».
      set((s) => ({
        testAngles: { ...s.testAngles, ...nextTest },
        lastMirrorAt: nowMs(),
        ...(s.status === "error" && link.connected
          ? { status: "connected" as SerialStatus, errorKind: null, errorMsg: null }
          : {}),
      }));
      armWatchdog(); // une trame est partie → on réarme le watchdog couple-off
    } catch (e) {
      pushLog(set, "info", `Erreur écriture (miroir live) : ${markWriteError(e)}`);
    }
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
      pushLog(set, "info", `Erreur écriture : ${markWriteError(e)}`);
    }
  },

  sendRaw: async (cmd) => {
    if (get().status !== "connected") {
      pushLog(set, "info", "Non connecté — commande ignorée");
      return;
    }
    try {
      await link.writeString(cmd);
      pushLog(set, "tx", cmd);
    } catch (e) {
      pushLog(set, "info", `Erreur écriture : ${markWriteError(e)}`);
    }
  },

  queryMoving: async () => {
    if (get().status !== "connected") return null;
    const { protocol } = hardwareContext();
    if (!protocol.queryMove) {
      pushLog(set, "info", "Requête « mouvement ? » non gérée par ce protocole");
      return null;
    }
    const cmd = protocol.queryMove();
    pushLog(set, "tx", cmd);
    try {
      const bytes = await link.requestBytes(cmd, 1, 400);
      const ch = String.fromCharCode(bytes[0]);
      const moving = ch === "+";
      pushLog(
        set,
        "info",
        `Q → ${ch === "+" ? "mouvement en cours (+)" : ch === "." ? "terminé (.)" : `réponse « ${ch} »`}`
      );
      return ch === "+" || ch === "." ? moving : null;
    } catch (e) {
      pushLog(set, "info", `Q : ${e instanceof Error ? e.message : "échec"}`);
      return null;
    }
  },

  queryPulseChannel: async (channel) => {
    if (get().status !== "connected") return null;
    const { protocol, servo } = hardwareContext();
    if (!protocol.queryPulse) {
      pushLog(set, "info", "Requête QP non gérée par ce protocole");
      return null;
    }
    const cmd = protocol.queryPulse(channel);
    pushLog(set, "tx", cmd);
    try {
      const bytes = await link.requestBytes(cmd, 1, 400);
      const us = bytes[0] * 10; // SSC-32U : 1 octet = µs/10
      // Conversion en angle logique : on retrouve la calibration du servo dont
      // ce canal dépend (sinon binding par défaut).
      const binding = bindingForChannel(channel) ?? { centerOffsetDeg: 0, invert: false };
      const deg = pulseUsToAngle(us, binding, servo);
      pushLog(set, "info", `QP ch${channel} → ${us} µs (≈ ${deg.toFixed(1)}°)`);
      return deg;
    } catch (e) {
      pushLog(set, "info", `QP ch${channel} : ${e instanceof Error ? e.message : "échec"}`);
      return null;
    }
  },

  sendStop: async (channel) => {
    const { protocol } = hardwareContext();
    if (!protocol.stop) {
      pushLog(set, "info", "Commande STOP non gérée par ce protocole");
      return;
    }
    await get().sendRaw(protocol.stop(channel));
  },

  importPoseFromRobot: async () => {
    if (get().status !== "connected") return;
    const { protocol, servo, electronics } = hardwareContext();
    if (!electronics) return;
    if (!protocol.queryPulse) {
      pushLog(set, "info", "Import impossible : ce protocole ne renvoie pas la position (QP)");
      useToastStore.getState().show("Import non supporté par ce protocole");
      return;
    }
    const pose = useHexapodStore.getState().pose.slice();
    let count = 0;
    let zero = 0; // réponses à 0 µs (couple coupé : pas d'impulsion émise)
    for (let id = 0; id < 18; id++) {
      const binding = electronics.bindings[id] ?? defaultBinding(id);
      if (binding.channel == null) continue;
      const cmd = protocol.queryPulse(binding.channel);
      pushLog(set, "tx", cmd);
      try {
        const bytes = await link.requestBytes(cmd, 1, 400);
        const us = bytes[0] * 10;
        if (us < 400) {
          // Canal non piloté (couple coupé) ou réponse implausible : on ignore.
          zero++;
          pushLog(set, "info", `QP ch${binding.channel} → ${us} µs ignoré (servo ${id})`);
          continue;
        }
        const deg = pulseUsToAngle(us, binding, servo);
        pose[id] = Math.round(deg * 10) / 10;
        pushLog(set, "info", `QP ch${binding.channel} → ${us} µs → servo ${id} ≈ ${pose[id].toFixed(1)}°`);
        count++;
      } catch (e) {
        pushLog(set, "info", `QP ch${binding.channel} : ${e instanceof Error ? e.message : "échec"}`);
      }
      await sleep(6);
    }
    if (count > 0) {
      useHexapodStore.getState().applyPose(pose);
      useToastStore.getState().show(`Pose importée du robot (${count} servo${count > 1 ? "s" : ""})`);
    } else if (zero > 0) {
      // Toutes les lectures à 0 µs : le SSC-32U n'émet plus d'impulsion → couple coupé.
      pushLog(set, "info", "Toutes les positions sont à 0 µs — le couple est coupé ? (QP ne lit que la position commandée)");
      useToastStore.getState().show("Positions à 0 — couple coupé ? Envoyez une pose d'abord.");
    } else {
      useToastStore.getState().show("Aucune position lue depuis le robot");
    }
  },
}));

// ── Miroir live : stream de la pose 3D vers le robot ─────────────────────────
// Abonnement UNIQUE au store hexapode, agnostique de la source (manuel, IK,
// séquenceur, salle d'exécution — tous écrivent dans `pose`). Throttle
// « trailing-edge » : jamais plus d'une trame par MIRROR_INTERVAL_MS, mais on
// envoie toujours la dernière pose connue (pas de saut perdu). Envoi groupé/
// silencieux via sendPoseLive. Inactif tant que liveMirror=false (coût nul).
const MIRROR_INTERVAL_MS = 40; // ≈ 25 Hz
let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
let mirrorPending = false;
let lastMirroredPose = useHexapodStore.getState().pose;
// Pose modifiée mais pas encore envoyée (mode « au relâchement » : on attend le
// pointerup pour n'envoyer que la position finale, sans saccades).
let mirrorDirty = false;

function flushMirror(): void {
  const s = useSerialStore.getState();
  if (!s.liveMirror || s.status !== "connected") {
    mirrorPending = false;
    return;
  }
  void s.sendPoseLive(useHexapodStore.getState().pose);
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    if (mirrorPending) {
      mirrorPending = false;
      flushMirror();
    }
  }, MIRROR_INTERVAL_MS);
}

function requestMirror(): void {
  const s = useSerialStore.getState();
  if (!s.liveMirror || s.status !== "connected") return;
  if (mirrorTimer != null) {
    mirrorPending = true; // une trame est en vol → on enverra la dernière au prochain tick
    return;
  }
  flushMirror();
}

useHexapodStore.subscribe((state) => {
  if (state.pose !== lastMirroredPose) {
    lastMirroredPose = state.pose;
    mirrorDirty = true;
    // Mode continu : on streame (throttlé). Mode « au relâchement » : on attend
    // le pointerup global (cf. listener ci-dessous), donc rien ici.
    if (!useSerialStore.getState().mirrorOnRelease) requestMirror();
  }
});

// Mode « au relâchement » : à la fin de tout geste souris, on envoie la position
// finale une seule fois (si elle a changé). Input-agnostique (drag de pied, arcs,
// sliders…). Le flag `mirrorDirty` évite d'émettre sur un simple clic sans effet.
if (typeof window !== "undefined") {
  window.addEventListener("pointerup", () => {
    const s = useSerialStore.getState();
    if (s.liveMirror && s.mirrorOnRelease && s.status === "connected" && mirrorDirty) {
      mirrorDirty = false;
      void s.sendPoseLive(useHexapodStore.getState().pose);
    }
  });
}

// ── Watchdog couple-off (P1) ─────────────────────────────────────────────────
// En mode Live, si plus AUCUNE trame n'est envoyée pendant WATCHDOG_MS (l'opérateur
// s'éloigne, l'UI est figée…), on coupe le couple pour ne pas laisser les servos
// forcer/chauffer sur leur dernière position. Réarmé à chaque envoi live réussi
// (cf. sendPoseLive), désarmé hors mode Live / hors connexion. Le couple se
// réengage tout seul au prochain mouvement 3D mirroré.
const WATCHDOG_MS = 90_000;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

function stopWatchdog(): void {
  if (watchdogTimer != null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function armWatchdog(): void {
  stopWatchdog();
  const s = useSerialStore.getState();
  if (!s.watchdogEnabled || !s.liveMirror || s.status !== "connected") return;
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    const cur = useSerialStore.getState();
    if (cur.watchdogEnabled && cur.liveMirror && cur.status === "connected") {
      pushLog((fn) => useSerialStore.setState(fn), "info", "Watchdog : inactivité — coupure du couple");
      void cur.releaseAll();
      useToastStore.getState().show("Couple coupé (inactivité)");
    }
  }, WATCHDOG_MS);
}

// ── Perte involontaire de la liaison (P1) ────────────────────────────────────
// Déclenché par SerialLink (débranchement USB, flux interrompu). On bascule en
// erreur « port perdu », on désarme le watchdog et on invite à reconnecter. Le
// couple ne peut PAS être coupé ici (le lien est mort) : le SSC-32U garde sa
// dernière position tant que l'alimentation servo (VS) reste présente.
function onLinkLost(reason: string): void {
  stopWatchdog();
  useSerialStore.setState({ status: "error", errorKind: "port-lost", errorMsg: reason });
  pushLog((fn) => useSerialStore.setState(fn), "info", `Liaison perdue : ${reason}. Cliquez « Reconnecter ».`);
  useToastStore.getState().show("Liaison robot perdue");
}

link.setOnLost(onLinkLost);
