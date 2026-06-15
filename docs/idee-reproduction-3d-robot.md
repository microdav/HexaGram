# Idée — Reproduction live de l'espace 3D vers le robot connecté

Statut : **à implémenter** (prochaine étape).

## Besoin

Aujourd'hui, l'envoi au robot réel est **ponctuel** : bouton « Envoyer la position
actuelle » / « Pose de référence » dans la boîte [Liaison robot](./idee-calibration-servos.md)
(`useSerialStore.sendPose`). On veut un **miroir temps réel** : toute évolution de la pose 3D
(`useHexapodStore.pose`) est répercutée en continu sur le robot connecté — manipulation
manuelle des servos, cinématique inverse, lecture du séquenceur, locomotion de la salle.

## Principe

Un **mode « Miroir live »** (toggle dans la boîte Liaison robot) qui, tant qu'il est actif et
la carte connectée, s'abonne aux changements de `useHexapodStore.pose` et streame la pose via
`sendPose` (calibration `invert`/`centerOffsetDeg`/butées déjà appliquée).

## Points de vigilance

- **Débit série** : ne pas inonder la liaison. Throttle/coalescing (ex. ~20–30 Hz max, n'envoyer
  que les canaux qui ont changé au-delà d'un epsilon). Le SSC-32U accepte plusieurs servos par
  ligne — préférer une commande groupée à 18 lignes séparées.
- **Transition (T)** : en live, T court (0) ; pour la lecture de séquence, utiliser la durée de
  transition du pas. Décider qui pilote T selon la source.
- **Source de la pose** : manuel / IK / séquenceur / salle d'exécution écrivent tous dans
  `pose`. Le miroir doit être agnostique de la source (un seul abonnement au store).
- **Sécurité** : toggle bien visible, état persistant clair, **couple off** accessible, et
  respect des butées `minDeg`/`maxDeg` (à clamper avant envoi — lié au « reste à faire »
  intégration multi-couches de la calibration).
- **Latence vs fluidité** : un servo hobby ne suit pas à l'infini ; lisser les grands sauts.

## Couches touchées

1. `useSerialStore` — un abonnement (ou une action `startMirror/stopMirror`) au store hexapode,
   avec throttle ; envoi groupé.
2. `RobotLinkPanel` — toggle « Miroir live » + indicateur d'activité (Hz / dernier envoi).
3. (Optionnel) garde-fou butées partagé avec l'intégration calibration ↔ 3D.

## Lien

Prolonge la [calibration des servos](./idee-calibration-servos.md) : le miroir n'est fidèle que
si la calibration (sens + zéro + butées) est correcte.
