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
 */
export class SerialLink {
  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  label: string | null = null;

  get connected(): boolean {
    return this.port !== null && this.writer !== null;
  }

  /** Demande un port à l'utilisateur (geste requis) puis l'ouvre. */
  async connect(baudRate: number): Promise<string> {
    const serial = getSerial();
    if (!serial) throw new Error("Web Serial non supporté par ce navigateur");
    const port = await serial.requestPort();
    await port.open({ baudRate });
    if (!port.writable) {
      await port.close().catch(() => {});
      throw new Error("Le port ouvert n'est pas accessible en écriture");
    }
    this.port = port;
    this.writer = port.writable.getWriter();
    // Beaucoup d'adaptateurs FTDI (cas SSC-32U) n'activent la liaison que si
    // DTR/RTS sont assertés — le logiciel d'origine le fait. Sans ça, l'envoi
    // peut sembler partir mais la carte ne répond jamais (RX muet).
    try {
      await port.setSignals?.({ dataTerminalReady: true, requestToSend: true });
    } catch {
      /* setSignals non supporté / refusé — on continue sans bloquer */
    }
    this.label = describePort(port);
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
   * jusqu'à la déconnexion.
   */
  startReader(onBytes: (bytes: Uint8Array) => void): void {
    if (!this.port?.readable || this.reader) return;
    const reader = this.port.readable.getReader();
    this.reader = reader;
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) onBytes(value);
        }
      } catch {
        /* lecture annulée (déconnexion) ou port fermé */
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* reader déjà libéré */
        }
      }
    })();
  }

  decode(bytes: Uint8Array): string {
    return this.decoder.decode(bytes);
  }

  async disconnect(): Promise<void> {
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
  }
}
