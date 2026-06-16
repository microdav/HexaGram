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
  /** Requête en attente d'une réponse RX (corrélation requête → octets, cf. requestBytes). */
  private pending: {
    count: number;
    buf: number[];
    resolve: (b: Uint8Array) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
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

  /**
   * Rouvre un port DÉJÀ autorisé SANS geste utilisateur — pour la reconnexion
   * automatique après un rechargement de page (`navigator.serial.getPorts()`
   * renvoie les ports déjà autorisés ; `open()` ne requiert pas de geste). Ne
   * redemande JAMAIS de port (pas de `requestPort` ici) : renvoie `null` si aucun
   * port autorisé n'est disponible, plutôt que d'échouer faute de geste.
   */
  async reopenAuthorized(baudRate: number): Promise<string | null> {
    const serial = getSerial();
    if (!serial) return null;
    let port = this.lastPort;
    if (!port) {
      const ports = await serial.getPorts();
      port = ports[0] ?? null;
    }
    if (!port) return null;
    // Le port peut être resté « ouvert » côté objet (lastPort) : on le referme.
    try {
      await port.close();
    } catch {
      /* pas ouvert / déjà fermé */
    }
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
   * Écrit une commande puis attend `count` octets en réponse — corrélation
   * requête → réponse pour les commandes de lecture (Q, QP…). Les octets restent
   * journalisés par startReader (la console reflète tout). Rejette après
   * `timeoutMs` sans réponse, ou si une autre requête est déjà en cours.
   */
  async requestBytes(cmd: string, count: number, timeoutMs = 500): Promise<Uint8Array> {
    if (!this.writer) throw new Error("Liaison série fermée");
    if (this.pending) throw new Error("Une requête est déjà en cours");
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer === timer) this.pending = null;
        reject(new Error("Pas de réponse (délai dépassé)"));
      }, timeoutMs);
      this.pending = { count, buf: [], resolve, reject, timer };
      this.writer!.write(this.encoder.encode(cmd)).catch((e) => {
        if (this.pending?.timer === timer) {
          clearTimeout(timer);
          this.pending = null;
        }
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  /** Distribue les octets reçus à une requête en attente (cf. requestBytes). */
  private feedPending(value: Uint8Array): void {
    const p = this.pending;
    if (!p) return;
    for (const b of value) p.buf.push(b);
    if (p.buf.length >= p.count) {
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve(new Uint8Array(p.buf.slice(0, p.count)));
    }
  }

  /** Rejette une requête en attente (déconnexion / perte de liaison). */
  private rejectPending(reason: string): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(new Error(reason));
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
    void this.readLoop(onBytes);
  }

  /**
   * Boucle de lecture résiliente (motif canonique Web Serial). Une erreur de
   * lecture NON fatale (framing/parité/overrun — fréquente sur les octets
   * binaires à bas débit, ex. réponse `QP` à 9600 bauds) erronne le flux courant
   * mais laisse `port.readable` valide : on ré-acquiert alors un reader et on
   * continue, AU LIEU de déclarer la liaison perdue. Seul `port.readable` qui
   * devient null (débranchement réel) — ou l'événement `disconnect` — signale une
   * perte. Un garde-fou borne les redémarrages stériles (anti-boucle).
   */
  private async readLoop(onBytes: (bytes: Uint8Array) => void): Promise<void> {
    let emptyRestarts = 0;
    while (this.port?.readable && !this.closing) {
      const reader = this.port.readable.getReader();
      this.reader = reader;
      let gotData = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) {
            gotData = true;
            onBytes(value);
            this.feedPending(value);
          }
        }
      } catch {
        // Erreur de lecture potentiellement récupérable : la boucle ré-acquiert
        // un reader si le port reste lisible (vérifié par la condition du while).
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* reader déjà libéré */
        }
        if (this.reader === reader) this.reader = null;
      }
      if (this.closing) break;
      // Flux terminé/erroné mais port encore lisible → erreur récupérable : on
      // réessaie. Garde-fou : trop de redémarrages sans aucune donnée = perte.
      emptyRestarts = gotData ? 0 : emptyRestarts + 1;
      if (emptyRestarts > 20) break;
    }
    if (!this.closing) this.handleLost("Liaison série interrompue");
  }

  decode(bytes: Uint8Array): string {
    return this.decoder.decode(bytes);
  }

  /** Déconnexion VOLONTAIRE : ferme tout proprement, sans signaler de perte. */
  async disconnect(): Promise<void> {
    this.closing = true;
    this.rejectPending("Liaison fermée");
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
    this.rejectPending(reason);
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
