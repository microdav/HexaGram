import type { ServoDef } from "./servo";

export type LegLayout = "star" | "linear";

/**
 * Ancrage d'une patte tel que dessiné dans l'éditeur « Robot 2D » (vue de
 * dessus, plan XZ — body frame). Quand 6 ancrages sont présents dans
 * {@link Body2D}, ils remplacent le calcul paramétrique de {@link computeLegMounts}.
 */
export interface LegAnchor {
  index: number; // 0..5
  x: number; // mètres, axe avant +X
  z: number; // mètres, axe droite +Z
  yawDeg: number; // orientation du coxa
}

/** Marqueur de servo posé dans la maquette 2D (purement décoratif côté 3D). */
export interface ServoMarker {
  servoId: number; // 0..17
  x: number; // mètres, XZ body frame
  z: number;
}

/**
 * Placement vue de dessus d'un servo coxa. Le pignon (axe de sortie rotatif)
 * coïncide avec l'ancrage de la patte (= axe coxa de {@link computeLegMounts}) ;
 * on ne stocke donc que l'orientation du corps autour de ce pivot, exprimée en
 * décalage par rapport à l'orientation par défaut (le long de la patte).
 */
export interface CoxaServo {
  legIndex: number; // 0..5
  /** Rotation du corps (deg) ajoutée à l'orientation auto (yaw de la patte). */
  angleOffsetDeg: number;
}

/**
 * Liaison d'une extrémité de cote à un élément mobile : le point de mesure suit
 * l'élément quand il bouge (et le libellé se met à jour). Sans liaison, le point
 * reste fixe (coordonnées monde figées dans `a`/`b`). Les bords stockent l'index
 * d'arête + le paramètre `t∈[0,1]` du pied de perpendiculaire le long de l'arête.
 */
export type MeasureRef =
  | { kind: "coxaPinion"; leg: number }
  | { kind: "legJoint"; leg: number; joint: "coxa" | "femur" | "tibia" }
  | { kind: "legFoot"; leg: number }
  | { kind: "legEdge"; leg: number; part: "coxa" | "femur" | "tibia"; edge: number; t: number }
  | { kind: "coxaBodyEdge"; leg: number; edge: number; t: number }
  | { kind: "shapeVertex"; shapeId: string; index: number }
  | { kind: "shapeEdge"; shapeId: string; edge: number; t: number };

/**
 * Cote de mesure (annotation) : segment a→b + décalage perpendiculaire (m).
 * `aRef`/`bRef` : liaison optionnelle de chaque extrémité ({@link MeasureRef}).
 * `a`/`b` servent de position de repli quand la liaison ne se résout plus.
 */
export interface Measurement2D {
  id: string;
  a: Pt2;
  b: Pt2;
  offset: number;
  aRef?: MeasureRef;
  bRef?: MeasureRef;
}

/**
 * Maquette « Robot 2D » : source de vérité de la géométrie quand elle est
 * présente. L'éditeur 2D la remplit ; la 3D en dérive via {@link computeLegMounts}.
 */
/** Un sommet du contour ou d'un trou, en mètres dans le plan XZ (body frame). */
export interface Pt2 {
  x: number;
  z: number;
}

/** Calque d'une forme : réel (jaune, matière du châssis) ou virtuel (gris, gabarit). */
export type ShapeLayer = "real" | "virtual";
/** Opération booléenne d'une forme réelle : matière (add) ou découpe/trou (subtract). */
export type ShapeOp = "add" | "subtract";

/** Forme composant le châssis. rect/carré/cercle sont pré-tessellés en polygone. */
export interface Shape2D {
  id: string;
  layer: ShapeLayer;
  op: ShapeOp;
  /** Polygone fermé (mètres, XZ). */
  poly: Pt2[];
}

/** Morceau de châssis baké : contour extérieur + trous, prêt à extruder. */
export interface ChassisPiece {
  outer: Pt2[];
  holes: Pt2[][];
}

export interface Body2D {
  /** Contour rectangulaire de repli (longueur × largeur, en mètres). Tient aussi
   *  lieu de boîte englobante pour le code 3D dépendant (CoG, appuis sol). */
  outline: { length: number; width: number; cornerRadius?: number };
  /** Composition de formes (modèle d'édition : matière, découpes, gabarits). */
  shapes?: Shape2D[];
  /** Morceaux bakés = fusion des formes réelles. Source de l'extrusion 3D. */
  pieces?: ChassisPiece[];
  /** Legacy — contour polygonal unique (anciens profils). Migré en `shapes`/`pieces`. */
  points?: Pt2[] | null;
  /** Legacy — trous (anciens profils). */
  holes?: Pt2[][];
  /** Ancrages par patte. Absent ou ≠ 6 entrées => repli paramétrique. */
  anchors?: LegAnchor[];
  /** Marqueurs de servo (affichage 2D uniquement, sans effet sur l'IK). */
  servoMarkers?: ServoMarker[];
  /** Servos coxa placés en vue de dessus (pignon = ancrage de patte). */
  coxaServos?: CoxaServo[];
  /** Cotes de mesure (annotations) — persistées avec la base mécanique. */
  measurements?: Measurement2D[];
  /** Marqueur de schéma (forward-compat). */
  version: 1;
}

export interface HexapodGeometry {
  chassis: { length: number; width: number; height: number };
  segments: { coxa: number; femur: number; tibia: number };
  /** Center of gravity offset relative to chassis center (body frame). */
  cog: { x: number; y: number; z: number };
  /** Disposition angulaire des coxa : étoile (angles variés) ou rectiligne (tous à ±90°). */
  legLayout?: LegLayout;
  /** Épaisseur (vue de dessus) de chaque partie de patte, en mètres, par patte
   *  (index 0..5). Absent ou entrée manquante ⇒ repli sur DEFAULT_SEGMENT_WIDTHS. */
  segmentWidths?: { coxa: number; femur: number; tibia: number }[];
  /** Hauteur (vue de face / profil, axe Y) de chaque partie, en mètres, par patte.
   *  La coxa est bornée [hauteur servo, hauteur châssis] à l'usage. Le tibia est
   *  conique : `tibia` = hauteur au **genou**, `tibiaFoot` = hauteur au **pied**. */
  segmentHeights?: { coxa: number; femur: number; tibia: number; tibiaFoot?: number }[];
  /** Maquette 2D — source de vérité des ancrages/châssis quand présente. */
  body2D?: Body2D;
  /**
   * Offset de montage par servo (deg, index 0..17). Décalage structurel entre la
   * pose **modèle** (repère servo : 0 = centre du servo) et l'angle **géométrique**
   * rendu en 3D : `géométrique = pose + offset`. Le tibia est monté perpendiculaire
   * au fémur quand le servo est au centre → offset −90°. Absent (profil legacy non
   * migré) ⇒ offset 0 (ancien comportement, pose = géométrique).
   */
  mountingOffsetsDeg?: number[];
}

/** Offsets de montage par défaut (18) : tibia −90° (perpendiculaire au centre), reste 0. */
export function defaultMountingOffsets(): number[] {
  return Array.from({ length: 18 }, (_, i) => (i % 3 === 2 ? -90 : 0));
}

/** Offset de montage (deg) d'un servo ; 0 si absent (profil legacy non migré). */
export function mountingOffsetOf(geom: HexapodGeometry, servoId: number): number {
  const arr = geom.mountingOffsetsDeg;
  return Array.isArray(arr) && Number.isFinite(arr[servoId]) ? arr[servoId] : 0;
}

export interface LegMount {
  index: number;
  name: string;
  position: [number, number, number];
  yawDeg: number;
}

export const DEFAULT_GEOMETRY: HexapodGeometry = {
  chassis: { length: 0.34, width: 0.18, height: 0.065 },
  segments: { coxa: 0.05, femur: 0.08, tibia: 0.115 },
  cog: { x: 0, y: 0, z: 0 },
  mountingOffsetsDeg: defaultMountingOffsets(),
};

/** Épaisseurs de patte par défaut (m), vue de dessus, quand non renseignées. */
export const DEFAULT_SEGMENT_WIDTHS = { coxa: 0.02, femur: 0.018, tibia: 0.015 } as const;

/** Épaisseurs effectives (m) d'une patte donnée, avec repli sur les valeurs par défaut. */
export function segmentWidthsOf(
  geom: HexapodGeometry,
  legIndex: number
): { coxa: number; femur: number; tibia: number } {
  const w = Array.isArray(geom.segmentWidths) ? geom.segmentWidths[legIndex] : undefined;
  return { ...DEFAULT_SEGMENT_WIDTHS, ...(w ?? {}) };
}

/** Hauteurs de profil par défaut (m, vue de face) quand non renseignées. */
export const DEFAULT_SEGMENT_HEIGHTS = { coxa: 0.04, femur: 0.02, tibia: 0.015, tibiaFoot: 0.008 } as const;

/** Hauteurs de profil effectives (m) d'une patte donnée, avec repli par défaut. */
export function segmentHeightsOf(
  geom: HexapodGeometry,
  legIndex: number
): { coxa: number; femur: number; tibia: number; tibiaFoot: number } {
  const h = Array.isArray(geom.segmentHeights) ? geom.segmentHeights[legIndex] : undefined;
  return { ...DEFAULT_SEGMENT_HEIGHTS, ...(h ?? {}) };
}

export const LEG_NAMES = [
  "Avant gauche",
  "Milieu gauche",
  "Arrière gauche",
  "Avant droite",
  "Milieu droite",
  "Arrière droite",
] as const;

export function computeLegMounts(geom: HexapodGeometry): LegMount[] {
  // Si la maquette 2D fournit les 6 ancrages, ils font autorité : la 3D dérive
  // directement de ce qui a été dessiné dans l'onglet « Robot 2D ».
  const anchors = geom.body2D?.anchors;
  if (anchors && anchors.length === 6) {
    return anchors
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((a) => ({
        index: a.index,
        name: LEG_NAMES[a.index],
        position: [a.x, 0, a.z] as [number, number, number],
        yawDeg: a.yawDeg,
      }));
  }

  const halfL = geom.chassis.length / 2;
  const halfW = geom.chassis.width / 2;
  const y = 0;
  const linear = (geom.legLayout ?? "star") === "linear";

  return [
    { index: 0, name: LEG_NAMES[0], position: [+halfL, y, -halfW], yawDeg: linear ? +90 : +45 },
    { index: 1, name: LEG_NAMES[1], position: [0, y, -halfW],      yawDeg: +90 },
    { index: 2, name: LEG_NAMES[2], position: [-halfL, y, -halfW], yawDeg: linear ? +90 : +135 },
    { index: 3, name: LEG_NAMES[3], position: [+halfL, y, +halfW], yawDeg: linear ? -90 : -45 },
    { index: 4, name: LEG_NAMES[4], position: [0, y, +halfW],      yawDeg: -90 },
    { index: 5, name: LEG_NAMES[5], position: [-halfL, y, +halfW], yawDeg: linear ? -90 : -135 },
  ];
}

/**
 * Sème les 6 ancrages depuis la sortie paramétrique (star/linear) de la
 * géométrie courante. Sert à initialiser la maquette 2D de façon cohérente
 * avec la 3D, ou à réinitialiser les ancrages depuis le paramétrique.
 */
export function defaultAnchorsFromGeometry(geom: HexapodGeometry): LegAnchor[] {
  return computeLegMounts({ ...geom, body2D: undefined }).map((m) => ({
    index: m.index,
    x: m.position[0],
    z: m.position[2],
    yawDeg: m.yawDeg,
  }));
}

/** Polygone rectangulaire (4 sommets) depuis longueur×largeur, centré à l'origine. */
export function rectPolygon(length: number, width: number): Pt2[] {
  const hl = length / 2;
  const hw = width / 2;
  // Sens trigonométrique constant — avant (+X) en haut, droite (+Z) à droite.
  return [
    { x: +hl, z: -hw },
    { x: +hl, z: +hw },
    { x: -hl, z: +hw },
    { x: -hl, z: -hw },
  ];
}

/** Boîte englobante (length sur X, width sur Z) d'un polygone. */
export function polygonBounds(points: Pt2[]): { length: number; width: number } {
  if (points.length === 0) return { length: 0, width: 0 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { length: maxX - minX, width: maxZ - minZ };
}

export function buildServos(): ServoDef[] {
  const servos: ServoDef[] = [];
  let id = 0;
  // Plage de 180° par servo (±90°) — correspond à la course standard d'un servo
  // hobby, et donne un arc 3D parfaitement symétrique pour chaque articulation.
  for (let leg = 0; leg < 6; leg++) {
    // defaultDeg en repère servo (0 = centre). Le repos « fémur −20° / tibia +30° »
    // rend la même géométrie qu'avant (tibia +30 + offset −90 = −60° géométrique).
    servos.push({ id: id++, legIndex: leg, joint: "coxa", minDeg: -90, maxDeg: 90, defaultDeg: 0 });
    servos.push({ id: id++, legIndex: leg, joint: "femur", minDeg: -90, maxDeg: 90, defaultDeg: -20 });
    servos.push({ id: id++, legIndex: leg, joint: "tibia", minDeg: -90, maxDeg: 90, defaultDeg: 30 });
  }
  return servos;
}

export const SERVOS = buildServos();
