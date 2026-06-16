import { create } from "zustand";
import { useHexapodStore } from "./useHexapodStore";
import { useSerialStore } from "./useSerialStore";
import { useProjectStore } from "./useProjectStore";
import { useToastStore } from "./useToastStore";

/**
 * Mode « écran lié » : synchronisation temps réel de la pose 3D entre les
 * appareils d'un même compte, via le WebSocket `/api/ws` (cf. server/realtime.ts).
 *
 * - Chaque navigateur = un **appareil** (`deviceId` persistant + nom éditable).
 * - Un seul **pilote** (détenteur du contrôle) à la fois ; les autres sont
 *   suiveurs et rejouent la pose reçue (`applyPose`). L'hôte USB, en suiveur,
 *   renvoie au robot via son Mode Live (souscription de useSerialStore).
 * - Garde-fous : prise de contrôle sur **demande** au gardien (hôte USB), ou
 *   **auto-accordée** si l'appareil figure dans `preferences.linkedScreen.autoGrant`.
 *
 * Sécurité : ce module ne synchronise QUE la pose 3D. Le robot ne bouge que si
 * l'hôte a activé le Mode Live ; l'arrêt d'urgence reste local à l'hôte.
 */

const ENABLED_KEY = "hexagram.link.enabled";
const DEVICE_ID_KEY = "hexagram.deviceId";
const DEVICE_NAME_KEY = "hexagram.deviceName";
const TOKEN_KEY = "hexagram.token";
const BROADCAST_INTERVAL_MS = 40; // ≈ 25 Hz, aligné sur le miroir live série
const RECONNECT_DELAY_MS = 2000;

export interface LinkDevice {
  id: string;
  name: string;
  usbConnected: boolean;
}

export type LinkStatus = "disconnected" | "connecting" | "connected";

interface IncomingRequest {
  fromDeviceId: string;
  fromName: string;
}

interface LinkState {
  enabled: boolean;
  deviceId: string;
  deviceName: string;
  status: LinkStatus;
  /** Tous les appareils en ligne de la room (y compris soi). */
  devices: LinkDevice[];
  controlHolderId: string | null;
  hostId: string | null;
  /** Demande entrante quand je suis gardien (à accepter/refuser). */
  pendingRequest: IncomingRequest | null;
  /** Ma demande de contrôle sortante est en attente de réponse. */
  requestPending: boolean;

  setEnabled: (v: boolean) => void;
  setDeviceName: (name: string) => void;
  connect: () => void;
  disconnect: () => void;
  requestControl: () => void;
  grantControl: (deviceId: string) => void;
  denyControl: (deviceId: string) => void;
  revokeControl: () => void;
}

// ── Identité de l'appareil (persistée par navigateur) ──────────────────────
function getOrCreateDeviceId(): string {
  let id = "";
  try {
    id = localStorage.getItem(DEVICE_ID_KEY) ?? "";
  } catch {
    /* localStorage indisponible */
  }
  if (!id) {
    id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      /* ignoré */
    }
  }
  return id;
}

function readDeviceName(deviceId: string): string {
  try {
    const n = localStorage.getItem(DEVICE_NAME_KEY);
    if (n) return n;
  } catch {
    /* ignoré */
  }
  return `Poste-${deviceId.slice(0, 4)}`;
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/ws`;
}

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// ── État module (hors store : socket, timers, drapeaux) ─────────────────────
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;
/** Vrai pendant l'application d'une pose reçue → empêche de la réémettre. */
let applyingRemote = false;

function sendRaw(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket en cours de fermeture */
    }
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    const s = useLinkStore.getState();
    if (s.enabled && getToken()) s.connect();
  }, RECONNECT_DELAY_MS);
}

function handleMessage(data: string): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  const me = useLinkStore.getState().deviceId;

  switch (msg.type) {
    case "presence": {
      const prevHolder = useLinkStore.getState().controlHolderId;
      const holder = (msg.controlHolderId as string | null) ?? null;
      useLinkStore.setState({
        devices: Array.isArray(msg.devices) ? (msg.devices as LinkDevice[]) : [],
        controlHolderId: holder,
        hostId: (msg.hostId as string | null) ?? null,
      });
      if (holder === me) useLinkStore.setState({ requestPending: false });
      // Toast informatif quand on me retire le contrôle.
      if (prevHolder === me && holder !== me) {
        useToastStore.getState().show("Contrôle repris par un autre appareil");
      }
      break;
    }
    case "pose": {
      const pose = msg.pose;
      if (!Array.isArray(pose)) break;
      applyingRemote = true;
      try {
        useHexapodStore.getState().applyPose(pose as number[]);
      } finally {
        applyingRemote = false;
      }
      break;
    }
    case "control:requested": {
      const from: IncomingRequest = {
        fromDeviceId: String(msg.fromDeviceId ?? ""),
        fromName: String(msg.fromName ?? "Appareil"),
      };
      if (!from.fromDeviceId) break;
      // Auto-accord si l'appareil est dans la liste autorisée du projet.
      const auto =
        useProjectStore.getState().activeProject?.preferences.linkedScreen?.autoGrant ?? [];
      if (auto.some((d) => d.id === from.fromDeviceId)) {
        useLinkStore.getState().grantControl(from.fromDeviceId);
        useToastStore.getState().show(`Contrôle accordé à ${from.fromName} (auto)`);
      } else {
        useLinkStore.setState({ pendingRequest: from });
      }
      break;
    }
    case "control:granted": {
      useLinkStore.setState({ requestPending: false });
      useToastStore.getState().show("Vous avez le contrôle du robot");
      break;
    }
    case "control:denied": {
      useLinkStore.setState({ requestPending: false });
      useToastStore.getState().show("Demande de contrôle refusée");
      break;
    }
    case "error": {
      if (typeof msg.message === "string") useToastStore.getState().show(msg.message);
      break;
    }
  }
}

export const useLinkStore = create<LinkState>((set, get) => {
  const deviceId = getOrCreateDeviceId();
  return {
    enabled: readEnabled(),
    deviceId,
    deviceName: readDeviceName(deviceId),
    status: "disconnected",
    devices: [],
    controlHolderId: null,
    hostId: null,
    pendingRequest: null,
    requestPending: false,

    setEnabled: (v) => {
      try {
        localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
      } catch {
        /* ignoré */
      }
      set({ enabled: v });
      if (v) get().connect();
      else get().disconnect();
    },

    setDeviceName: (name) => {
      const clean = name.trim().slice(0, 40) || `Poste-${get().deviceId.slice(0, 4)}`;
      try {
        localStorage.setItem(DEVICE_NAME_KEY, clean);
      } catch {
        /* ignoré */
      }
      set({ deviceName: clean });
      // Propage le nouveau nom aux autres appareils.
      if (get().status === "connected") sendRaw({ type: "presence-update", deviceName: clean });
    },

    connect: () => {
      if (!get().enabled) return;
      const token = getToken();
      if (!token) return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      intentionalClose = false;
      set({ status: "connecting" });
      let sock: WebSocket;
      try {
        sock = new WebSocket(wsUrl());
      } catch {
        set({ status: "disconnected" });
        scheduleReconnect();
        return;
      }
      ws = sock;
      sock.onopen = () => {
        sendRaw({
          type: "hello",
          token: getToken(),
          deviceId: get().deviceId,
          deviceName: get().deviceName,
          usbConnected: useSerialStore.getState().status === "connected",
          projectId: useProjectStore.getState().activeProjectId,
        });
        set({ status: "connected" });
      };
      sock.onmessage = (ev) => handleMessage(typeof ev.data === "string" ? ev.data : "");
      sock.onclose = () => {
        if (ws === sock) ws = null;
        set({
          status: "disconnected",
          devices: [],
          controlHolderId: null,
          hostId: null,
          pendingRequest: null,
          requestPending: false,
        });
        if (!intentionalClose && get().enabled && getToken()) scheduleReconnect();
      };
      sock.onerror = () => {
        /* l'événement close suit */
      };
    },

    disconnect: () => {
      intentionalClose = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          /* déjà fermé */
        }
        ws = null;
      }
      set({
        status: "disconnected",
        devices: [],
        controlHolderId: null,
        hostId: null,
        pendingRequest: null,
        requestPending: false,
      });
    },

    requestControl: () => {
      if (get().status !== "connected") return;
      set({ requestPending: true });
      sendRaw({ type: "control:request" });
    },

    grantControl: (id) => {
      sendRaw({ type: "control:grant", toDeviceId: id });
      if (get().pendingRequest?.fromDeviceId === id) set({ pendingRequest: null });
    },

    denyControl: (id) => {
      sendRaw({ type: "control:deny", toDeviceId: id });
      if (get().pendingRequest?.fromDeviceId === id) set({ pendingRequest: null });
    },

    revokeControl: () => {
      sendRaw({ type: "control:revoke" });
    },
  };
});

// ── Émission de la pose (throttlée) quand je suis le pilote ────────────────
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
let broadcastPending = false;
let lastBroadcastPose = useHexapodStore.getState().pose;

function canBroadcast(): boolean {
  const s = useLinkStore.getState();
  return s.enabled && s.status === "connected" && s.controlHolderId === s.deviceId;
}

function flushBroadcast(): void {
  if (!canBroadcast()) {
    broadcastPending = false;
    return;
  }
  sendRaw({ type: "pose", pose: useHexapodStore.getState().pose });
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (broadcastPending) {
      broadcastPending = false;
      flushBroadcast();
    }
  }, BROADCAST_INTERVAL_MS);
}

function requestBroadcast(): void {
  if (!canBroadcast()) return;
  if (broadcastTimer != null) {
    broadcastPending = true; // trame en vol → on enverra la dernière au prochain tick
    return;
  }
  flushBroadcast();
}

useHexapodStore.subscribe((state) => {
  if (state.pose === lastBroadcastPose) return;
  lastBroadcastPose = state.pose;
  if (applyingRemote) return; // ne pas réémettre une pose reçue d'un autre appareil
  requestBroadcast();
});

// ── Présence USB : informe la room quand la liaison série change ───────────
let lastUsb = useSerialStore.getState().status === "connected";
useSerialStore.subscribe((state) => {
  const usb = state.status === "connected";
  if (usb === lastUsb) return;
  lastUsb = usb;
  if (useLinkStore.getState().status === "connected") {
    sendRaw({
      type: "presence-update",
      usbConnected: usb,
      projectId: useProjectStore.getState().activeProjectId,
    });
  }
});
