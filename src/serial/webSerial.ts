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
  private encoder = new TextEncoder();
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
    this.label = describePort(port);
    return this.label;
  }

  /** Écrit une commande texte (déjà formatée par le protocole). */
  async writeString(cmd: string): Promise<void> {
    if (!this.writer) throw new Error("Liaison série fermée");
    await this.writer.write(this.encoder.encode(cmd));
  }

  async disconnect(): Promise<void> {
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
