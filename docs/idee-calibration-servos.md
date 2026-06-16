# Calibration des servos (par servo)

Statut : **implémenté** (onglet Électronique → « Liaison & calibration »).
Intégration 3D : **faite** — la pose 3D est en *repère servo* (cf. section « Repères ») et l'envoi
est clampé aux butées.

## Modèle de données

Chaque servo logique (0–17) porte une liaison `ServoBinding`
([src/model/electronics.ts](../src/model/electronics.ts)), persistée au **niveau projet**
dans `hardware.electronics.bindings` (cf. schéma serveur — tout nouveau champ doit y être
déclaré sinon il est supprimé à l'enregistrement) :

```ts
interface ServoBinding {
  channel: number | null;     // canal physique (null = non câblé)
  invert: boolean;            // sens de rotation
  centerOffsetDeg: number;    // décalage 0 commande ↔ 0 mécanique
  minDeg: number | null;      // butée logicielle min (null = plage modèle ±90°)
  maxDeg: number | null;      // butée logicielle max
}
```

L'**axe** de chaque articulation reste implicite (coxa = lacet/vertical ; fémur/tibia =
tangage/horizontal) — il correspond au robot réel, pas besoin de l'exposer.

## Conversion angle → µs

`angleToPulseUs(logicalDeg, binding, servo, controller)` :
`effDeg = (invert ? -logicalDeg : logicalDeg) + centerOffsetDeg`, puis mappe ±90° sur la
plage µs du type de servo (HS-475HB ≈ 500/1500/2500), bornée à la plage du contrôleur.

## Repères — pose en « repère servo » + offset de montage

Depuis la bascule de convention, **les angles de pose sont en repère servo : 0 = centre du
servo** pour toutes les articulations (`JOINT_REFERENCE_DEG = {coxa:0, fémur:0, tibia:0}`,
[src/model/pose.ts](../src/model/pose.ts)). « 0 en Conception » correspond donc au **centre
physique** du servo sur le robot.

L'écart structurel entre cette pose et la géométrie 3D est porté par
**`geometry.mountingOffsetsDeg`** (18 valeurs, `mountingOffsetOf` dans
[src/model/hexapod.ts](../src/model/hexapod.ts)) : le rendu fait `géométrique = pose + offset`.

| Articulation | Offset de montage | À pose 0, la 3D rend… |
|---|---|---|
| coxa | 0° | patte dans son axe |
| fémur | 0° | fémur horizontal |
| tibia | **−90°** | tibia **perpendiculaire** au fémur |

⚠️ Le palonnier du **tibia est monté à un quart de tour** : au centre du servo il est
perpendiculaire. C'est désormais modélisé par l'offset de montage **−90°** (et non plus par un
`centerOffsetDeg` ≈ 90° côté électronique). Du coup, à pose 0, la 3D montre le tibia
perpendiculaire **et** le robot va au centre servo — les deux coïncident.

> Deux « offsets » à ne pas confondre : **montage** (`mountingOffsetsDeg`, géométrie/rendu, hors
> envoi) et **calibration** (`centerOffsetDeg`/`invert`, appliqués à l'envoi). Cf.
> [CLAUDE.md](../CLAUDE.md) « Angles & montage servo ».

## Assistant guidé — [src/ui/CalibrationWizard.tsx](../src/ui/CalibrationWizard.tsx)

Patte par patte, servo par servo, en 3 étapes :

1. **Sens** : 0° → +45° ; la consigne attendue (avant/arrière, monte/descend) est calculée
   depuis le modèle 3D (`computeFootTip`, via [src/model/servoDirection.ts](../src/model/servoDirection.ts)).
   Si le robot tourne à l'envers → bascule `invert`.
2. **Zéro mécanique** : amène au repère, ajuste `centerOffsetDeg` (±90° / ±5° / ±0,5°).
3. **Butées min/max** : jog + capture de `minDeg`/`maxDeg`.
Couple coupé à la fermeture.

## Cartes patte (réglage direct)

- En-tête : canal · **Centrer** (→ 0 = centre servo, tibia perpendiculaire) · Identifier · **Inverser**.
- Slider de test (plage complète ±90°) avec **libellés de direction** à chaque extrémité.
  Ils montrent le mouvement **attendu (modèle)** — coxa toujours **avant/arrière** (pivot
  vertical, jamais gauche/droite), fémur/tibia **bas/haut** — et sont **indépendants de
  `invert`** : si une patte part à l'inverse, c'est que `invert` est mal réglé.
- Rangée **Zéro** : offset ±90°/±5°/±0,5° + RAZ. Chaque clic renvoie l'angle de test
  **courant** (pas de saut au repère), pour régler sur place.
- 6 cartes en **2 lignes** : ligne 1 = pattes gauches (0,1,2), ligne 2 = pattes droites (3,4,5).

## Envoi au robot

- `useSerialStore.sendPose(pose, timeMs)` / `sendPoseLive(pose)` envoient une pose complète aux
  servos câblés. Chaîne appliquée : **clamp aux butées** `minDeg/maxDeg` (`clampToServoLimits`,
  repli ±90°) → `angleToPulseUs` (sens + zéro). Le robot ne force donc jamais au-delà de la course
  réglée. NB : le jog de calibration `sendServoAngle` n'est **pas** clampé (sinon impossible de
  repousser une butée dans l'assistant).
- Boîte **« Liaison robot »** ([src/ui/RobotLinkPanel.tsx](../src/ui/RobotLinkPanel.tsx)) dans
  l'espace Conception 3D : connecter/déconnecter, **envoyer la position actuelle**, **pose de
  référence**, transition (T), couple off, et **Mode Live** (miroir 3D→robot).

## Reproduction live 3D → robot — fait

Voir **[idee-reproduction-3d-robot.md](./idee-reproduction-3d-robot.md)** : « Mode Live » streame
en temps réel `useHexapodStore.pose` vers le robot connecté (throttle ~25 Hz, envoi groupé), avec
sous-option « envoyer en fin de mouvement (au relâchement) » pour éviter les saccades.

## Intégration 3D — fait

Le **zéro** est intégré à la 3D via l'offset de montage (la pose 3D est en repère servo, cf.
« Repères »), et les **butées** `minDeg/maxDeg` sont clampées à l'envoi (`sendPose`/`sendPoseLive`),
ce qui protège aussi séquenceur et salle d'exécution (qui passent par ces chemins).
