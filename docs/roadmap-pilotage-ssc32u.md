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
- **P3 — Locomotion réelle depuis la salle** (cf. ci-dessous, ⚠️ implémenté mais **NON opérationnel au
  banc — à corriger**) : toggle « 🤖 Robot » du Run envoie les keyframes au robot (`sendPoseTimed`
  groupé + `T`), synchronisées par `Q` (`waitUntilIdle`, poll silencieux), miroir live suspendu pendant
  le Run ; « Séquence → carte » consolidé (synchro `Q`).
- **P4 — Sécurité & fidélité** (cf. ci-dessous, ✅ fait) : butées calibrées visibles en 3D (marques sur
  l'arc + pointeur rouge + segment orange hors butée, mode « indiquer ») et soft-start (1er envoi après
  (re)connexion en transition longue de 1,5 s).

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

## P3 — Locomotion réelle depuis la salle d'exécution _(#1)_ — ⚠️ À CORRIGER

Objectif : faire **se déplacer le vrai robot**, pas seulement le mirroir frame-à-frame.

> **État : implémenté mais NON opérationnel au banc.** Le mécanisme (envoi keyframe + `T`, gate `Q`,
> suspension du miroir) est en place et compile, mais la marche réelle ne fonctionne pas encore
> correctement. À reprendre/déboguer (symptôme précis à recueillir au banc : tenue de pas, synchro `Q`,
> timing `T`, ou poses de démarche). Le correctif du rendu tibia (offset de montage perdu) a été fait
> entre-temps — re-tester d'abord avec une démarche régénérée depuis une **pose de base** correcte.

Implémenté (à valider/corriger) :

- **Lecture pas-à-pas → robot avec `T` par transition** : le toggle **« 🤖 Robot »** du Run
  ([ProgramRoomPanel](../src/ui/ProgramRoomPanel.tsx)) envoie chaque **keyframe** au robot via
  `sendPoseTimed` (groupé, un seul write + `T` = durée du segment ; le SSC-32U interpole). La 3D, elle,
  reste fluide (images denses). Soft-start à l'init.
- **Synchronisation par `Q`** : `waitUntilIdle` (poll silencieux `Q`, repli temporisé si non géré,
  plafond anti-blocage) gate chaque keyframe ; miroir live suspendu pendant le Run (`robotRunActive`).
- **Consolidation « Séquence → carte »** : case « Synchroniser sur Q » (défaut en SSC-32U) → enchaîne sur
  la fin réelle des mouvements au lieu d'un délai aveugle.
- Fichiers : [useProgramRunStore.ts](../src/store/useProgramRunStore.ts) (boucle `_scheduleNext` async +
  robot), [useSerialStore.ts](../src/store/useSerialStore.ts) (`sendPoseTimed`/`waitUntilIdle`),
  [ProgramRoomPanel.tsx](../src/ui/ProgramRoomPanel.tsx), [ElectroSequencePanel.tsx](../src/ui/ElectroSequencePanel.tsx).
- ⚠️ Suite identifiée au banc : la **qualité des poses de démarche** dépend d'une **pose de base** ; la
  génération doit pouvoir partir d'une pose de base choisie (cf. travaux hors-roadmap en cours).

## P4 — Sécurité & fidélité _(#3)_ — ✅ FAIT

Objectif : que la 3D ne « mente » pas sur ce que le robot peut faire.

Livré (mode **« indiquer »**, pas de limitation de la conception) :

- **Butées calibrées visibles en 3D** : [Leg.tsx](../src/three/Leg.tsx) lit `electronics.bindings[id].minDeg/maxDeg`
  (repli plage modèle) et les passe à [ServoArc](../src/three/ServoArc.tsx) → **marque orange** à chaque butée
  réellement plus serrée que le modèle + **pointeur d'arc rouge** quand la pose dépasse la butée ; en plus, le
  **segment** est teinté **orange** (sous le rouge de collision) — indicateur passif, en Conception seulement.
  On peut toujours poser au-delà : c'est signalé, plus de perte silencieuse à l'envoi.
- **Soft-start** : à la (re)connexion, le **1er envoi de pose** (`sendPose`/`sendPoseTimed`/`sendPoseLive`)
  force une transition longue (`SOFT_START_MS` = 1,5 s) pour rejoindre la pose en douceur, puis se désarme.
- Fichiers : [Leg.tsx](../src/three/Leg.tsx), [ServoArc.tsx](../src/three/ServoArc.tsx),
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
