import { WebSocketServer, WebSocket, RawData } from "ws";
import type { Server } from "http";
import jwt from "jsonwebtoken";

/**
 * Hub « écran lié » : relaie en temps réel la pose 3D entre les appareils d'un
 * même compte et arbitre la prise de contrôle du robot.
 *
 * - Une **room par utilisateur** (clé = userId du JWT). Aucun stockage SQLite :
 *   présence et verrou de contrôle sont éphémères, en mémoire.
 * - **Auth par premier message** : le client envoie `hello { token, deviceId, … }`
 *   dans les 5 s ; le token est vérifié avec le même secret que les routes REST.
 * - **Verrou unique** : un seul `controlHolderId` par room. Le **gardien** (hôte
 *   USB s'il existe, sinon le détenteur courant) accorde/refuse les demandes.
 * - Seul le détenteur du contrôle peut émettre des `pose` ; elles sont relayées
 *   aux autres appareils qui les rejouent (miroir 3D). L'hôte USB, en suiveur,
 *   renvoie au robot via son Mode Live (pipeline existant côté client).
 */

type Json = Record<string, unknown>;

interface DeviceConn {
  ws: WebSocket;
  userId: string;
  deviceId: string;
  deviceName: string;
  usbConnected: boolean;
  projectId: string | null;
  alive: boolean;
}

interface Room {
  devices: Map<string, DeviceConn>; // par deviceId
  controlHolderId: string | null;
}

const rooms = new Map<string, Room>(); // par userId
const HELLO_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 30000;

function send(ws: WebSocket, msg: Json): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket en cours de fermeture — ignoré */
    }
  }
}

/** Hôte USB de la room (premier appareil branché en USB), ou null. */
function hostIdOf(room: Room): string | null {
  for (const d of room.devices.values()) if (d.usbConnected) return d.deviceId;
  return null;
}

/** Gardien du verrou : l'hôte USB s'il existe, sinon le détenteur courant. */
function gatekeeperId(room: Room): string | null {
  return hostIdOf(room) ?? room.controlHolderId;
}

function broadcastPresence(room: Room): void {
  const devices = [...room.devices.values()].map((d) => ({
    id: d.deviceId,
    name: d.deviceName,
    usbConnected: d.usbConnected,
  }));
  const payload: Json = {
    type: "presence",
    devices,
    controlHolderId: room.controlHolderId,
    hostId: hostIdOf(room),
  };
  for (const d of room.devices.values()) send(d.ws, payload);
}

export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (ws: WebSocket) => {
    let conn: DeviceConn | null = null;

    // Ferme la connexion si aucun `hello` valide n'arrive à temps.
    const helloTimer = setTimeout(() => {
      if (!conn) {
        try {
          ws.close(4001, "hello timeout");
        } catch {
          /* déjà fermé */
        }
      }
    }, HELLO_TIMEOUT_MS);

    ws.on("message", (raw: RawData) => {
      let msg: Json;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const type = msg.type;

      // ── Phase d'authentification ──────────────────────────────────────
      if (!conn) {
        if (type !== "hello") return;
        const token = typeof msg.token === "string" ? msg.token : "";
        const secret = process.env.HEXAGRAM_JWT_SECRET;
        let userId: string;
        try {
          const payload = jwt.verify(token, secret as string) as { sub: string };
          userId = payload.sub;
        } catch {
          send(ws, { type: "error", message: "Token invalide" });
          try {
            ws.close(4002, "auth");
          } catch {
            /* déjà fermé */
          }
          return;
        }
        clearTimeout(helloTimer);
        const deviceId =
          typeof msg.deviceId === "string" && msg.deviceId
            ? msg.deviceId
            : `anon-${Math.random().toString(36).slice(2)}`;
        const deviceName =
          typeof msg.deviceName === "string" && msg.deviceName ? msg.deviceName : "Poste";
        conn = {
          ws,
          userId,
          deviceId,
          deviceName,
          usbConnected: msg.usbConnected === true,
          projectId: typeof msg.projectId === "string" ? msg.projectId : null,
          alive: true,
        };
        let room = rooms.get(userId);
        if (!room) {
          room = { devices: new Map(), controlHolderId: null };
          rooms.set(userId, room);
        }
        // Remplace une connexion précédente du même appareil (reconnexion / 2e onglet).
        const prev = room.devices.get(deviceId);
        if (prev && prev.ws !== ws) {
          try {
            prev.ws.close(4003, "replaced");
          } catch {
            /* déjà fermé */
          }
        }
        room.devices.set(deviceId, conn);
        // L'hôte USB est l'autorité sur SON robot : il prend la main dès qu'il
        // se connecte. Sinon, le premier arrivé pilote (miroir seul).
        if (conn.usbConnected) room.controlHolderId = deviceId;
        else if (!room.controlHolderId) room.controlHolderId = deviceId;
        broadcastPresence(room);
        return;
      }

      // ── Messages authentifiés ─────────────────────────────────────────
      const room = rooms.get(conn.userId);
      if (!room) return;

      switch (type) {
        case "pose": {
          // Seul le détenteur du contrôle peut piloter.
          if (room.controlHolderId !== conn.deviceId) return;
          const pose = msg.pose;
          if (!Array.isArray(pose)) return;
          const out: Json = { type: "pose", pose, fromDeviceId: conn.deviceId };
          for (const d of room.devices.values()) {
            if (d.deviceId !== conn.deviceId) send(d.ws, out);
          }
          return;
        }
        case "presence-update": {
          const wasUsb = conn.usbConnected;
          if (typeof msg.usbConnected === "boolean") conn.usbConnected = msg.usbConnected;
          if (typeof msg.projectId === "string") conn.projectId = msg.projectId;
          else if (msg.projectId === null) conn.projectId = null;
          if (typeof msg.deviceName === "string" && msg.deviceName) conn.deviceName = msg.deviceName;
          // L'hôte USB qui (ré)apparaît reprend la main sur SON robot.
          if (conn.usbConnected && !wasUsb) room.controlHolderId = conn.deviceId;
          broadcastPresence(room);
          return;
        }
        case "control:request": {
          const gk = gatekeeperId(room);
          if (!gk || gk === conn.deviceId) {
            // Aucun gardien (ou je le suis déjà) → accord direct.
            room.controlHolderId = conn.deviceId;
            send(conn.ws, { type: "control:granted" });
            broadcastPresence(room);
            return;
          }
          const gkConn = room.devices.get(gk);
          if (gkConn) {
            send(gkConn.ws, {
              type: "control:requested",
              fromDeviceId: conn.deviceId,
              fromName: conn.deviceName,
            });
          }
          return;
        }
        case "control:grant": {
          if (gatekeeperId(room) !== conn.deviceId) return;
          const to = typeof msg.toDeviceId === "string" ? msg.toDeviceId : null;
          if (!to || !room.devices.has(to)) return;
          room.controlHolderId = to;
          const target = room.devices.get(to);
          if (target) send(target.ws, { type: "control:granted" });
          broadcastPresence(room);
          return;
        }
        case "control:deny": {
          if (gatekeeperId(room) !== conn.deviceId) return;
          const to = typeof msg.toDeviceId === "string" ? msg.toDeviceId : null;
          const target = to ? room.devices.get(to) : null;
          if (target) send(target.ws, { type: "control:denied" });
          return;
        }
        case "control:revoke": {
          // Le gardien reprend la main.
          if (gatekeeperId(room) !== conn.deviceId) return;
          room.controlHolderId = conn.deviceId;
          broadcastPresence(room);
          return;
        }
        case "ping": {
          send(conn.ws, { type: "pong" });
          return;
        }
      }
    });

    ws.on("pong", () => {
      if (conn) conn.alive = true;
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (!conn) return;
      const room = rooms.get(conn.userId);
      if (!room) return;
      // Ne retire que si la connexion enregistrée est bien celle-ci (pas remplacée).
      if (room.devices.get(conn.deviceId)?.ws === ws) {
        room.devices.delete(conn.deviceId);
        // Le pilote part → réattribution : hôte USB s'il en reste un, sinon personne.
        if (room.controlHolderId === conn.deviceId) {
          room.controlHolderId = hostIdOf(room);
        }
      }
      if (room.devices.size === 0) rooms.delete(conn.userId);
      else broadcastPresence(room);
    });

    ws.on("error", () => {
      /* l'événement close suit et fait le nettoyage */
    });
  });

  // Heartbeat : termine les connexions mortes (onglet fermé brutalement, réseau coupé).
  const interval = setInterval(() => {
    for (const room of rooms.values()) {
      for (const d of room.devices.values()) {
        if (!d.alive) {
          try {
            d.ws.terminate();
          } catch {
            /* déjà mort */
          }
          continue;
        }
        d.alive = false;
        try {
          d.ws.ping();
        } catch {
          /* ignoré */
        }
      }
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(interval));
}
