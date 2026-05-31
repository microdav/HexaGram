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

// Pictogrammes (chemins sur une grille 24×24).
const WIFI_PATH =
  "M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.07 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z";
const BLUETOOTH_PATH =
  "M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z";

/** Badge rond avec un pictogramme (WiFi / Bluetooth) sur le PCB. */
function WirelessBadge({
  cx,
  cy,
  d,
  color,
  size = 13,
}: {
  cx: number;
  cy: number;
  d: string;
  color: string;
  size?: number;
}) {
  const s = size / 24;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={size * 0.66}
        fill="rgba(255,255,255,0.12)"
        stroke={color}
        strokeOpacity={0.4}
        strokeWidth={0.7}
      />
      <g transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${s})`}>
        <path d={d} fill={color} />
      </g>
    </g>
  );
}

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
  const wifi = hasIface(interfaces, "wifi");
  const bt = hasIface(interfaces, "ble") || hasIface(interfaces, "bluetooth");
  const wireless = wifi || bt || hasIface(interfaces, "wireless");
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

      {/* Antenne sans-fil générique (coin haut droit) — seulement si ni WiFi ni BT. */}
      {wireless && !wifi && !bt && (
        <g stroke={silk} strokeOpacity={0.85} fill="none" strokeWidth={1.2}>
          <path d={`M ${bx + bw - 26} ${by + 10} h 16 l -8 10 z`} fill={silk} fillOpacity={0.18} stroke="none" />
          <path d={`M ${bx + bw - 20} ${by + 6} a 8 8 0 0 1 8 0`} />
          <path d={`M ${bx + bw - 23} ${by + 3} a 12 12 0 0 1 14 0`} />
        </g>
      )}

      {/* Symboles WiFi (vert) / Bluetooth (bleu), côté droit, centrés verticalement */}
      {wifi && (
        <WirelessBadge
          cx={bx + bw - 19}
          cy={by + bh * 0.5 - (bt ? 17 : 0)}
          d={WIFI_PATH}
          color="#3ddc84"
          size={20}
        />
      )}
      {bt && (
        <WirelessBadge
          cx={bx + bw - 19}
          cy={by + bh * 0.5 + (wifi ? 17 : 0)}
          d={BLUETOOTH_PATH}
          color="#2f9bff"
          size={20}
        />
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

// ── Illustration fidèle de la SSC-32U ────────────────────────────────────────
//
// Vue « réaliste » de la carte (d'après une photo du PCB réel) : sérigraphie
// verte, 32 voies servo réparties en 8 bancs de 4 sur les deux grands bords,
// micro-USB, MCU AVR + quartz, drivers, socket XBee, bouton Baud, bornier
// d'alimentation à vis et condensateurs. Purement décorative / didactique.

const SSC32_GREEN_SILK = "#eafff0";

/** Banc de 4 voies servo (4 colonnes × 3 broches dorées) + étiquette. */
function SscBank({
  x,
  y,
  label,
  labelAbove,
}: {
  x: number;
  y: number;
  label: string;
  labelAbove: boolean;
}) {
  const cols = [0, 1, 2, 3];
  const rows = [0, 1, 2];
  return (
    <g>
      <rect x={x} y={y} width={36} height={15} rx={1.5} fill="#0c0e12" />
      {cols.map((c) =>
        rows.map((r) => (
          <circle key={`${c}-${r}`} cx={x + 7 + c * 7.5} cy={y + 3.5 + r * 4} r={1.35} fill={PIN_GOLD} />
        ))
      )}
      <text
        x={x + 18}
        y={labelAbove ? y - 2 : y + 24}
        fontSize={5.5}
        textAnchor="middle"
        fill={SSC32_GREEN_SILK}
        fillOpacity={0.85}
      >
        {label}
      </text>
    </g>
  );
}

/** Petit boîtier SOIC sombre avec pattes (driver / logique). */
function SscChip({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const legs = Math.max(2, Math.round(w / 3));
  return (
    <g>
      {Array.from({ length: legs }, (_, i) => {
        const lx = x + (w / legs) * (i + 0.5) - 0.7;
        return (
          <g key={i}>
            <rect x={lx} y={y - 1.6} width={1.4} height={1.6} fill="#9aa0aa" />
            <rect x={lx} y={y + h} width={1.4} height={1.6} fill="#9aa0aa" />
          </g>
        );
      })}
      <rect x={x} y={y} width={w} height={h} rx={1} fill="#0b0c0f" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
    </g>
  );
}

/** Condensateur électrolytique (cylindre vu de dessus). */
function SscCap({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="url(#ssc-cap)" stroke="#26282d" strokeWidth={0.8} />
      <path d={`M ${cx - 8} ${cy} a 8 8 0 0 1 16 0`} fill="#1b1d22" fillOpacity={0.55} />
      <text x={cx} y={cy + 2} fontSize={4.5} textAnchor="middle" fill={SSC32_GREEN_SILK} fillOpacity={0.7}>220</text>
    </g>
  );
}

interface Ssc32uBoardProps {
  width?: number;
  className?: string;
}

/** Illustration détaillée de la Lynxmotion SSC-32U (orientation paysage). */
export function Ssc32uBoard({ width = 150, className }: Ssc32uBoardProps) {
  const silk = SSC32_GREEN_SILK;
  return (
    <svg
      viewBox="0 0 248 172"
      width={width}
      className={className ? `board-svg ${className}` : "board-svg"}
      role="img"
      aria-label="Illustration de la carte contrôleur Lynxmotion SSC-32U"
    >
      <defs>
        <linearGradient id="ssc-pcb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f8a54" />
          <stop offset="1" stopColor="#2a6038" />
        </linearGradient>
        <radialGradient id="ssc-cap" cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#d3d8df" />
          <stop offset="0.5" stopColor="#8b9099" />
          <stop offset="1" stopColor="#34373d" />
        </radialGradient>
        <linearGradient id="ssc-usb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8c34d" />
          <stop offset="1" stopColor="#b9912a" />
        </linearGradient>
      </defs>

      {/* PCB + léger reflet de vernis */}
      <rect x={12} y={8} width={224} height={156} rx={8} fill="url(#ssc-pcb)" stroke="rgba(0,0,0,0.45)" strokeWidth={1} />
      <rect x={12} y={8} width={224} height={50} rx={8} fill="#ffffff" fillOpacity={0.05} />

      {/* Trous de fixation */}
      {[
        [24, 20],
        [224, 20],
        [24, 152],
        [224, 152],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={3} fill="rgba(0,0,0,0.5)" stroke={silk} strokeOpacity={0.55} strokeWidth={0.7} />
      ))}

      {/* Connecteur micro-USB (bord gauche) */}
      <rect x={3} y={78} width={20} height={20} rx={2.5} fill="url(#ssc-usb)" stroke="#7c5f1a" strokeWidth={0.6} />
      <rect x={9} y={82} width={12} height={12} rx={1.5} fill="#4a4d54" />
      <text x={30} y={75} fontSize={5.5} fill={silk} fillOpacity={0.85}>USB</text>

      {/* Bancs servo — bord supérieur : voies 16-31 */}
      {["16–19", "20–23", "24–27", "28–31"].map((lab, i) => (
        <SscBank key={`t${i}`} x={38 + i * 42} y={24} label={lab} labelAbove />
      ))}
      {/* Bancs servo — bord inférieur : voies 0-15 */}
      {["0–3", "4–7", "8–11", "12–15"].map((lab, i) => (
        <SscBank key={`b${i}`} x={38 + i * 42} y={128} label={lab} labelAbove={false} />
      ))}

      {/* Socket XBee (deux rangées femelles) */}
      <text x={80} y={44} fontSize={5.5} textAnchor="middle" fill={silk} fillOpacity={0.85}>XBee</text>
      {[64, 92].map((sx) => (
        <g key={sx}>
          <rect x={sx} y={46} width={7} height={40} rx={1.5} fill="#0c0e12" />
          {Array.from({ length: 10 }, (_, i) => (
            <circle key={i} cx={sx + 3.5} cy={49 + i * 4} r={1.2} fill={PIN_GOLD} />
          ))}
        </g>
      ))}

      {/* Bouton « Baud » + LEDs B/C */}
      <rect x={120} y={48} width={11} height={9} rx={1.5} fill="#1a1c20" stroke="#2c2f35" strokeWidth={0.6} />
      <rect x={122} y={50} width={7} height={5} rx={1} fill="#3a3d44" />
      <text x={125} y={45} fontSize={5} textAnchor="middle" fill={silk} fillOpacity={0.8}>Baud</text>
      <rect x={140} y={49} width={4} height={3} rx={0.6} fill="#7fe6a0" />
      <rect x={147} y={49} width={4} height={3} rx={0.6} fill="#ff7a7a" />

      {/* Drivers / logique (SOIC) */}
      <SscChip x={44} y={92} w={17} h={11} />
      <SscChip x={44} y={108} w={17} h={11} />
      <SscChip x={176} y={70} w={17} h={10} />
      <SscChip x={176} y={96} w={17} h={11} />

      {/* MCU AVR (QFP) avec pattes sur 4 côtés */}
      <g>
        {Array.from({ length: 7 }, (_, i) => {
          const p = 90 + i * 3.5;
          return (
            <g key={i} fill="#9aa0aa">
              <rect x={p} y={84.5} width={1.6} height={1.5} />
              <rect x={p} y={112} width={1.6} height={1.5} />
              <rect x={114.5} y={p - 2} width={1.5} height={1.6} />
              <rect x={140} y={p - 2} width={1.5} height={1.6} />
            </g>
          );
        })}
        <rect x={116} y={86} width={24} height={24} rx={2} fill="#0a0b0e" stroke="rgba(255,255,255,0.08)" strokeWidth={0.6} />
        <circle cx={120} cy={90} r={1.4} fill="rgba(255,255,255,0.22)" />
      </g>

      {/* Quartz */}
      <rect x={148} y={90} width={22} height={12} rx={6} fill="#c7ccd3" stroke="#7a7e85" strokeWidth={0.6} />
      <rect x={150} y={92} width={18} height={8} rx={5} fill="#aeb3bb" />

      {/* Bornier d'alimentation à vis + condensateurs (bord droit) */}
      <rect x={199} y={24} width={37} height={28} rx={3} fill="#1c5234" stroke="#3f8a54" strokeWidth={0.8} />
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i}>
          <circle cx={203.5 + i * 5.4} cy={38} r={2.3} fill="#0d0d0d" stroke="#cfcfcf" strokeWidth={0.6} />
          <line x1={201.7 + i * 5.4} y1={38} x2={205.3 + i * 5.4} y2={38} stroke="#cfcfcf" strokeWidth={0.5} />
        </g>
      ))}
      <text x={217} y={20} fontSize={5.5} textAnchor="middle" fill={silk} fillOpacity={0.85}>VS1 · VS2 · VL</text>
      <SscCap cx={210} cy={84} />
      <SscCap cx={210} cy={110} />
      {/* Régulateur de tension (TO-252) */}
      <rect x={200} y={128} width={26} height={15} rx={1.5} fill="#1b1c20" stroke="#2c2f35" strokeWidth={0.5} />
      <rect x={200} y={128} width={26} height={4} rx={1.5} fill="#8b9099" />

      {/* Cavaliers jaunes */}
      <rect x={70} y={92} width={12} height={6} rx={1} fill="#f5c518" />
      <rect x={70} y={102} width={12} height={6} rx={1} fill="#f5c518" />

      {/* Sérigraphie */}
      <text x={118} y={120} fontSize={8} fontWeight={800} textAnchor="middle" fill={silk}>SSC-32U</text>
      <text x={118} y={126} fontSize={4.6} textAnchor="middle" fill={silk} fillOpacity={0.8}>lynxmotion.com</text>
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
      aria-label="Schéma annoté de la carte SSC-32U : bancs servo, alimentations VS1/VS2/VL, cavalier VS1=VS2, bouton Baud, USB et XBee"
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

      {/* Cavalier VS1=VS2 (réel, posé d'usine) */}
      <Jumper x={70} y={112} label="VS1=VS2" />

      {/* Bouton-poussoir Baud — le débit série se règle par ce bouton, pas par cavalier */}
      <g>
        <rect x={226} y={110} width={16} height={12} rx={2} fill="#1a1c20" stroke="#3a3d44" strokeWidth={0.8} />
        <rect x={229} y={112.5} width={10} height={7} rx={1.5} fill="#3a3d44" />
        <text x={234} y={108} fontSize={7} textAnchor="middle" fill={SSC_SILK}>Bouton Baud</text>
      </g>

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
