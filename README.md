# HexaGram

Application web 3D pour visualiser, manipuler et programmer un hexapode robotique à
18 degrés de liberté. Destinée à terme à devenir un outil complet de conception et
de pilotage : visualisation paramétrique du squelette mécanique, édition de séquences
de mouvements, et communication sans-fil avec la carte de contrôle du robot.

> Statut : preuve de concept (POC) visuelle fonctionnelle. La géométrie et la
> cinématique correspondent au robot physique réel ; la couche de communication
> avec le matériel n'est pas encore implémentée.

![Interface HexaGram — POC](docs/screenshots/main-view.png)

---

## Le contexte

Ce dépôt accompagne un projet personnel : un hexapode jaune, châssis MDF découpé
laser, **6 pattes × 3 servomoteurs = 18 DOF**, conçu autour d'une carte Arduino
(architecture matérielle non finalisée). À terme, la carte sera complétée d'un
module sans-fil (BLE ou WiFi) pour permettre le pilotage depuis une tablette
indépendamment d'un PC.

Le besoin initial est de pouvoir **manipuler le robot virtuellement** avant tout
chargement de mouvements dans la machine réelle : positionner les pattes une à une,
capturer des poses, enchaîner les poses en séquences de marche / mouvement, puis
exporter ces séquences vers le robot. L'application doit fonctionner indifféremment
sur PC Windows et sur tablette, d'où le choix d'une stack web (packageable plus
tard en binaire Windows via Tauri ou en PWA installable sur tablette).

### Spécifications du robot physique

| Élément | Valeur mesurée |
|---|---|
| Châssis | 34 cm (longueur) × 18 cm (largeur) × 6.5 cm (hauteur) |
| Segment **coxa** (axe-à-axe) | 5.0 cm |
| Segment **fémur** | 8.0 cm |
| Segment **tibia** | 11.5 cm |
| Pattes | 6, disposées en étoile (3 par côté long) |
| Servos par patte | 3 (coxa = lacet vertical, fémur = tangage, tibia = genou) |

### Architecture cinématique d'une patte

1. **Coxa** — servo monté à plat sur le châssis, axe **vertical** → fait pivoter
   la patte horizontalement (sweep avant/arrière)
2. **Fémur** — axe **horizontal perpendiculaire à la patte** → lève et abaisse
3. **Tibia** — articulé en bout de fémur, axe horizontal → flexion du genou
4. **Pied** — embout caoutchouc au bout du tibia

---

## Vision de l'interface

L'interface se construit autour de **trois zones principales** :

- **Espace 3D central** — vue orbitable de l'hexapode avec sol de référence,
  marqueurs d'orientation et de contact. Doit refléter en temps réel chaque
  modification d'angle servo.
- **Panneau gauche** — paramétrage : géométrie ajustable du robot, options de
  simulation (gravité, etc.), gestion des poses capturées et futures séquences.
- **Panneau droit** — contrôle individuel des 18 servomoteurs avec respect des
  limites mécaniques.

S'ajoutent des **overlays** sur la zone 3D : boussole d'inclinaison du châssis
(synchronisée avec la caméra principale), gizmo cube d'orientation du repère
monde, et bouton de retour à la vue caméra par défaut.

### Fonctionnalités attendues à terme

| Domaine | Cible |
|---|---|
| Visualisation | Vue 3D paramétrique avec orbit/zoom/pan, contrôle de l'inclinaison du châssis selon les appuis (gravité simulée) |
| Contrôle direct | Slider par servomoteur avec limites configurables, lecture/écriture de poses en JSON |
| Séquençage | Timeline éditable de poses avec interpolation, lecture animée, sauvegarde locale et export |
| Cinématique inverse | Manipulation directe du bout d'une patte en 3D, calcul automatique des 3 angles servo |
| Communication robot | Couche de transport abstraite (Web Serial sur PC via USB, BLE/WiFi sur tablette), envoi en mode "live" (servos suivent les sliders en temps réel) ou en mode "batch" (envoi d'une séquence complète) |
| Bibliothèque | Templates de poses et de séquences courantes (marche tripod, demi-tour, salutation, etc.) |

---

## État actuel

### Ce qui fonctionne

- **Modélisation 3D paramétrique** du squelette : châssis + 6 pattes × 3 segments,
  géométrie ajustable en cm depuis l'UI (valeurs par défaut = mesures réelles du
  robot physique).
- **18 sliders servo** organisés par patte, avec respect des limites min/max.
- **Simulation de gravité** réaliste :
  - Ajustement par moindres carrés d'un plan à travers les 6 bouts de patte
  - Le châssis s'incline en fonction des appuis
  - Marqueurs visuels de contact au sol sous les pattes qui touchent
- **Verrouillage de gravité** : en mode gravité activé, le slider fémur d'une
  patte en contact ne peut plus pousser dans le sol (mais peut toujours lever).
- **Capture de poses** : snapshot des 18 angles, restauration en un clic, export JSON.
- **Boussole 3D** en overlay haut-droite : 3 anneaux d'axes colorés (rouge/vert/bleu),
  flèche d'orientation du châssis, caméra synchronisée avec la vue principale,
  verrou cliquable pour la figer.
- **Gizmo cube** en overlay bas-gauche avec étiquettes des axes monde.
- **Bouton Home** pour reset de la caméra à sa position initiale.
- **Marqueurs d'orientation** : flèche plate sur dessus et dessous du châssis,
  petit marqueur sombre sur la face avant.

### Ce qui n'est pas encore fait

- **Séquenceur** : timeline avec durées par keyframe, interpolation, lecture
  animée, chargement de séquences depuis JSON.
- **Cinématique inverse** : manipuler le bout d'une patte directement en 3D.
- **Limites servo réelles** : actuellement valeurs génériques (±45°, ±60°, [-120°, 0°]),
  à remplacer par les vraies plages mécaniques mesurées sur le robot.
- **Communication avec le robot** : abstraction transport + implémentations
  Web Serial (PC/USB) et BLE/WiFi (tablette), définition d'un protocole de
  message vers la carte Arduino.
- **Bibliothèque de poses/séquences** prédéfinies.
- **Packaging** en application Windows (Tauri) ou PWA installable sur tablette.

---

## Stack technique

| Couche | Choix |
|---|---|
| Build | Vite + TypeScript |
| UI | React 18 |
| 3D | Three.js via [`@react-three/fiber`](https://github.com/pmndrs/react-three-fiber) et [`@react-three/drei`](https://github.com/pmndrs/drei) |
| State | [Zustand](https://github.com/pmndrs/zustand) |
| Packaging desktop futur | Tauri (binaire Windows léger) |
| Packaging tablette futur | PWA installable |
| Comm robot future | Web Serial API (Chrome/Edge desktop), Web Bluetooth ou WebSocket (tablette) |

### Organisation du code

```
src/
├── model/         Géométrie, servos, cinématique (pure TypeScript, testable)
│   ├── hexapod.ts        Dimensions, ancrages des pattes, table des 18 servos
│   ├── servo.ts          Définition d'un servo, helpers d'angle
│   ├── pose.ts           Type Pose (18 angles), keyframes
│   └── kinematics.ts     Forward kinematics, ajustement de plan, transform corps
├── three/         Composants 3D React-Three-Fiber
│   ├── Scene.tsx         Canvas principal, lumières, grille, overlays
│   ├── Hexapod.tsx       Châssis, flèches d'orientation, lift gravité
│   ├── Leg.tsx           Patte articulée (3 segments)
│   ├── ContactMarkers.tsx  Anneaux bleus au sol sous les pattes en contact
│   └── Compass.tsx       Boussole d'inclinaison overlay haut-droite
├── ui/            Panneaux HTML
│   ├── GeometryPanel.tsx   Saisie des dimensions
│   ├── ServoPanel.tsx      Sliders + verrouillage gravité
│   ├── PoseList.tsx        Capture/restauration des poses
│   └── SimulationPanel.tsx Toggle gravité
├── store/         État global Zustand + hook dérivé
│   ├── useHexapodStore.ts    Pose, géométrie, keyframes, options
│   └── useBodyTransform.ts   Hook qui recalcule position/rotation du corps
├── App.tsx        Layout général
└── main.tsx       Bootstrap React
```

---

## Lancement local

Prérequis : Node.js ≥ 18.

```bash
npm install
npm run dev
```

Puis ouvrir `http://localhost:5173/`.

Pour accéder depuis une tablette du même réseau : Vite affiche aussi une URL
réseau (`http://<ip>:5173/`) au démarrage.

### Type-check et build

```bash
npm run build      # type-check + build production
npm run preview    # serveur statique pour tester la build
```

---

## Roadmap

| Phase | Description | Statut |
|---|---|---|
| 0 | Setup projet (Vite + TS + R3F + Zustand) | ✅ |
| 1 | POC visuel : modèle 3D, sliders, gravité, capture de poses | ✅ |
| 2 | Séquenceur : timeline, interpolation, lecture animée, persistance | 🔜 |
| 3 | Cinématique inverse (manipulation directe en 3D) | 🔜 |
| 4 | Communication robot (Web Serial / BLE / WiFi) | 🔜 |
| 5 | Packaging Tauri (Windows) + PWA (tablette) | 🔜 |

---

## Licence

Projet personnel — pas de licence publiée à ce stade.
