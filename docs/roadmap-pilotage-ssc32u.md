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
- **P1 — Robustesse de la liaison** (cf. ci-dessous, ✅ fait) : détection de perte de port + bouton
  « Reconnecter » sans recharger, erreurs typées (`errorKind`), watchdog couple-off (90 s d'inactivité
  en mode Live).
- **P2 — Mieux exploiter le SSC-32U** (cf. ci-dessous, ✅ fait) : transition douce par défaut
  (`transitionMs` partagé), import pose via `QP` (`pulseUsToAngle` + `SerialLink.requestBytes`),
  requête `Q`, `STOP`, et console debug (Q/QP/STOP + commande brute).

---

## P1 — Robustesse de la liaison _(#4)_ — ✅ FAIT

Objectif : une liaison qui ne « lâche » jamais silencieusement, et qui protège le robot.

Livré :

- **Perte de port / déconnexion USB** : `SerialLink` détecte la perte via l'événement
  `navigator.serial` `"disconnect"` **et** la fin/erreur de la boucle de lecture (hors déconnexion
  volontaire), expose un callback `setOnLost`. Le dernier port est mémorisé (`lastPort`) et
  `reconnect()` le rouvre sans re-sélection (sinon port déjà autorisé, sinon `requestPort`).
- **États d'erreur typés** : `errorKind` = `port-lost` / `write-failed` / `connect-failed` /
  `not-connected` → message distinct dans la boîte Liaison robot + console. Boutons **« ↻ Reconnecter »**
  et **« Choisir un autre port… »** en état erreur. Auto-rétablissement du miroir live après un raté
  transitoire (lien encore ouvert).
- **Watchdog couple-off** : en mode Live, sans trame envoyée pendant `WATCHDOG_MS` (90 s), `releaseAll`
  coupe le couple (toast + log). Toggle persisté dans la boîte Liaison robot (défaut activé). Sur perte
  physique le couple ne peut pas être coupé (lien mort) — le SSC-32U garde sa position tant que VS est
  alimenté ; c'est signalé honnêtement.
- Fichiers touchés : [webSerial.ts](../src/serial/webSerial.ts), [useSerialStore.ts](../src/store/useSerialStore.ts),
  [RobotLinkPanel.tsx](../src/ui/RobotLinkPanel.tsx).
- Validé au banc : débranchement en plein mode Live → UI en erreur « port perdu », reconnexion sans
  recharger, watchdog OK.

## P2 — Mieux exploiter le SSC-32U _(#2)_ — ✅ FAIT

Objectif : mouvements plus doux et lecture de l'état réel de la carte.

Livré :

- **Transition douce par défaut** : réglage `transitionMs` persisté et partagé (défaut 500 ms),
  appliqué via `T` aux envois hors live (`sendPose`, centrage `centerServo`/`centerAll`). Le miroir
  live reste `T=0`. Sélecteur « Transition » dans la boîte Liaison robot. Le jog de calibration reste
  instantané (`sendServoAngle` à `timeMs=0` par défaut).
- **Retour de position `QP`** : `pulseUsToAngle` (inverse exact de `angleToPulseUs`) dans
  [electronics.ts](../src/model/electronics.ts) ; `SerialLink.requestBytes(cmd, n, timeout)` corrèle la
  réponse RX à la requête (sans casser la journalisation). Bouton **« ⤓ Importer la pose du robot »** →
  applique la pose lue à la 3D. ⚠️ `QP` renvoie la position **commandée** (pas un retour de
  potentiomètre) : couple coupé → `0 µs` (message d'aide dédié).
- **Requête mouvement `Q`** : `queryMoving()` → `true`/`false`/`null` (`+`/`.`), socle de la synchro P3.
- **`STOP` + console debug** : méthodes protocole `queryMove`/`queryPulse`/`stop` (SSC-32U) ; barre debug
  dans la console transverse (champ canal + boutons Q/QP/STOP + commande brute, terminateur auto).
- Robustesse RX : la boucle de lecture résiste aux **erreurs de lecture non fatales** (framing/parité en
  binaire à bas débit) en ré-acquérant un reader au lieu de déclarer une perte (corrige un faux
  décrochage observé sur le 1er `QP` à 9600 bauds). Affichage hex des octets binaires en console.
- Note : le **baud du SSC-32U se règle par bouton** sur la carte (pas en logiciel, cf. guide officiel
  SSC-32U) ; juste s'assurer que `baudRate` correspond côté app.

## P3 — Locomotion réelle depuis la salle d'exécution _(#1)_ — ⬅ prochaine étape

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
