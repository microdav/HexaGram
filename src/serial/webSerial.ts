// Fin wrapper autour de la Web Serial API (navigator.serial).
//
// On déclare nos propres interfaces locales (et non les types globaux Serial*)
// pour éviter toute collision avec la lib DOM selon la version de TS, tout en
// restant type-safe côté appelant.

interface SerialPortInfoLike {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfoLike;
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
  // navigator.serial est un EventTarget : émet "disconnect" au débranchement USB.
  addEventListener?(type: string, listener: (e: Event) => void): void;
  removeEventListener?(type: string, listener: (e: Event) => void): void;
}

function getSerial(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  const n = navigator as unknown as { serial?: SerialLike };
  return n.serial ?? null;
}

export function isWebSerialSupported(): boolean {
  return getSerial() !== null;
}

/** Étiquette lisible pour un port (VID:PID si disponible). */
function describePort(port: SerialPortLike): string {
  const info = port.getInfo();
  if (info.usbVendorId != null && info.usbProductId != null) {
    const v = info.usbVendorId.toString(16).padStart(4, "0");
    const p = info.usbProductId.toString(16).padStart(4, "0");
    return `USB ${v}:${p}`;
  }
  return "Port série";
}

/**
 * Liaison série ouverte. Encapsule le port, le writer et l'encodage texte.
 * Une seule instance est utilisée par l'application (cf. useSerialStore).
 *
 * Robustesse (P1) : détecte la perte involontaire du port (débranchement USB,
 * flux interrompu) et la signale via `onLost`, tout en conservant le dernier
 * port pour permettre une reconnexion sans re-sélection manuelle.
 */
export class SerialLink {
  private port: SerialPortLike | null = null;
  /** Dernier port ouvert — réutilisé tel quel par reconnect() après un débranchement. */
  private lastPort: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private onLostCb: ((reason: string) => void) | null = null;
  private disconnectHandler: ((e: Event) => void) | null = null;
  /** Vrai pendant un disconnect() volontaire — empêche de signaler une perte. */
  private closing = false;
  /** Garde-fou : onLost ne se déclenche qu'une fois par connexion. */
  private lostFired = false;
  label: string | null = null;

  get connected(): boolean {
    return this.port !== null && this.writer !== null;
  }

  /** Callback déclenché en cas de perte INVOLONTAIRE de la liaison (débranchement…). */
  setOnLost(cb: (reason: string) => void): void {
    this.onLostCb = cb;
  }

  /** Demande un port à l'utilisateur (geste requis) puis l'ouvre. */
  async connect(baudRate: number): Promise<string> {
    const serial = getSerial();
    if (!serial) throw new Error("Web Serial non supporté par ce navigateur");
    const port = await serial.requestPort();
    return this.openPort(port, baudRate);
  }

  /**
   * Rouvre la liaison SANS re-sélection manuelle : on tente d'abord le dernier
   * port utilisé (il réapparaît tel quel après un rebranchement USB), puis un
   * port déjà autorisé, et en dernier recours on redemande à l'utilisateur (le
   * clic sur « Reconnecter » fournit le geste requis par l'API).
   */
  async reconnect(baudRate: number): Promise<string> {
    const serial = getSerial();
    if (!serial) throw new Error("Web Serial non supporté par ce navigateur");
    let port = this.lastPort;
    if (port) {
      // Le port a pu rester « ouvert » côté objet : on le referme avant de rouvrir.
      try {
        await port.close();
      } catch {
        /* déjà fermé */
      }
    } else {
      const ports = await serial.getPorts();
      port = ports[0] ?? null;
    }
    if (!port) port = await serial.requestPort();
    return this.openPort(port, baudRate);
  }

  /** Ouvre un port donné et arme la liaison (chemin commun connect/reconnect). */
  private async openPort(port: SerialPortLike, baudRate: number): Promise<string> {
    await port.open({ baudRate });
    if (!port.writable) {
      await port.close().catch(() => {});
      throw new Error("Le port ouvert n'est pas accessible en écriture");
    }
    this.port = port;
    this.lastPort = port;
    this.writer = port.writable.getWriter();
    this.closing = false;
    this.lostFired = false;
    // Beaucoup d'adaptateurs FTDI (cas SSC-32U) n'activent la liaison que si
    // DTR/RTS sont assertés — le logiciel d'origine le fait. Sans ça, l'envoi
    // peut sembler partir mais la carte ne répond jamais (RX muet).
    try {
      await port.setSignals?.({ dataTerminalReady: true, requestToSend: true });
    } catch {
      /* setSignals non supporté / refusé — on continue sans bloquer */
    }
    this.label = describePort(port);
    this.registerDisconnectListener();
    return this.label;
  }

  /** Écrit une commande texte (déjà formatée par le protocole). */
  async writeString(cmd: string): Promise<void> {
    if (!this.writer) throw new Error("Liaison série fermée");
    await this.writer.write(this.encoder.encode(cmd));
  }

  /**
   * Démarre la boucle de lecture du port. `onBytes` reçoit chaque fragment
   * brut (Uint8Array) tel que renvoyé par la carte — le décodage texte / hex
   * est laissé à l'appelant pour un diagnostic fidèle. Tourne en tâche de fond
   * jusqu'à la déconnexion. Une fin de flux ou une erreur survenue HORS
   * déconnexion volontaire est traitée comme une perte de liaison.
   */
  startReader(onBytes: (bytes: Uint8Array) => void): void {
    if (!this.port?.readable || this.reader) return;
    const reader = this.port.readable.getReader();
    this.reader = reader;
    (async () => {
      let lost = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            lost = !this.closing;
            break;
          }
          if (value && value.length) onBytes(value);
        }
      } catch {
        // Lecture interrompue : déconnexion volontaire (closing) ou perte réelle.
        lost = !this.closing;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* reader déjà libéré */
        }
        if (this.reader === reader) this.reader = null;
        if (lost) this.handleLost("Liaison série interrompue");
      }
    })();
  }

  decode(bytes: Uint8Array): string {
    return this.decoder.decode(bytes);
  }

  /** Déconnexion VOLONTAIRE : ferme tout proprement, sans signaler de perte. */
  async disconnect(): Promise<void> {
    this.closing = true;
    this.removeDisconnectListener();
    // Annule la lecture en premier pour débloquer la boucle read().
    try {
      await this.reader?.cancel();
    } catch {
      /* reader déjà annulé */
    }
    this.reader = null;
    try {
      this.writer?.releaseLock();
    } catch {
      /* writer déjà libéré */
    }
    this.writer = null;
    try {
      await this.port?.close();
    } catch {
      /* port déjà fermé */
    }
    this.port = null;
    this.label = null;
    this.closing = false;
    // lastPort est conservé : permet une reconnexion rapide ultérieure.
  }

  // ── Détection de perte involontaire ────────────────────────────────────────

  private registerDisconnectListener(): void {
    const serial = getSerial();
    if (!serial?.addEventListener) return;
    this.removeDisconnectListener();
    this.disconnectHandler = (e: Event) => {
      const ev = e as unknown as { target?: unknown; port?: unknown };
      const p = ev.port ?? ev.target;
      // Notre port — ou un événement non identifiable alors qu'on est connecté.
      if (p === this.port || p === this.lastPort || p == null) {
        this.handleLost("Port USB déconnecté");
      }
    };
    serial.addEventListener("disconnect", this.disconnectHandler);
  }

  private removeDisconnectListener(): void {
    const serial = getSerial();
    if (this.disconnectHandler && serial?.removeEventListener) {
      serial.removeEventListener("disconnect", this.disconnectHandler);
    }
    this.disconnectHandler = null;
  }

  /**
   * Traite une perte involontaire : libère les flux (le port est déjà mort, on
   * ne tente pas de le fermer), conserve lastPort pour la reconnexion, puis
   * notifie l'appelant. Idempotent sur une même connexion (lostFired).
   */
  private handleLost(reason: string): void {
    if (this.closing || this.lostFired) return;
    this.lostFired = true;
    try {
      this.writer?.releaseLock();
    } catch {
      /* writer déjà libéré */
    }
    this.writer = null;
    try {
      void this.reader?.cancel();
    } catch {
      /* reader déjà annulé */
    }
    this.reader = null;
    this.port = null; // connected → false ; lastPort conservé pour reconnect.
    this.removeDisconnectListener();
    this.onLostCb?.(reason);
  }
}
