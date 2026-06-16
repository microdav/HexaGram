# Pilotage robot SSC-32U — backlog priorisé

Contexte : on pilote le **Lynxmotion SSC-32U en USB** (Web Serial). Ce document liste le
reste-à-faire **réalisable à ce stade** (sans BLE/WiFi ni carte de commande relais), pour une
prochaine session de développement. Ordre de priorité décidé : **P1 → P2 → P3 → P4** (puis « plus
tard »). La numérotation `#n` rappelle le regroupement d'origine.

## Déjà en place (ne pas refaire)

- Calibration **par servo** (canal, `invert`, `centerOffsetDeg`, butées `minDeg/maxDeg`) + assistant
  guidé + cartes patte — onglet Électronique.
- Liaison série Web Serial ([useSerialStore](../src/store/useSerialStore.ts)) : connexion, `sendPose`
  / `sendPoseLive` (**clampés aux butées** via `clampToServoLimits`), **mode Live** (miroir 3D→robot,
  continu ou « au relâchement »), **couple off**, console électronique transverse, `VER`.
- Envoi **groupé** `SerialProtocol.moveGroup` (un seul `#.. P.. T..\r`).
- Pose en **repère servo** + offset de montage (cf. [calibration](idee-calibration-servos.md)).
- Sous-onglet **« Séquence → carte »** (Électronique) : construit un script SSC-32U (groupes + `T`)
  envoyé via `sendRaw` ([src/model/sequenceScript.ts](../src/model/sequenceScript.ts)). ⚠️ À relire
  avant P3 pour bâtir dessus plutôt que dupliquer.

---

## P1 — Robustesse de la liaison _(#4)_

Objectif : une liaison qui ne « lâche » jamais silencieusement, et qui protège le robot.

- **Perte de port / déconnexion USB** : détecter la perte (write qui échoue, `link` fermé), repasser
  proprement en `disconnected`/`error`, message clair, et proposer une **reconnexion** (mémoriser le
  dernier port si l'API le permet).
- **Watchdog couple-off** : si plus aucune trame n'est envoyée pendant N secondes en mode Live (ou sur
  erreur), couper le couple (`releaseAll`) pour ne pas laisser les servos forcer/chauffer.
- **États d'erreur** : remonter distinctement « port perdu », « write échoué », « non connecté » dans
  la boîte Liaison robot et la console.
- Fichiers : [useSerialStore.ts](../src/store/useSerialStore.ts), [src/serial/webSerial.ts](../src/serial/webSerial.ts),
  [RobotLinkPanel.tsx](../src/ui/RobotLinkPanel.tsx).
- Critère d'acceptation : débrancher l'USB en plein mode Live → l'UI passe en erreur, couple coupé,
  reconnexion possible sans recharger la page.

## P2 — Mieux exploiter le SSC-32U _(#2)_

Objectif : mouvements plus doux et lecture de l'état réel de la carte.

- **Transition douce par défaut** : appliquer un `T` (ou une **vitesse `S` par canal**) sur les envois
  hors live, pour supprimer les à-coups (aujourd'hui `sendPoseLive` est `T=0`). Exposer un réglage.
- **Retour de position `QP <ch>`** : lire la largeur d'impulsion réelle d'un servo (1 octet = µs/10) →
  « **importer la pose du robot** », vérifier la calibration, repartir d'une manip physique.
  Conversion inverse `pulseUs → deg` à ajouter à [electronics.ts](../src/model/electronics.ts).
- **Requête mouvement `Q`** : `+` tant qu'un mouvement est en cours, `.` sinon (prérequis de P3).
- **`STOP<ch>`** + `Q`/`QP` accessibles depuis la console pour le debug.
- Fichiers : [electronics.ts](../src/model/electronics.ts) (protocole : ajouter `query`/`speed`,
  parseur `QP`), [useSerialStore.ts](../src/store/useSerialStore.ts) (lecture des réponses RX déjà
  journalisée — la corréler à une requête).
- Note : le **baud du SSC-32U se règle par bouton** sur la carte (pas en logiciel, cf. guide officiel
  SSC-32U) ; juste s'assurer que `baudRate` correspond côté app.

## P3 — Locomotion réelle depuis la salle d'exécution _(#1)_

Objectif : faire **se déplacer le vrai robot**, pas seulement le mirroir frame-à-frame.

- **Lecture pas-à-pas → robot avec `T` par transition** : le SSC-32U interpole lui-même (plus fluide,
  ménage les servos) au lieu de streamer 25 Hz. Brancher sur la lecture de séquence/programme et le
  « Run » de la salle d'exécution.
- **Synchronisation par `Q`** (dépend de P2) : enchaîner un pas seulement quand le précédent est
  terminé, plutôt qu'un timer aveugle.
- Réutiliser/consolider le **« Séquence → carte »** existant et le `T`/`stepDelay` du séquenceur.
- Fichiers : salle d'exécution ([src/three/RoomScene.tsx](../src/three/RoomScene.tsx),
  [src/three/Room.tsx](../src/three/Room.tsx)), [useSequencerStore](../src/store/useSequencerStore.ts),
  [sequenceScript.ts](../src/model/sequenceScript.ts), [useSerialStore.ts](../src/store/useSerialStore.ts).
- Critère d'acceptation : lancer une démarche tripod depuis la salle → le robot marche, pas
  synchronisés, sans à-coups ni forçage.

## P4 — Sécurité & fidélité _(#3)_

Objectif : que la 3D ne « mente » pas sur ce que le robot peut faire.

- **Butées visibles en 3D** : aujourd'hui le clamp n'est qu'à l'envoi ; indiquer (ou limiter) dans la
  Conception 3D quand une pose dépasse les butées calibrées, pour ne pas « perdre » du mouvement
  silencieusement. Lien arcs servo / IK ↔ `minDeg/maxDeg` du binding.
- **Soft-start** : au premier envoi après connexion, rejoindre la pose courante en douceur (rampe /
  `T` long) plutôt qu'un saut brutal.
- Fichiers : [Leg.tsx](../src/three/Leg.tsx) / [ServoArc.tsx](../src/three/ServoArc.tsx),
  [useSerialStore.ts](../src/store/useSerialStore.ts).

---

## Plus tard _(#5)_

- Bibliothèque de poses/séquences prédéfinies.
- Rafraîchir l'arbre « Organisation du code » + « Vision de l'interface » du [README](../README.md)
  (illustratifs, périmés).

## Hors-scope tant qu'on est sur SSC-32U USB

- Liaison **sans-fil** tablette (BLE / WiFi), relais par **carte de commande** (ESP32) — l'abstraction
  existe (`ConnTarget` « controller » / « command », `GENERIC_ASCII_PROTOCOL`) mais sans transport.
- Packaging **Tauri** (Windows) / **PWA** (tablette).

## Repères SSC-32U (aide-mémoire)

- Position : `#<ch> P<µs> [S<µs/s>] [T<ms>] <cr>` ; **groupe** = plusieurs `#ch Pµs` puis un seul `T`.
- `#<ch> P0` = **relâche** (couple off). `STOP<ch>` = stoppe un canal.
- `Q` → `+` (mouvement en cours) / `.` (fini). `QP <ch>` → 1 octet = µs/10. `VER` → version.
- Conversion angle↔µs : `angleToPulseUs` (sens + zéro + bornes) dans
  [electronics.ts](../src/model/electronics.ts).
