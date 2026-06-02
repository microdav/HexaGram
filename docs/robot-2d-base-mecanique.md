# HexaGram — Base mécanique & éditeur « Robot 2D »

> Documentation technique de l'onglet **Robot 2D** et du modèle **base mécanique**.
> Destinée à servir de point d'entrée pour la maintenance et les évolutions.

**Date** : 2026-06-02 · **Projet** : HexaGram

---

## 1. Vue d'ensemble

Un **projet** possède désormais **une seule** configuration robot, appelée **« base mécanique »**
(auparavant 0..N « profils robot »). L'onglet **Robot 2D** (placé avant « Conception 3D ») est un
éditeur vectoriel **vue de dessus** (plan XZ) qui sert à dessiner le châssis et à placer les pattes.

Le dessin 2D est la **source de vérité de la géométrie** : il alimente le champ `geometry.body2D`,
duquel dérivent (a) les **ancrages de pattes** consommés par toute la 3D via `computeLegMounts`, et
(b) la **forme extrudée du châssis** en 3D.

Ordre des onglets : `Projet · Robot 2D · Conception 3D · Programmation · Électronique · Admin`.

---

## 2. Base mécanique unique (singleton)

- Un projet a exactement une base. Implémentation **au niveau applicatif**, **sans migration backend** :
  les éventuels anciens profils multiples restent en base mais ne sont jamais exposés.
- [src/store/useProfilesStore.ts](../src/store/useProfilesStore.ts) → `ensureBase()` : liste les profils ;
  si vide, crée `save("Base mécanique")` ; sinon charge `profiles[0]` (le plus récent — tri serveur
  `ORDER BY updated_at DESC`).
- [src/App.tsx](../src/App.tsx) appelle `ensureBase()` à l'ouverture d'un projet.
- UI : [src/ui/ProfilePanel.tsx](../src/ui/ProfilePanel.tsx) (libellé « Base mécanique », plus de
  sélecteur), [src/ui/ProfileSettingsModal.tsx](../src/ui/ProfileSettingsModal.tsx) (renommage, calibration,
  séquences). Le menu multi-profils a été retiré de `UserButton` (`ProfileMenu.tsx` supprimé).
- Le profil reste stocké tel quel côté serveur (table `robot_profiles`, blob JSON `data` = `RobotProfileData`).
  Les identifiants internes (`profileId`, `useProfilesStore`, slug d'URL) sont **conservés**.

---

## 3. Modèle de données

Défini dans [src/model/hexapod.ts](../src/model/hexapod.ts).

```ts
type ShapeLayer = "real" | "virtual";   // calque : réel (jaune) | virtuel (gabarit gris)
type ShapeOp    = "add"  | "subtract";  // matière | découpe (trou)
interface Pt2 { x: number; z: number }                       // mètres, plan XZ (body frame)
interface Shape2D    { id; layer; op; poly: Pt2[] }          // rect/cercle pré-tessellés, crayon = libre
interface ChassisPiece { outer: Pt2[]; holes: Pt2[][] }      // morceau baké, prêt à extruder
interface LegAnchor  { index; x; z; yawDeg }                 // ancrage d'une patte
interface ServoMarker { servoId; x; z }                      // marqueur servo (2D only, sans effet IK)
interface CoxaServo  { legIndex; angleOffsetDeg }            // servo coxa réel : pignon = ancrage, corps orientable

interface Body2D {
  outline: { length; width; cornerRadius? };  // boîte de repli + bbox 3D
  shapes?: Shape2D[];      // composition éditable (source d'édition)
  pieces?: ChassisPiece[]; // fusion bakée des formes réelles (source d'extrusion 3D)
  points?: Pt2[] | null;   // LEGACY (anciens profils) — migré en shapes/pieces
  holes?: Pt2[][];         // LEGACY
  anchors?: LegAnchor[];   // override des 6 ancrages (sinon paramétrique star/linear)
  servoMarkers?: ServoMarker[];
  coxaServos?: CoxaServo[]; // orientation des 6 servos coxa (empreinte vue de dessus à l'échelle)
  measurements?: Measurement2D[]; // cotes de mesure (persistées)
  version: 1;
}
```

> **Robustesse** : toute (re)construction de `body2D` passe par `mergeBody2D(g, patch)`
> ([useHexapodStore.ts](../src/store/useHexapodStore.ts)) qui repart de l'existant + un patch —
> ainsi aucun setter (`setLegAnchor`, `setServoMarker`, `setShapes`, mesures…) ne peut **perdre** un
> autre champ. Ne jamais reconstruire un `body2D` à la main ailleurs.

```ts

interface HexapodGeometry { chassis; segments; cog; legLayout?; body2D?: Body2D }
```

**Conventions de repère** (cohérentes avec `kinematics.computeFootTip`) :
- `X` monde = **avant** du robot → vers le **haut** de l'écran.
- `Z` monde = **côté droit** → vers la **droite** de l'écran.
- Écran : `sx = cx + z·scale`, `sy = cy − x·scale` (`scale` = px/m). Voir
  [src/ui/robot2d/canvas2d.ts](../src/ui/robot2d/canvas2d.ts) (`worldToScreen`/`screenToWorld`).
- Direction d'une patte depuis `yawDeg` : `(dx, dz) = (cos yaw, −sin yaw)`.

### Point d'injection unique vers la 3D

`computeLegMounts(geom)` ([hexapod.ts](../src/model/hexapod.ts)) : si `body2D.anchors` contient 6 entrées,
elles **font autorité** (position/yaw) ; sinon repli paramétrique `star`/`linear`. Tous les
consommateurs 3D (Scene, Hexapod, cinématique, démarche, collisions, salle) en dérivent
automatiquement. `defaultAnchorsFromGeometry(geom)` sème les 6 ancrages depuis le paramétrique.

---

## 4. Fusion booléenne (bake)

[src/model/chassisBake.ts](../src/model/chassisBake.ts) — dépend de **`polygon-clipping`** (npm).

- `bakeRealShapes(shapes)` : **union** des formes réelles `add`, puis **différence** des `subtract`
  (découpes) → `pieces: ChassisPiece[]` + `bbox`. Coordonnées `Pt2{x,z}` ↔ `[x, z]` pour la lib ;
  1er anneau = contour, suivants = trous. Parties détachées ⇒ **plusieurs morceaux**.
- `realShapesOverlap(shapes)` : détecte un chevauchement entre deux formes `add` (propose la fusion).
- `fuseRealShapes(shapes, makeId)` : **non-destructif** — ajoute l'union (contour `add` + trous
  `subtract`) sur le calque réel ET **archive les formes d'origine sur le calque virtuel** (récupérables :
  les remettre en réel puis supprimer la fusion pour revenir en arrière).
- `tessellateCircle(cx, cz, r, segs=48)` : cercle → polygone.

`setShapes` (store) **rebake** systématiquement `pieces` et met à jour `chassis.length/width` = bbox des
morceaux (cohérence cinématique / CoG / appuis sol, qui utilisent la boîte englobante).

### Validité du tracé

[src/model/polygon.ts](../src/model/polygon.ts) :
- `ringIssues(pts)` : arêtes qui se croisent (test d'orientation) + sommets confondus.
- `untangleRing(pts)` : **dé-croisement 2-opt** (inverse le sous-chemin entre deux arêtes qui se
  croisent ; converge car réduit le périmètre) → bouton « Corriger automatiquement ».
- `chassisValidity`, `autoFixChassis` : agrégats contour + trous (legacy).

---

## 5. Extrusion 3D

[src/model/chassisShape.ts](../src/model/chassisShape.ts) → `buildChassisGeometry(outer, holes, height)` :
`THREE.Shape` (+ `Path` pour les trous) extrudé le long de Y, recentré. Mapping cohérent avec
l'ancienne `boxGeometry` (length=X, height=Y, width=Z).

Rendu **un mesh par morceau** :
- [src/three/Hexapod.tsx](../src/three/Hexapod.tsx) → `ChassisMesh` : si `pieces?.length` ⇒ un mesh
  extrudé par pièce ; sinon `points` legacy (1 pièce) ; sinon `boxGeometry` (repli). Dispose des
  géométries en cleanup.
- [src/three/MiniHexapod.tsx](../src/three/MiniHexapod.tsx) : idem pour les **vignettes**.
- [src/three/RoomScene.tsx](../src/three/RoomScene.tsx) utilise `Hexapod` (la salle reflète la forme).

---

## 6. Éditeur 2D

### Composants — [src/ui/robot2d/](../src/ui/robot2d/)

| Fichier | Rôle |
|---|---|
| `Robot2DPage.tsx` | Layout (réutilise `.layout`/`.sidebar`/`.viewer`), monte la barre d'outils, **raccourcis Ctrl+Z/Y**, **init historique**, **autosave**. |
| `Robot2DToolbar.tsx` | Barre flottante : outils + **sélecteur de calque (Réel/Virtuel)** + undo/redo/recentrer/effacer mesures. |
| `Robot2DLeftPanel.tsx` | Éléments (châssis/pattes) + **trame d'historique** cliquable. |
| `Robot2DToolsPanel.tsx` | Liste des formes par calque (sélection, **Matière/Découpe**, suppression, **Promouvoir en réel**), **Fusionner**, validité, ancrage patte sélectionnée, grille, actions. |
| `Robot2DCanvas.tsx` | Le canevas SVG (face **Dessus**, plan XZ) : rendu + toutes les interactions. |
| `Robot2DProfile.tsx` | Vue **profil** (Avant/Côté) — lecture seule : châssis à hauteur réelle + pattes projetées à plat. |
| `canvas2d.ts` | Helpers purs : transforms monde↔écran, yaw↔dir, snapping, point-dans-polygone, cotes. |

### Outils (état dans [src/store/useRobot2DStore.ts](../src/store/useRobot2DStore.ts), **non persisté**)

`tool ∈ { select, pen, rect, circle, placeServo, measure }`, `activeLayer`, `selectedShapeId`,
`penPoints`, `snapEnabled`, `snapStepCm` (**défaut 0,1 cm = 1 mm**), `showServos`, `zoom`, `pan`,
`fitEpoch`, `measurements`, `pendingMeasure`. `newShapeId()` génère les ids (pas de `Date`/`Math.random`).

- **Crayon** : clic = point (aimanté) ; ferme par double-clic / **Entrée** / clic près du 1er point.
- **Rectangle / Cercle** : glisser ; **badge de dimensions live** au-dessus pendant le tracé.
- **Sélection** : clic = sélectionner (tout l'intérieur est saisissable via `pointer-events: all`),
  glisser l'intérieur = déplacer ; les **poignées de sommets s'affichent dès la sélection** (glisser =
  éditer, « + » sur arête = ajouter, double-clic sur un sommet = supprimer), **Suppr** = retirer la forme.
  Le panneau permet de **changer une forme de calque** (réel ↔ virtuel) et, pour le réel, Matière/Découpe.
- **Servos** : les 6 **servos coxa** sont dessinés en **vue de dessus à l'échelle** (empreinte
  `l × w` du type de servo du projet, `coxaServoDimsM` ← `findServoType` / `hardware.servoTypeId`),
  avec leur **pignon de sortie** (cercle ambre) confondu avec l'**ancrage de la patte** (axe coxa).
  Le corps est orienté **le long de la patte** par défaut puis **ajustable**. En mode « Servos » :
  **glisser le corps = déplacer** le servo — comme le pignon = l'ancrage, l'axe coxa (et la patte) suit
  (drag `kind:"coxaMove"`). **Aimantation d'objet** (`snapCoxa`, témoin cyan) : sommets, **milieux de bords**
  et **centres** des formes/morceaux ; à défaut, si le pointeur est dans une barre, aimante le **centre
  vertical (X)** de cette barre ; sinon grille. **Poignée de rotation** (point accent à l'extrémité de sortie) =
  pivoter autour du pignon (`coxaServos[].angleOffsetDeg`, aimanté au degré si la grille est active) ;
  **double-clic** sur le corps = réoriente le long de la patte. Fémur/tibia restent des marqueurs
  schématiques déplaçables (double-clic = réinitialiser).
- **Mesurer** : cote CAO (départ→arrivée) avec longueur, **étiquette déplaçable** (décalage), double-clic
  supprime. **Aimantation** sur sommets/ancrages/servos/cotes (témoin cyan ; priorité point > grille >
  arrondi mm). **Verrouillage d'axe** horizontal/vertical (≤ ~5°) : ligne verte + drapeau ↔/↕.

### Faces & profil (sélecteur bas-gauche)

Un **sélecteur de face** (coin bas-gauche, `Robot2DPage`) bascule l'affichage via `useRobot2DStore.face`
(`top` | `front` | `side`, non persisté) :

- **Dessus** (`top`) : éditeur complet `Robot2DCanvas` (plan XZ), inchangé.
- **Avant** (`front`, depuis +X) / **Côté** (`side`, depuis +Z) : `Robot2DProfile` — projection
  orthographique sur le plan du profil (horizontal = Z ou X, vertical = Y), réutilise `worldToScreen`
  en mappant (x = vertical, z = horizontal). Châssis tracé à sa **hauteur réelle** (`chassis.height`).
  Chaque partie est un bloc distinct à sa **hauteur de profil** `segmentHeights` (par patte, m) :
  - **coxa** = bloc de **matière** reliant le servo coxa (à l'ancrage) au servo fémur (au joint) — les
    deux servos sont dessinés par-dessus ; hauteur **bornée [hauteur servo, hauteur châssis]**.
  - **fémur** = bloc à sa hauteur de profil.
  - **tibia** = **trapèze conique** : hauteur au **genou** (`tibia`, défaut = **largeur du servo**
    `dimensionsMm.w`) → hauteur au **pied** (`tibiaFoot`). Le défaut genou (largeur servo) est résolu
    dynamiquement (`projectServoWidthM` dans le store, et au point de lecture).
  - **Édition** : panneau droit, section « Hauteur de face — Patte N » — Coxa (bornée), Fémur,
    Tibia (genou), Tibia (pied) (`setSegmentHeight` / `applySegmentHeightsToAll`).
    Cliquer une patte la **sélectionne**.
  `segmentHeights` est déclaré dans `HexapodGeometrySchema` + préservé par `setGeometry`.

**Report en 3D & aperçus** : `segmentWidths` → **profondeur Z** et `segmentHeights` → **hauteur Y**
des segments dans [Leg.tsx](../src/three/Leg.tsx) et [MiniHexapod.tsx](../src/three/MiniHexapod.tsx)
(coxa bornée servo↔châssis, fémur, **tibia conique** genou→pied via `makeTaperedBox`
[legGeometry.ts](../src/three/legGeometry.ts)). Les **aperçus de pattes** de Projet › Général
([RobotPreviews.tsx](../src/ui/RobotPreviews.tsx) `LegTiles`) tracent les bandes à la largeur réelle
ainsi que l'empreinte servo coxa. Vignettes invalidées via `computeThumbnailContext` (clés `sw`, `sh`).

### Navigation
- **Molette** = zoom. **Clic droit** ou **Ctrl+clic gauche** glissé = panoramique (dans tous les outils,
  donc même pendant le crayon). Menu contextuel désactivé sur le canevas.
- **Échelle figée** (`fitScale`) : recalculée seulement au resize et au recentrage (`fitEpoch`), jamais
  pendant un drag (sinon la vue « respire » et le point ne suit pas le curseur).
- **Calques** : virtuel = gabarit gris pointillé **dessous** ; réel = jaune ; les morceaux fusionnés
  sont remplis en jaune. En mode dessin/mesure, le contenu passe `pointer-events: none` (classe
  `.passthrough`) pour pouvoir tracer par-dessus.

### Export / Import du robot

Via l'éditeur JSON (topbar **Outils → Import/export**, [ToolsModal.tsx](../src/ui/ToolsModal.tsx)) : une
source **« Mon robot »** en haut de l'arbre charge la **base mécanique complète** (`serializeProfile()` :
géométrie + `body2D` + poses + calibration…) dans la vue code. Boutons Copier / Télécharger / Charger un
fichier ; **Importer / Appliquer** relit le JSON (`applyProfile`) et persiste via `useProfilesStore.update`.

### Interactions avancées

- **Menu contextuel** (clic droit sur une forme) : Centrer sur l'origine, Dupliquer (+5 cm), Symétrie
  horizontale/verticale (copie miroir autour de l'origine), Mettre en arrière/avant (calque), Supprimer.
- **Étiquette de dimensions** : au survol/sélection (mode select). Pour la forme sélectionnée elle est
  **éditable** (largeur×hauteur, ou **Ø diamètre** si cercle) → met la forme à l'échelle. Détection de
  cercle via `circleInfo` (polygone à rayons quasi égaux) ; **indicateur de centre** sur les cercles.
- **Déplacement clavier** : flèches déplacent la forme sélectionnée du **pas clavier** (`keyboardStepCm`,
  défaut 0,01 cm).
- **Accroche d'objet** : en déplaçant une forme, son **centre** s'aimante aux sommets, **milieux d'arêtes**
  (= centres de côté) et centres des autres formes (témoin cyan).
- **Clic droit / Ctrl+clic** sur le fond = panoramique (dispo même en mode crayon).
- Toutes les cotes sont au format **0.00 cm** ; diamètre de cercle aimanté à la grille au tracé.

### Grille hiérarchique
Calée sur les centimètres, pas mineur choisi selon le zoom (0,5 / 1 / 2 / 5 … cm, ≥ ~9 px/ligne).
3 niveaux : mineur (fin), **multiples de 1 cm** (medium), **multiples de 5 cm** (major). En coordonnées
monde (alignée sur l'origine robot).

---

## 7. Historique & autosave

- **Historique** : [src/store/useRobot2DHistory.ts](../src/store/useRobot2DHistory.ts) — pile
  d'instantanés de `geometry`, curseur ; `commit(label)`/`commitHistory(label)`, `undo`/`redo`/`jumpTo`,
  réapplique via `useHexapodStore.replaceGeometry`. Commit en **fin de geste** (pointerup) et sur actions
  discrètes. `reset()` au montage de l'onglet. Trame affichée dans le panneau gauche.
- **Autosave** : effet dans `Robot2DPage` — sur changement de `geometry`, si `isProfileDirty()` et base
  active, **`useProfilesStore.update({ guardEmptyBody2D: true })` débouncé 1 s**. **Garde-fou anti-perte** :
  l'autosave refuse de remplacer un tracé non vide déjà enregistré par un `body2D` vide
  (`savedBody2DStrength` comparé à la richesse courante) — toast d'avertissement, rien n'est écrasé ;
  les enregistrements explicites (modale) ne sont pas bloqués. Persiste tout `body2D` (formes réelles **et**
  virtuelles, morceaux, ancrages, marqueurs servo, **mesures**) ; survit au refresh via
  `ensureBase`→`applyProfile`. Seul `pendingMeasure` (cote en cours de tracé) reste transient
  (`useRobot2DStore`).

---

## 8. Persistance & rétro-compat

- `serializeProfile`/`applyProfile` ([useHexapodStore.ts](../src/store/useHexapodStore.ts)) sérialisent
  toute la `geometry` (donc `body2D`). `profileCoreSignature` (hors layout) sert au « dirty ».
- **Migration** dans `applyProfile` : si un ancien profil n'a que `body2D.points` (sans `shapes`), il est
  converti en `shapes=[{real,add,points}]` + `pieces=[{outer:points,holes}]` au chargement.
- **Vignettes** : `usePoseThumbnailStore.computeThumbnailContext` intègre `pieces` (sinon `points`) +
  `anchors` pour invalider les vignettes quand le châssis/les pattes changent.

### ⚠️ Piège backend (résolu)

Le schéma zod du serveur **supprime les champs inconnus**. `body2D` doit être déclaré dans
[server/src/schemas.ts](../server/src/schemas.ts) (`Body2DSchema` + `.passthrough()` dans
`HexapodGeometrySchema`) — sinon **toutes les données 2D sont effacées à l'enregistrement**. Toute
nouvelle sous-structure de `body2D` doit y être ajoutée (ou rester couverte par `.passthrough()`).
Déjà déclarés : `coxaServos` (`CoxaServoSchema`) côté body2D, et `shaftOffsetMm` / `pinionDiamMm`
(optionnels) dans `ServoSpecSchema` + seed `server/src/catalogs/seedData.ts`.

⚠️ `HexapodGeometrySchema` (niveau `geometry`) n'est **pas** `.passthrough()` : tout nouveau champ
de géométrie y est supprimé s'il n'est pas déclaré. Déjà ajouté : **`segmentWidths`** — tableau **par
patte** (index 0..5) de `{coxa,femur,tibia}` (épaisseur vue de dessus, m). `setGeometry` le **préserve**
explicitement sur les maj partielles ; lecture par patte via `segmentWidthsOf(geom, legIndex)` (repli
`DEFAULT_SEGMENT_WIDTHS`). Édition dans le panneau droit (section « Épaisseur — Patte N », champs `Field`
en **saisie texte** tolérant la virgule) ; setters `setSegmentWidth(legIndex, part, v)` /
`applySegmentWidthsToAll(legIndex)` (bouton « Appliquer aux autres pattes »). Rendu **2D** : une
**bande rectangulaire** par partie le long du tracé (`bandPoly`). Rendu **3D** : la largeur pilote la
**profondeur Z** des segments (boîtes plates type MDF) dans [Leg.tsx](../src/three/Leg.tsx) et
[MiniHexapod.tsx](../src/three/MiniHexapod.tsx) ; intégrée au contexte d'invalidation des vignettes
(`computeThumbnailContext`, clé `sw`). Persistance vérifiée (round-trip zod).
Le serveur tourne en `ts-node-dev --respawn` (rechargement auto en dev).

---

## 9. Carte des fichiers

```
src/model/hexapod.ts        Types body2D + computeLegMounts (injection 3D)
src/model/chassisBake.ts    Union/différence (polygon-clipping), tessellation cercle
src/model/chassisShape.ts   Extrusion THREE d'un morceau
src/model/polygon.ts        Validité + dé-croisement 2-opt
src/store/useHexapodStore.ts   geometry, setShapes/setLegAnchor/setServoMarker/replaceGeometry
src/store/useRobot2DStore.ts   état éditeur (outils, calque, mesures, vue) — non persisté
src/store/useRobot2DHistory.ts annuler/rétablir
src/store/useProfilesStore.ts  ensureBase (singleton)
src/ui/robot2d/*               Page, Toolbar, LeftPanel, ToolsPanel, Canvas, canvas2d
src/three/Hexapod.tsx, MiniHexapod.tsx   ChassisMesh multi-morceaux
server/src/schemas.ts          Body2DSchema (NE PAS oublier d'étendre)
```

## 10. Vérification rapide

`npm run dev:all` (API + UI) → onglet **Robot 2D** :
1. Calque **Réel**, outil **Rectangle** → tracer ; **F5** → la forme persiste (sinon vérifier `schemas.ts`).
2. Deux rectangles qui se chevauchent → **Fusionner** ; deux détachés → 2 morceaux en **Conception 3D**.
3. Calque **Virtuel** : gabarit gris, aimantation, **Promouvoir en réel**. **Découpe** → trou en 3D.
4. **Mesurer** : aimantation au mm + témoin, verrouillage d'axe ↔/↕, longueur live.
5. **Ctrl+Z** / trame d'historique. `npm run build` propre.
