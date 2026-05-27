import { useMemo, type ReactNode } from "react";
import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  DoubleSide,
} from "three";
import { RenderTexture, PerspectiveCamera, Grid } from "@react-three/drei";
import { Hexapod } from "./Hexapod";
import { useProgramRunStore } from "../store/useProgramRunStore";

// Salle ≈ 5 m (X) × 8 m (Z), murs hauteur 2,5 m. Le robot (~0,34 m) évolue au sol (y=0).
export const ROOM_W = 5; // largeur (axe X)
export const ROOM_D = 8; // profondeur (axe Z)
export const ROOM_H = 2.5; // hauteur murs
const WALL_T = 0.08; // épaisseur murs

// Baies vitrées du mur gauche (centre Y, dimensions, positions en Z).
const WIN = { y: 1.35, w: 1.4, h: 1.3, zs: [-1.8, 1.8] };

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/**
 * Texture canvas : dessine immédiatement le rendu procédural (`draw`), et si
 * `src` est fourni, remplace par l'image dès qu'elle est chargée (repli si
 * absente). Évite tout crash de chargement et fonctionne sans asset.
 */
function useCanvasTexture(width: number, height: number, draw: DrawFn, src?: string): CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    draw(ctx, width, height);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    if (src) {
      const img = new Image();
      img.onload = () => {
        const ca = width / height;
        const ia = img.width / img.height;
        let dw: number, dh: number, dx: number, dy: number;
        if (ia > ca) { dh = height; dw = dh * ia; dx = (width - dw) / 2; dy = 0; }
        else { dw = width; dh = dw / ia; dx = 0; dy = (height - dh) / 2; }
        ctx.drawImage(img, dx, dy, dw, dh);
        tex.needsUpdate = true;
      };
      img.onerror = () => { /* garde le repli procédural */ };
      img.src = src;
    }
    return tex;
  }, [width, height, src]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Texture parquet : lames bois + rainures. */
function useParquetTexture(): CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext("2d")!;
    const plankH = 64;
    const tones = ["#b8895a", "#ad7f50", "#c0915f", "#a87a4b", "#b5855a"];
    for (let row = 0; row * plankH < c.height; row++) {
      const offset = (row % 2) * 128;
      for (let x = -offset; x < c.width; x += 128) {
        const tone = tones[(row + Math.floor(x / 128) + tones.length) % tones.length];
        ctx.fillStyle = tone;
        ctx.fillRect(x, row * plankH, 128, plankH);
        ctx.strokeStyle = "rgba(90,60,35,0.18)";
        ctx.lineWidth = 1;
        for (let v = 0; v < 3; v++) {
          const vy = row * plankH + 12 + v * 18;
          ctx.beginPath();
          ctx.moveTo(x + 4, vy);
          ctx.bezierCurveTo(x + 40, vy + 3, x + 80, vy - 3, x + 124, vy + 1);
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(40,25,15,0.45)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, row * plankH, 128, plankH);
      }
    }
    const tex = new CanvasTexture(c);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(ROOM_W / 1.2, ROOM_D / 1.2);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }, []);
}

/** Vue de jardin façon « Bliss » : ciel, nuages, collines vertes. */
const drawGarden: DrawFn = (ctx, w, h) => {
  // Ciel
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, "#3f86d6");
  sky.addColorStop(1, "#bfe2ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // Soleil
  ctx.fillStyle = "rgba(255,250,220,0.9)";
  ctx.beginPath();
  ctx.arc(w * 0.78, h * 0.2, h * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // Nuages
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const cloud = (cx: number, cy: number, s: number) => {
    for (const [ox, oy, r] of [[-1.2, 0, 0.8], [0, -0.4, 1], [1.2, 0, 0.85], [0.4, 0.2, 0.7]] as const) {
      ctx.beginPath();
      ctx.ellipse(cx + ox * s, cy + oy * s, r * s, r * s * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  cloud(w * 0.25, h * 0.22, 22);
  cloud(w * 0.55, h * 0.13, 16);
  // Collines vertes (plusieurs couches)
  const hill = (baseY: number, amp: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, baseY);
    for (let x = 0; x <= w; x += 8) {
      ctx.lineTo(x, baseY + Math.sin((x / w) * Math.PI * 1.5 + baseY) * amp);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };
  hill(h * 0.62, 14, "#7fb35a");
  hill(h * 0.72, 18, "#5d9b3e");
  hill(h * 0.82, 12, "#4c8a32");
  // Quelques touches de fleurs
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = ["#ffffff", "#ffd54a", "#ff7eb6"][i % 3];
    const fx = Math.random() * w;
    const fy = h * 0.85 + Math.random() * h * 0.13;
    ctx.beginPath();
    ctx.arc(fx, fy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Repli impressionniste façon Monet (pont japonais / nymphéas) si l'image absente. */
const drawMonetFallback: DrawFn = (ctx, w, h) => {
  const water = ctx.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, "#5b7d54");
  water.addColorStop(0.5, "#6f9e6a");
  water.addColorStop(1, "#43603f");
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, w, h);
  // Touches de feuillage (haut)
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const greens = ["#3f6b3a", "#7aa86a", "#9bc07e", "#557c45", "#2f5230"];
    ctx.fillStyle = greens[i % greens.length];
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 3, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Pont arqué pâle
  ctx.strokeStyle = "#cfd6c2";
  ctx.lineWidth = h * 0.06;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.62, w * 0.42, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.strokeStyle = "#a9b59a";
  ctx.lineWidth = h * 0.02;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.62, w * 0.42, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  // Nymphéas (taches roses/blanches en bandes horizontales)
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * w;
    const y = h * 0.5 + Math.random() * h * 0.5;
    ctx.fillStyle = ["#e8a6c2", "#ffffff", "#d98ab0", "#f3c6da"][i % 4];
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(x, y, 4, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

interface PaintingProps {
  position: [number, number, number];
  rotationY: number;
  draw: DrawFn;
  src?: string;
  w?: number;
  h?: number;
}

function Painting({ position, rotationY, draw, src, w = 0.9, h = 0.68 }: PaintingProps) {
  const tex = useCanvasTexture(512, Math.round((512 * h) / w), draw, src);
  const frame = 0.07;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Cadre (boîte pleine) placé DERRIÈRE la toile */}
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[w + frame, h + frame, 0.03]} />
        <meshStandardMaterial color="#3a2c1c" roughness={0.7} />
      </mesh>
      {/* Toile, en avant du cadre */}
      <mesh position={[0, 0, 0.005]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} roughness={0.85} />
      </mesh>
    </group>
  );
}

const FRAME_COLOR = "#eef0f2";

/** Vitre transparente + cadre + croisillons, posée dans l'ouverture du mur gauche. */
function WindowGlass({ z }: { z: number }) {
  const x = -ROOM_W / 2;
  const { w, h, y } = WIN;
  const bar = 0.05;
  return (
    <group position={[x + WALL_T / 2 + 0.01, y, z]} rotation={[0, Math.PI / 2, 0]}>
      {/* Vitre transparente (largeur le long du mur, hauteur verticale) */}
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial
          color="#cfe3f2"
          transparent
          opacity={0.16}
          roughness={0.08}
          metalness={0}
          side={DoubleSide}
        />
      </mesh>
      {/* Montants du cadre */}
      <mesh position={[0, h / 2 + 0.03, 0.02]}>
        <boxGeometry args={[w + 0.14, 0.07, 0.07]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.6} />
      </mesh>
      <mesh position={[0, -h / 2 - 0.03, 0.02]}>
        <boxGeometry args={[w + 0.14, 0.07, 0.07]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.6} />
      </mesh>
      <mesh position={[-w / 2 - 0.03, 0, 0.02]}>
        <boxGeometry args={[0.07, h + 0.14, 0.07]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.6} />
      </mesh>
      <mesh position={[w / 2 + 0.03, 0, 0.02]}>
        <boxGeometry args={[0.07, h + 0.14, 0.07]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.6} />
      </mesh>
      {/* Croisillons */}
      <mesh position={[0, 0, 0.015]}>
        <boxGeometry args={[w, bar, 0.04]} />
        <meshStandardMaterial color={FRAME_COLOR} />
      </mesh>
      <mesh position={[0, 0, 0.015]}>
        <boxGeometry args={[bar, h, 0.04]} />
        <meshStandardMaterial color={FRAME_COLOR} />
      </mesh>
    </group>
  );
}

/**
 * Mur gauche percé de baies vitrées : panneaux pleins autour des ouvertures,
 * décor de jardin placé DERRIÈRE le mur (visible au travers des vitres), vitres.
 */
function LeftWall() {
  const garden = useCanvasTexture(1024, 384, drawGarden);
  const x = -ROOM_W / 2;
  const hz = ROOM_D / 2;
  const halfW = WIN.w / 2;
  const halfH = WIN.h / 2;
  const bandY0 = WIN.y - halfH; // bas des baies
  const bandY1 = WIN.y + halfH; // haut des baies

  // Segments pleins (en Z) de la bande médiane, entre/autour des ouvertures.
  const openings = WIN.zs.map((z) => [z - halfW, z + halfW] as const).sort((a, b) => a[0] - b[0]);
  const segments: [number, number][] = [];
  let cursor = -hz;
  for (const [z0, z1] of openings) { segments.push([cursor, z0]); cursor = z1; }
  segments.push([cursor, hz]);

  const wallMat = <meshStandardMaterial color={WALL_COLOR} roughness={0.95} />;

  return (
    <group>
      {/* Décor de jardin derrière le mur (éclairé par émission pour le plein jour) */}
      <mesh position={[x - 0.18, 1.3, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[ROOM_D + 2, 2.8]} />
        <meshStandardMaterial
          map={garden}
          emissive="#ffffff"
          emissiveMap={garden}
          emissiveIntensity={0.85}
          roughness={1}
          side={DoubleSide}
        />
      </mesh>

      {/* Bande basse (sous les baies) */}
      <mesh position={[x, bandY0 / 2, 0]} receiveShadow>
        <boxGeometry args={[WALL_T, bandY0, ROOM_D]} />
        {wallMat}
      </mesh>
      {/* Bande haute (au-dessus des baies) */}
      <mesh position={[x, (bandY1 + ROOM_H) / 2, 0]} receiveShadow>
        <boxGeometry args={[WALL_T, ROOM_H - bandY1, ROOM_D]} />
        {wallMat}
      </mesh>
      {/* Trumeaux pleins de la bande médiane */}
      {segments.map(([z0, z1], i) =>
        z1 - z0 > 1e-3 ? (
          <mesh key={i} position={[x, WIN.y, (z0 + z1) / 2]} receiveShadow>
            <boxGeometry args={[WALL_T, WIN.h, z1 - z0]} />
            {wallMat}
          </mesh>
        ) : null,
      )}

      {/* Vitres */}
      {WIN.zs.map((z) => <WindowGlass key={z} z={z} />)}
    </group>
  );
}

interface DoorProps {
  position: [number, number, number];
  rotationY: number;
}

function Door({ position, rotationY }: DoorProps) {
  const w = 0.95;
  const h = 2.05;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0, 0.005]}>
        <boxGeometry args={[w + 0.14, h + 0.08, 0.05]} />
        <meshStandardMaterial color="#d8d2c4" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[w, h, 0.04]} />
        <meshStandardMaterial color="#8a6a45" roughness={0.6} />
      </mesh>
      <mesh position={[w / 2 - 0.12, 0, 0.05]}>
        <sphereGeometry args={[0.03, 12, 10]} />
        <meshStandardMaterial color="#d9c14a" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

const WALL_COLOR = "#f3f1ec";

/** Tableau abstrait simple (touches colorées) pour les murs secondaires. */
function makeAbstract(hue: number): DrawFn {
  return (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue},55%,60%)`);
    g.addColorStop(1, `hsl(${(hue + 60) % 360},50%,40%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `hsla(${(hue + 180) % 360},60%,70%,0.6)`;
    ctx.beginPath();
    ctx.arc(w * 0.35, h * 0.45, h * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsla(${(hue + 30) % 360},70%,30%,0.5)`;
    ctx.fillRect(w * 0.55, h * 0.25, w * 0.3, h * 0.5);
  };
}

// ── Poste de travail (bureau + ordinateur 2 écrans) contre le mur avant ───────
const DESK_W = 1.8;
const DESK_D = 0.55;
const DESK_H = 0.72;
const DESK_TOP = 0.04;
const DESK_Z = ROOM_D / 2 - 0.08 - DESK_D / 2; // contre le mur z=+4

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Maquette de l'écran « Programme » (flux init → étapes → boucle). */
const drawProgramScreen: DrawFn = (ctx, w, h) => {
  ctx.fillStyle = "#15171c";
  ctx.fillRect(0, 0, w, h);
  // Barre de titre
  ctx.fillStyle = "#1d2026";
  ctx.fillRect(0, 0, w, 30);
  ctx.fillStyle = "#f5c518";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("PROGRAMME — Eve lève-toi et marche", 12, 20);
  // Barre latérale
  ctx.fillStyle = "#1a1d23";
  ctx.fillRect(0, 30, 96, h - 30);
  ctx.fillStyle = "#2a2e37";
  roundRect(ctx, 8, 44, 80, 22, 5); ctx.fill();
  ctx.fillStyle = "#c9ccd2";
  ctx.font = "10px sans-serif";
  ctx.fillText("Programmes", 12, 58);
  // Flux d'étapes
  const cx = 96 + (w - 96) / 2;
  const bw = 200;
  const blocks: [string, string][] = [
    ["🏠 INIT", "#3b82f6"],
    ["📋 ÉTAPE 1 — Ripple", "#f5c518"],
    ["📋 ÉTAPE 2 — Tripod", "#f5c518"],
    ["🔄 BOUCLE → Étape 2", "#a855f7"],
  ];
  let by = 52;
  const bh = 40;
  blocks.forEach(([label, color], i) => {
    ctx.fillStyle = "#20242c";
    roundRect(ctx, cx - bw / 2, by, bw, bh, 8); ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    roundRect(ctx, cx - bw / 2, by, bw, bh, 8); ctx.stroke();
    ctx.fillStyle = "#e6e8ec";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(label, cx - bw / 2 + 14, by + 25);
    if (i < blocks.length - 1) {
      ctx.fillStyle = "#5a6070";
      ctx.font = "14px sans-serif";
      ctx.fillText("↓", cx - 5, by + bh + 16);
    }
    by += bh + 22;
  });
};

/** Matériau de l'écran « Programme » (texture mockup ; flip horizontal car l'écran fait face à -Z). */
function ProgramScreenMat() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 320;
    drawProgramScreen(c.getContext("2d")!, 512, 320);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    t.center.set(0.5, 0.5);
    t.repeat.x = -1;
    return t;
  }, []);
  return <meshBasicMaterial map={tex} toneMapped={false} />;
}

/** Matériau de l'écran « Conception 3D » : rendu live du robot (même pose). */
function DesignScreenMat() {
  const isRunning = useProgramRunStore((s) => s.isRunning);
  const restPose = useProgramRunStore((s) => s.restPose);
  return (
    <meshBasicMaterial toneMapped={false}>
      <RenderTexture attach="map" width={512} height={384} anisotropy={8}>
        <PerspectiveCamera makeDefault fov={42} position={[0.42, 0.3, 0.5]} onUpdate={(c) => c.lookAt(0, 0.02, 0)} />
        <color attach="background" args={["#15171c"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[2, 3, 2]} intensity={1.0} />
        <Grid
          args={[1.5, 1.5]}
          cellSize={0.05}
          cellThickness={0.5}
          cellColor="#2a2f3a"
          sectionSize={0.25}
          sectionThickness={1}
          sectionColor="#3a4150"
          fadeDistance={3.5}
          fadeStrength={1}
          infiniteGrid
        />
        {(isRunning || restPose) && <Hexapod clean pose={isRunning ? undefined : restPose} />}
      </RenderTexture>
    </meshBasicMaterial>
  );
}

/** Un moniteur (pied + dalle), écran tourné vers la pièce (-Z). */
function Monitor({ position, screen }: { position: [number, number, number]; screen: ReactNode }) {
  // La dalle est en Z=0 et fait face à la pièce (-Z). Socle + mât sont placés
  // DERRIÈRE (Z positif, vers le mur) pour ne pas passer devant l'écran.
  return (
    <group position={position}>
      {/* Socle */}
      <mesh position={[0, 0.01, 0.05]} castShadow>
        <boxGeometry args={[0.22, 0.02, 0.16]} />
        <meshStandardMaterial color="#15171c" roughness={0.5} />
      </mesh>
      {/* Mât (derrière la dalle) */}
      <mesh position={[0, 0.15, 0.06]} castShadow>
        <boxGeometry args={[0.045, 0.3, 0.045]} />
        <meshStandardMaterial color="#15171c" roughness={0.5} />
      </mesh>
      {/* Dalle face à la pièce */}
      <group position={[0, 0.32, 0]} rotation={[0, Math.PI, 0]}>
        <mesh position={[0, 0, -0.013]} castShadow>
          <boxGeometry args={[0.6, 0.37, 0.025]} />
          <meshStandardMaterial color="#0c0c0e" roughness={0.4} />
        </mesh>
        <mesh>
          <planeGeometry args={[0.56, 0.33]} />
          {screen}
        </mesh>
      </group>
    </group>
  );
}

function Workstation() {
  const baseY = DESK_H + DESK_TOP / 2;
  const legX = DESK_W / 2 - 0.06;
  const legZ = DESK_D / 2 - 0.06;
  const legs: [number, number][] = [
    [-legX, -legZ], [legX, -legZ], [-legX, legZ], [legX, legZ],
  ];
  return (
    <group>
      {/* Plateau */}
      <mesh position={[0, DESK_H, DESK_Z]} castShadow receiveShadow>
        <boxGeometry args={[DESK_W, DESK_TOP, DESK_D]} />
        <meshStandardMaterial color="#6b4f34" roughness={0.6} />
      </mesh>
      {/* Pieds */}
      {legs.map(([px, pz], i) => (
        <mesh key={i} position={[px, DESK_H / 2, DESK_Z + pz]} castShadow>
          <boxGeometry args={[0.05, DESK_H, 0.05]} />
          <meshStandardMaterial color="#4a3722" roughness={0.7} />
        </mesh>
      ))}
      {/* Écrans : programme (gauche) + conception 3D live (droite) */}
      <Monitor position={[-0.46, baseY, DESK_Z + 0.05]} screen={<ProgramScreenMat />} />
      <Monitor position={[0.46, baseY, DESK_Z + 0.05]} screen={<DesignScreenMat />} />
      {/* Clavier + souris */}
      <mesh position={[0, baseY + 0.01, DESK_Z - 0.16]} castShadow>
        <boxGeometry args={[0.42, 0.02, 0.14]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.6} />
      </mesh>
      <mesh position={[0.32, baseY + 0.012, DESK_Z - 0.15]} castShadow>
        <boxGeometry args={[0.05, 0.025, 0.08]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.6} />
      </mesh>
      {/* Tour PC au sol */}
      <mesh position={[DESK_W / 2 + 0.18, 0.22, DESK_Z]} castShadow>
        <boxGeometry args={[0.2, 0.44, 0.42]} />
        <meshStandardMaterial color="#202227" roughness={0.5} />
      </mesh>
    </group>
  );
}

export function Room() {
  const parquet = useParquetTexture();
  const abstract200 = useMemo(() => makeAbstract(200), []);
  const abstract120 = useMemo(() => makeAbstract(120), []);
  const hx = ROOM_W / 2;
  const hz = ROOM_D / 2;
  const wallY = ROOM_H / 2;

  return (
    <group>
      {/* Sol parquet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial map={parquet} roughness={0.85} />
      </mesh>

      {/* Plafond (sous-face) */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM_H, 0]}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color="#fbfaf7" roughness={1} side={DoubleSide} />
      </mesh>

      {/* Murs */}
      <mesh position={[0, wallY, -hz]} receiveShadow>
        <boxGeometry args={[ROOM_W, ROOM_H, WALL_T]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.95} />
      </mesh>
      <mesh position={[0, wallY, hz]}>
        <boxGeometry args={[ROOM_W, ROOM_H, WALL_T]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.95} side={DoubleSide} />
      </mesh>
      <mesh position={[hx, wallY, 0]} receiveShadow>
        <boxGeometry args={[WALL_T, ROOM_H, ROOM_D]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.95} />
      </mesh>

      {/* Plinthe mur fond */}
      <mesh position={[0, 0.05, -hz + WALL_T / 2 + 0.005]}>
        <boxGeometry args={[ROOM_W, 0.1, 0.02]} />
        <meshStandardMaterial color="#e2ddd2" />
      </mesh>

      {/* Mur gauche percé de baies vitrées (vue jardin au travers) */}
      <LeftWall />

      {/* Porte sur le mur fond */}
      <Door position={[1.4, 1.03, -hz + WALL_T / 2 + 0.01]} rotationY={0} />

      {/* Tableaux : Monet (fond) + abstraits (mur droit) */}
      <Painting
        position={[-1.2, 1.5, -hz + WALL_T / 2 + 0.03]}
        rotationY={0}
        draw={drawMonetFallback}
        src="/monet-bridge.jpg"
        w={1.0}
        h={0.78}
      />
      <Painting
        position={[hx - WALL_T / 2 - 0.03, 1.5, -1.0]}
        rotationY={-Math.PI / 2}
        draw={abstract200}
        w={0.8}
        h={0.6}
      />
      <Painting
        position={[hx - WALL_T / 2 - 0.03, 1.5, 2.0]}
        rotationY={-Math.PI / 2}
        draw={abstract120}
        w={1.0}
        h={0.7}
      />

      {/* Poste de travail contre le mur avant (vide) : bureau + ordi 2 écrans */}
      <Workstation />
    </group>
  );
}
