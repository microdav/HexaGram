# Calibration des servos (par servo)

Statut : **implémenté** (onglet Électronique → « Liaison & calibration »).
Intégration profonde 3D/séquenceur : **à faire** (voir fin de page).

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

## Repères de calibration (par articulation)

`JOINT_REFERENCE_DEG` ([src/model/pose.ts](../src/model/pose.ts)) = angle modèle où la
position physique de repos est identifiable :

| Articulation | Repère | Angle modèle |
|---|---|---|
| coxa | dans l'axe | 0° |
| fémur | horizontal | 0° |
| tibia | **perpendiculaire au fémur** | **−90°** |

⚠️ Sur le robot réel, le palonnier du **tibia est monté à un quart de tour** : au centre du
servo il pend à la verticale. Le modèle considère tibia 0° = aligné (tendu), inatteignable.
On comble l'écart avec un `centerOffsetDeg` ≈ 90° (boutons ±90° « ¼ tour »). Le tibia ne
peut **pas** s'aligner à plat — son repos est la perpendiculaire.

## Assistant guidé — [src/ui/CalibrationWizard.tsx](../src/ui/CalibrationWizard.tsx)

Patte par patte, servo par servo, en 3 étapes :

1. **Sens** : 0° → +45° ; la consigne attendue (avant/arrière, monte/descend) est calculée
   depuis le modèle 3D (`computeFootTip`, via [src/model/servoDirection.ts](../src/model/servoDirection.ts)).
   Si le robot tourne à l'envers → bascule `invert`.
2. **Zéro mécanique** : amène au repère, ajuste `centerOffsetDeg` (±90° / ±5° / ±0,5°).
3. **Butées min/max** : jog + capture de `minDeg`/`maxDeg`.
Couple coupé à la fermeture.

## Cartes patte (réglage direct)

- En-tête : canal · **Neutre** (→ repère) · Identifier · **Inverser**.
- Slider de test (plage complète ±90°) avec **libellés de direction** à chaque extrémité.
  Ils montrent le mouvement **attendu (modèle)** — coxa toujours **avant/arrière** (pivot
  vertical, jamais gauche/droite), fémur/tibia **bas/haut** — et sont **indépendants de
  `invert`** : si une patte part à l'inverse, c'est que `invert` est mal réglé.
- Rangée **Zéro** : offset ±90°/±5°/±0,5° + RAZ. Chaque clic renvoie l'angle de test
  **courant** (pas de saut au repère), pour régler sur place.
- 6 cartes en **2 lignes** : ligne 1 = pattes gauches (0,1,2), ligne 2 = pattes droites (3,4,5).

## Envoi au robot

- Store série `useSerialStore.sendPose(pose, timeMs)` envoie une pose complète aux servos
  câblés (calibration appliquée).
- Boîte **« Liaison robot »** ([src/ui/RobotLinkPanel.tsx](../src/ui/RobotLinkPanel.tsx)) dans
  l'espace Conception 3D : connecter/déconnecter, **envoyer la position actuelle**, **pose de
  référence**, transition (T), couple off.

## Reste à faire — intégration multi-couches

Aujourd'hui `minDeg`/`maxDeg` et `centerOffsetDeg` ne servent qu'à l'envoi série (assistant,
cartes, `sendPose`). Pas encore répercutés dans :

1. `buildServos` / `kinematics` / `ServoArc` — bornes réelles + zéro dans la 3D.
2. Séquenceur / salle d'exécution — garde-fous contre les poses irréalisables.

## Prochaine étape — reproduction live 3D → robot

Voir **[idee-reproduction-3d-robot.md](./idee-reproduction-3d-robot.md)** : refléter en
temps réel la pose 3D (`useHexapodStore.pose`) vers le robot connecté.
