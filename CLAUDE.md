# CLAUDE.md — Référence projet HexaGram

Application web 3D pour concevoir, visualiser et programmer un **hexapode 18 DOF**
(6 pattes × 3 servos). Projet personnel ; le robot physique est un châssis MDF jaune
découpé laser piloté à terme par une carte (SSC-32U / Arduino). Voir [README.md](README.md).

## Stack & commandes

- **Front** : React 18 + TypeScript + Vite, Three.js via `@react-three/fiber` + `@react-three/drei`,
  état via **Zustand**, géométrie booléenne via `polygon-clipping`.
- **Back** : Node + Express + SQLite (`node:sqlite`, `DatabaseSync`), validation **zod**, auth JWT. Dossier `server/`.

```bash
npm run dev:all   # API (server/) + UI (vite) en parallèle — usage principal
npm run dev       # UI seule
npm run build     # tsc -b && vite build (vérif type + bundle)
cd server && npm run dev   # API seule (ts-node-dev --respawn, reload auto)
```

Après une modif, **valider avec `npm run build`** (tsc strict). Toujours vérifier le build avant de
conclure « c'est fait ».

## Architecture (essentiel)

- **Source de vérité géométrie** : `useHexapodStore.geometry` (`HexapodGeometry`, dont `body2D`).
  Tout le rendu 3D dérive de **`computeLegMounts(geometry)`** dans
  [src/model/hexapod.ts](src/model/hexapod.ts) — **seul point d'injection** de la 2D vers la 3D.
- **Stores Zustand** (`src/store/`) : `useHexapodStore` (robot live), `useProjectStore` (projet+matériel),
  `useProfilesStore` (**base mécanique unique** par projet, `ensureBase`), `useToolboxStore`
  (onglets/layout, `AppTab`), `useRobot2DStore` / `useRobot2DHistory` (éditeur 2D), `useSequencerStore`,
  `useProgramsStore`, `useCatalogStore`, `useSerialStore` (liaison série + envoi/miroir robot), `useAuthStore`.
- **Angles & montage servo** : les angles de pose sont en **repère servo** (0 = centre du servo). Le
  rendu 3D et la cinématique appliquent `géométrique = pose + mountingOffsetsDeg` (`mountingOffsetOf`
  dans [src/model/hexapod.ts](src/model/hexapod.ts)) ; défaut **tibia −90°** = perpendiculaire au centre.
  Distinct de la calibration électronique (`centerOffsetDeg`/`invert`, appliquée à l'envoi). Détails :
  [docs/idee-calibration-servos.md](docs/idee-calibration-servos.md).
- **Électronique / robot réel** : onglet `electronique` = calibration **par servo** (canal, sens, zéro,
  butées dans `hardware.electronics.bindings`). [src/store/useSerialStore.ts](src/store/useSerialStore.ts)
  pilote la liaison Web Serial : `sendPose`/`sendPoseLive` (clampés aux butées `minDeg/maxDeg`), **mode
  Live** (miroir 3D→robot, [docs/idee-reproduction-3d-robot.md](docs/idee-reproduction-3d-robot.md)),
  console électronique transverse (bouton Outils). **Reste-à-faire priorisé** (pilotage SSC-32U) :
  [docs/roadmap-pilotage-ssc32u.md](docs/roadmap-pilotage-ssc32u.md) — point d'entrée pour la suite.
- **Routage** : pas de react-router. Onglets pilotés par `useToolboxStore.uiPrefs.activeTab` + sync URL
  dans [src/hooks/useUrlState.ts](src/hooks/useUrlState.ts). Onglets :
  `projet · robot2d · conception · programmation · electronique · admin`.
- **Persistance** : profil = blob JSON `RobotProfileData` (table `robot_profiles`), validé par
  [server/src/schemas.ts](server/src/schemas.ts). `serializeProfile`/`applyProfile` côté store.
- **Modèle** (`src/model/`) : `hexapod` (géométrie, servos, ancrages), `kinematics` (FK, transform corps),
  `servo`, `pose`, `collisions`, `gaitGenerator`, `chassisBake`/`chassisShape`/`polygon` (Robot 2D).

## Robot 2D & base mécanique

Sous-système central documenté en détail : **[docs/robot-2d-base-mecanique.md](docs/robot-2d-base-mecanique.md)**.
À lire avant toute évolution de l'onglet Robot 2D, du modèle `body2D` ou du châssis 3D.

## Pièges à connaître

- **Schéma serveur strict** : zod **supprime les champs inconnus**. Tout nouveau champ de `body2D`
  (ou de `geometry`/profil) doit être déclaré dans [server/src/schemas.ts](server/src/schemas.ts)
  (`Body2DSchema` est en `.passthrough()`), sinon il est **silencieusement perdu à l'enregistrement**.
- **`computeLegMounts`** : modifier ce calcul impacte toute la 3D (scène, cinématique, démarche,
  collisions, salle, vignettes).
- **Offset de montage = repère des angles** : `geometry.mountingOffsetsDeg` décale pose↔géométrie. Il
  est appliqué dans **tous** les sites qui dérivent la géométrie d'une pose (FK `computeFootTip`/
  `computeLegCom`, IK foot-drag, démarche, collisions, couple, vignettes `MiniHexapod`, rendu `Leg`) —
  en oublier un désynchronise le rendu. Changer la convention impose une **migration** des angles
  stockés (cf. `runMountingOffsetMigration` dans [server/src/db.ts](server/src/db.ts), guard
  `PRAGMA user_version`).
- **Vignettes** : `usePoseThumbnailStore.computeThumbnailContext` doit inclure tout ce qui change le
  visuel (géométrie, ancrages, morceaux châssis) pour invalider correctement.
- **IDs de formes 2D** : `newShapeId` combine `Date.now()` + compteur pour rester unique **après un
  rechargement** (un simple compteur repart de 0 et entre en collision avec les formes déjà chargées →
  deux formes sélectionnées à la fois). `applyProfile` dé-duplique aussi les ids au chargement.

## Conventions

- **Langue** : tout en **français** (UI, commits, docs, réponses à l'utilisateur).
- **Aucune attribution IA** dans les artefacts du repo (README, commits, docs, code).
- **Déploiement uniquement sur ordre explicite** (« déploie ») via `deploy/deploy.ps1` sur la VM
  freebox (Caddy → <https://hexagram.davidlardy.com>). Ne jamais déployer spontanément.
- **Références de fichiers** : liens markdown relatifs `[texte](chemin)`.
- Respecter le style du code environnant (densité de commentaires, nommage, idiomes).
