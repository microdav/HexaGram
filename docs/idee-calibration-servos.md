# Idée — Paramétrage / calibration par servo

Statut : à implémenter.

## Besoin

Chaque servo physique a ses propres particularités :

- **Butées mécaniques** différentes (un servo monté contre le châssis ne peut pas
  parcourir 180° entiers ; un autre peut être bridé par la collision patte/sol).
- **Sens de rotation** variable selon le sens de montage (servo « tête en bas »,
  axe inversé, etc.). Un même angle de commande peut produire un mouvement
  opposé d'un servo à l'autre.
- **Zéro physique** qui ne correspond pas nécessairement à la position neutre
  attendue par le modèle 3D (segment aligné avec le précédent).

Aujourd'hui les limites sont codées en dur dans `buildServos` ([src/model/hexapod.ts](../src/model/hexapod.ts))
à ±90° pour tous, ce qui est trop permissif pour le robot réel.

## Proposition

Ajouter par servo (et persisté) un override de calibration :

```ts
interface ServoCalibration {
  minDeg: number;        // butée min côté commande
  maxDeg: number;        // butée max côté commande
  invert: boolean;       // inverse le signe avant envoi à l'arc / au robot
  zeroOffsetDeg: number; // décalage entre 0° commande et 0° géométrique
}
```

- L'axe (Y pour coxa, Z pour fémur/tibia) reste implicite, déterminé par le
  type d'articulation — pas la peine de l'exposer.
- Stockage : nouveau slice dans le store zustand, persisté en `localStorage` au
  démarrage (et plus tard dans le profil utilisateur côté serveur).

## Points qui touchent plusieurs couches

À traiter en un seul lot pour éviter les états incohérents :

1. **Modèle** (`hexapod.ts`) — `buildServos` lit les overrides à l'initialisation.
2. **Store** (`useHexapodStore.ts`) — `setServoAngle` applique `invert` /
   `zeroOffsetDeg` lorsqu'on envoie l'angle au robot ; la **logique miroir**
   doit utiliser la calibration du servo opposé (sinon les angles ne reflètent
   plus la pose réelle).
3. **Kinematics** (`kinematics.ts`) — `computeFootTip` doit aussi appliquer
   `invert` + `zeroOffsetDeg` pour rester cohérent avec ce que voit le robot.
4. **Arc 3D** (`ServoArc.tsx`) — les bornes `minDeg/maxDeg` doivent venir du
   store, pas des constantes. Affichage de la zone hors butée en pointillé
   reste pertinent.
5. **UI** — nouveau panneau "Calibration servos" OU mode "Calibrer" sur chaque
   ligne du panneau Servos existant. Import/export JSON utile pour partager
   une calibration entre PC et tablette.

## Décisions à prendre avec le user

- Calibration par servo individuel (18 valeurs) ou groupée (« toute la patte
  est inversée » via un toggle par patte) ?
- Persistance : juste `localStorage`, ou tout de suite dans le profil
  utilisateur côté serveur ?
- Panneau dédié ou inline dans le panneau Servos ?

## Lien

Va de pair avec [profils utilisateur et persistance serveur](./idee-profils-utilisateur.md)
(à venir) — la calibration est une donnée de profil robot.
