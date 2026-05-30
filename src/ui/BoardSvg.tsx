// Illustrations SVG originales des cartes électroniques (aucune image tierce).
//
//  - BoardSvg : illustration paramétrique d'un PCB, dérivée des specs (ratio
//    physique, connecteurs selon les interfaces, headers selon le nombre de
//    canaux/GPIO, couleur selon la marque). Utilisée dans les fiches Matériel.
//  - Ssc32uSchematic : schéma annoté de la SSC-32U (bancs, VS1/VS2/VL,
//    cavaliers, USB, XBee) pour l'aide au branchement.

interface PcbStyle {
  pcb: string;
  silk: string;
}

const PCB_COLORS: Record<string, PcbStyle> = {
  Arduino: { pcb: "#00838f", silk: "#e6f7f8" },
  Espressif: { pcb: "#2a2a2a", silk: "#f3c9c9" },
  "Raspberry Pi": { pcb: "#2f7d4f", silk: "#eafff0" },
  PJRC: { pcb: "#1f6f43", silk: "#eafff0" },
  STMicroelectronics: { pcb: "#0b3d91", silk: "#e6ecff" },
  Lynxmotion: { pcb: "#7c1322", silk: "#ffe1e6" },
  Pololu: { pcb: "#8a1f2b", silk: "#ffe1e6" },
  Adafruit: { pcb: "#1b1b1b", silk: "#d8d8d8" },
  Robotis: { pcb: "#2b2b2b", silk: "#dcdcdc" },
  Générique: { pcb: "#2b5c87", silk: "#e6f0fa" },
};

function pcbOf(brand: string): PcbStyle {
  return PCB_COLORS[brand] ?? { pcb: "#34506b", silk: "#e6e8ec" };
}

function hasIface(ifaces: string[], kw: string): boolean {
  return ifaces.some((i) => i.toLowerCase().includes(kw));
}

const PIN_GOLD = "#e3b34a";
const HEADER_BG = "#101216";
const USB_SILVER = "#aab0bb";

interface BoardSvgProps {
  brand: string;
  model: string;
  dimensionsMm: { l: number; w: number; h: number };
  interfaces: string[];
  /** Contrôleurs : nombre de canaux servo. */
  channels?: number;
  /** Électronique de commande : nombre de GPIO. */
  gpio?: number;
  width?: number;
  className?: string;
}

/** Rangée de pastilles dorées (header) sur fond sombre. */
function PinStrip({
  x,
  y,
  w,
  count,
  rows = 1,
}: {
  x: number;
  y: number;
  w: number;
  count: number;
  rows?: number;
}) {
  const perRow = Math.ceil(count / rows);
  const gap = w / perRow;
  const r = Math.max(1.1, Math.min(2.2, gap * 0.28));
  const stripH = rows * (r * 2 + 3) + 2;
  const pads: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    pads.push(
      <circle
        key={i}
        cx={x + gap * (col + 0.5)}
        cy={y + 4 + row * (r * 2 + 3) + r}
        r={r}
        fill={PIN_GOLD}
      />
    );
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={stripH} rx={2} fill={HEADER_BG} />
      {pads}
    </g>
  );
}

export function BoardSvg({
  brand,
  model,
  dimensionsMm,
  interfaces,
  channels,
  gpio,
  width = 220,
  className,
}: BoardSvgProps) {
  const { pcb, silk } = pcbOf(brand);
  const wireless = hasIface(interfaces, "wifi") || hasIface(interfaces, "ble") || hasIface(interfaces, "bluetooth");
  const usb = hasIface(interfaces, "usb");

  // Géométrie : ratio réel borné pour rester lisible.
  const ratio = Math.max(0.32, Math.min(0.82, dimensionsMm.w / dimensionsMm.l || 0.5));
  const VBW = 240;
  const bx = 12;
  const bw = VBW - bx * 2;
  const bh = Math.round(bw * ratio);
  const by = 12;
  const VBH = bh + by * 2;

  // Headers : contrôleur = bancs de canaux en bas ; carte = GPIO haut + bas.
  const isController = channels != null;
  const displayCount = isController
    ? Math.min(channels ?? 0, 32)
    : Math.min(gpio ?? 0, 40);

  return (
    <svg
      viewBox={`0 0 ${VBW} ${VBH}`}
      width={width}
      className={className ? `board-svg ${className}` : "board-svg"}
      role="img"
      aria-label={`Illustration ${brand} ${model}`}
    >
      {/* PCB */}
      <rect x={bx} y={by} width={bw} height={bh} rx={9} fill={pcb} stroke="rgba(0,0,0,0.45)" strokeWidth={1} />
      {/* Trous de fixation */}
      {[
        [bx + 8, by + 8],
        [bx + bw - 8, by + 8],
        [bx + 8, by + bh - 8],
        [bx + bw - 8, by + bh - 8],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={2.6} fill="rgba(0,0,0,0.5)" stroke={silk} strokeOpacity={0.5} strokeWidth={0.6} />
      ))}

      {/* Connecteur USB (bord gauche) */}
      {usb && (
        <g>
          <rect x={bx - 8} y={by + bh / 2 - 9} width={12} height={18} rx={2} fill={USB_SILVER} />
          <rect x={bx - 4} y={by + bh / 2 - 6} width={8} height={12} rx={1} fill="#5b606b" />
        </g>
      )}

      {/* Puce principale (MCU) */}
      <rect
        x={bx + bw * 0.42}
        y={by + bh * 0.3}
        width={bw * 0.22}
        height={bh * 0.34}
        rx={2}
        fill="#0c0d10"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={0.6}
      />
      <circle cx={bx + bw * 0.45} cy={by + bh * 0.34} r={1.4} fill="rgba(255,255,255,0.18)" />

      {/* Antenne sans-fil (coin haut droit) */}
      {wireless && (
        <g stroke={silk} strokeOpacity={0.85} fill="none" strokeWidth={1.2}>
          <path d={`M ${bx + bw - 26} ${by + 10} h 16 l -8 10 z`} fill={silk} fillOpacity={0.18} stroke="none" />
          <path d={`M ${bx + bw - 20} ${by + 6} a 8 8 0 0 1 8 0`} />
          <path d={`M ${bx + bw - 23} ${by + 3} a 12 12 0 0 1 14 0`} />
        </g>
      )}

      {/* Headers */}
      {isController ? (
        <PinStrip
          x={bx + 8}
          y={by + bh - (displayCount > 16 ? 20 : 12)}
          w={bw - 16}
          count={displayCount}
          rows={displayCount > 16 ? 2 : 1}
        />
      ) : (
        displayCount > 0 && (
          <>
            <PinStrip x={bx + 8} y={by + 5} w={bw - 16} count={Math.ceil(displayCount / 2)} />
            <PinStrip x={bx + 8} y={by + bh - 11} w={bw - 16} count={Math.floor(displayCount / 2)} />
          </>
        )
      )}

      {/* Sérigraphie */}
      <text x={bx + 8} y={by + bh / 2 - 2} fontSize={11} fontWeight={700} fill={silk}>
        {brand}
      </text>
      <text x={bx + 8} y={by + bh / 2 + 10} fontSize={9} fill={silk} fillOpacity={0.85}>
        {model}
      </text>
    </svg>
  );
}

// ── Schéma annoté SSC-32U (aide au branchement) ──────────────────────────────

const SSC_RED = "#7c1322";
const SSC_SILK = "#ffe1e6";

function Bank({ x, label }: { x: number; label: string }) {
  // Banc de 8 connecteurs servo (3 broches chacun), avec étiquette.
  return (
    <g>
      <rect x={x} y={28} width={62} height={20} rx={2} fill={HEADER_BG} />
      {Array.from({ length: 8 }, (_, i) => (
        <g key={i}>
          {[0, 1, 2].map((p) => (
            <circle key={p} cx={x + 6 + i * 7} cy={34 + p * 5} r={1.3} fill={PIN_GOLD} />
          ))}
        </g>
      ))}
      <text x={x + 31} y={24} fontSize={8} textAnchor="middle" fill={SSC_SILK}>
        {label}
      </text>
    </g>
  );
}

function Terminal({ x, label }: { x: number; label: string }) {
  // Bornier à vis VSx / VL avec + et −.
  return (
    <g>
      <rect x={x} y={132} width={44} height={26} rx={3} fill="#16361f" stroke="#2f7d4f" strokeWidth={1} />
      <circle cx={x + 13} cy={145} r={5} fill="#0d0d0d" stroke="#cfcfcf" strokeWidth={0.8} />
      <circle cx={x + 31} cy={145} r={5} fill="#0d0d0d" stroke="#cfcfcf" strokeWidth={0.8} />
      <text x={x + 13} y={148} fontSize={7} textAnchor="middle" fill="#9fe6b5">+</text>
      <text x={x + 31} y={148} fontSize={8} textAnchor="middle" fill="#9fe6b5">−</text>
      <text x={x + 22} y={170} fontSize={9} fontWeight={700} textAnchor="middle" fill={SSC_SILK}>
        {label}
      </text>
    </g>
  );
}

function Jumper({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={14} height={8} rx={1.5} fill="#f5c518" />
      <text x={x + 7} y={y - 2} fontSize={7} textAnchor="middle" fill={SSC_SILK}>
        {label}
      </text>
    </g>
  );
}

export function Ssc32uSchematic({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 360 200"
      width="100%"
      className={className ? `board-svg ${className}` : "board-svg"}
      role="img"
      aria-label="Schéma annoté de la carte SSC-32U : bancs servo, alimentations VS1/VS2/VL, cavaliers, USB et XBee"
    >
      <rect x={6} y={6} width={348} height={188} rx={10} fill={SSC_RED} stroke="rgba(0,0,0,0.45)" />
      <text x={16} y={20} fontSize={11} fontWeight={700} fill={SSC_SILK}>Lynxmotion SSC-32U</text>

      {/* Connecteur USB (bord gauche) */}
      <rect x={-2} y={92} width={14} height={20} rx={2} fill={USB_SILVER} />
      <text x={20} y={106} fontSize={8} fill={SSC_SILK}>USB</text>

      {/* Socket XBee (sans-fil) */}
      <rect x={300} y={92} width={46} height={34} rx={3} fill="#0c0d10" stroke="rgba(255,255,255,0.15)" />
      <text x={323} y={112} fontSize={8} textAnchor="middle" fill={SSC_SILK}>XBee</text>

      {/* 4 bancs de 8 voies */}
      <Bank x={20} label="0–7" />
      <Bank x={92} label="8–15" />
      <Bank x={186} label="16–23" />
      <Bank x={258} label="24–31" />

      {/* Puce */}
      <rect x={150} y={70} width={60} height={34} rx={3} fill="#0c0d10" stroke="rgba(255,255,255,0.1)" />
      <text x={180} y={91} fontSize={8} textAnchor="middle" fill={SSC_SILK} fillOpacity={0.8}>AVR</text>

      {/* Cavaliers */}
      <Jumper x={70} y={112} label="VS1=VS2" />
      <Jumper x={232} y={112} label="BAUD ×2" />

      {/* Borniers d'alimentation */}
      <Terminal x={40} label="VS1" />
      <Terminal x={158} label="VS2" />
      <Terminal x={276} label="VL" />

      {/* Flèches d'association alim → bancs */}
      <g stroke={SSC_SILK} strokeOpacity={0.7} strokeWidth={1} fill="none" markerEnd="">
        <path d="M 62 132 L 62 52" strokeDasharray="3 2" />
        <path d="M 180 132 L 224 52" strokeDasharray="3 2" />
      </g>
      <text x={120} y={186} fontSize={8} fill={SSC_SILK} fillOpacity={0.85}>VS1 → voies 0–15</text>
      <text x={236} y={186} fontSize={8} fill={SSC_SILK} fillOpacity={0.85}>VS2 → voies 16–31</text>
    </svg>
  );
}
