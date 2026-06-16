# Écran lié — pilotage temps réel entre plusieurs PC

Permet à plusieurs ordinateurs connectés au **même compte** de partager le pilotage du robot
en temps réel : un PC distant manipule le robot 3D, et ses mouvements sont reproduits sur le PC
branché en USB — qui les relaie au robot physique.

## Principe

- Chaque navigateur est un **appareil** identifié par un id persistant (`hexagram.deviceId`) et un
  **nom éditable** (`hexagram.deviceName`), tous deux en `localStorage`.
- Tous les appareils d'un compte rejoignent une **room** (clé = `userId` du JWT) via le WebSocket
  `/api/ws`. Le serveur relaie les messages et tient l'état éphémère (présence + verrou de contrôle)
  **en mémoire** — aucune table SQLite.
- **On ne synchronise que la pose 3D** (18 angles). Le PC distant pilote, les autres rejouent la pose
  (`applyPose`). Le PC branché USB, en suiveur, **renvoie la pose au robot via son Mode Live**
  (pipeline `useSerialStore` inchangé). Conséquence directe : **le robot ne bouge que si l'hôte a
  activé le Mode Live**.

## Contrôle et garde-fous

- **Verrou unique** : un seul pilote à la fois par room.
- **L'hôte USB est gardien** : il prend la main sur son robot dès qu'il se connecte en USB.
- Un appareil distant demande le contrôle → le gardien reçoit une popup **Accepter / Refuser**
  (`src/ui/ControlRequestModal.tsx`), ou l'accorde automatiquement si l'appareil figure dans la liste
  autorisée du projet (**Projet → Écran lié**, `preferences.linkedScreen.autoGrant`).
- L'hôte peut **reprendre le contrôle** à tout moment. L'**arrêt d'urgence** et le **watchdog** 90 s
  restent locaux à l'hôte.
- Mode **désactivé par défaut** (opt-in, comme le Mode Live) ; nécessite un compte connecté.

## Carte des fichiers

- **Serveur** : [server/src/realtime.ts](../server/src/realtime.ts) (hub WebSocket : auth par premier
  message `hello`, présence, verrou, relais de pose), branché dans
  [server/src/index.ts](../server/src/index.ts) via `http.createServer`. Champ
  `linkedScreen` déclaré dans `ProjectPreferencesSchema` ([server/src/schemas.ts](../server/src/schemas.ts),
  schéma **strict**).
- **Client** : store [src/store/useLinkStore.ts](../src/store/useLinkStore.ts) (identité, cycle WS,
  contrôle, émission/réception de pose throttlée 40 ms avec garde anti-écho). UI : badge bandeau
  [src/ui/LinkedScreenBadge.tsx](../src/ui/LinkedScreenBadge.tsx), réglages projet
  [src/ui/LinkedScreenSettings.tsx](../src/ui/LinkedScreenSettings.tsx).
- **Réseau** : Caddy proxifie `/api/*` (WebSocket compris) → `localhost:3001` en prod ; en dev, le
  proxy Vite est en `ws: true` ([vite.config.ts](../vite.config.ts)).

## Protocole WebSocket (JSON)

- Client → serveur : `hello {token, deviceId, deviceName, usbConnected, projectId}`, `pose {pose[18]}`,
  `presence-update {usbConnected, projectId, deviceName}`, `control:request`,
  `control:grant {toDeviceId}`, `control:deny {toDeviceId}`, `control:revoke`, `ping`.
- Serveur → client : `presence {devices[], controlHolderId, hostId}`, `pose {pose, fromDeviceId}`,
  `control:requested {fromDeviceId, fromName}` (au gardien), `control:granted`, `control:denied`,
  `error {message}`, `pong`.

## Tester en local

1. `npm run dev:all`, puis ouvrir **deux navigateurs/fenêtres** connectés au même compte.
2. Activer l'écran lié des deux côtés (badge du bandeau).
3. Fenêtre A : « Prendre le contrôle » → la fenêtre B (hôte) reçoit la popup → Accepter. Bouger un
   servo dans A se reproduit dans B.
4. Brancher le robot sur B + **Mode Live ON** → le robot suit les mouvements pilotés depuis A.
5. Cocher l'appareil A dans **Projet → Écran lié** → prises de contrôle suivantes sans demande.

## Hors périmètre (évolutions possibles)

Co-navigation (onglet actif, sélection de pose/étape, lecture séquenceur), édition partagée
(géométrie, Robot 2D, calibration électronique), persistance serveur de l'historique des appareils.
