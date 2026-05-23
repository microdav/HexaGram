# HexaGram — Spécifications techniques pour le développement de la marche

> Document de référence pour développer le moteur de marche d'un hexapode
> à 18 servomoteurs piloté par carte SSC-32U Lynxmotion.
>
> Ce document est conçu pour servir de **spécification d'entrée** au développement
> du code de marche. Il regroupe toutes les contraintes matérielles, mécaniques,
> énergétiques et logicielles à respecter.

**Version** : 1.0
**Date** : 2026-05-23
**Projet** : HexaGram

---

## Sommaire

- [1. Vue d'ensemble](#1-vue-densemble)
- [2. Architecture matérielle](#2-architecture-matérielle)
- [3. Géométrie mécanique](#3-géométrie-mécanique)
- [4. Spécifications des servomoteurs](#4-spécifications-des-servomoteurs)
- [5. Bilan énergétique et alimentation](#5-bilan-énergétique-et-alimentation)
- [6. Bilan de masse et calculs de couple](#6-bilan-de-masse-et-calculs-de-couple)
- [7. Contraintes critiques pour la programmation](#7-contraintes-critiques-pour-la-programmation)
- [8. Système de coordonnées](#8-système-de-coordonnées)
- [9. Cinématique inverse d'une patte](#9-cinématique-inverse-dune-patte)
- [10. Allures de marche](#10-allures-de-marche)
- [11. Cycle de marche détaillé](#11-cycle-de-marche-détaillé)
- [12. Protocole de communication SSC-32U](#12-protocole-de-communication-ssc-32u)
- [13. Architecture logicielle recommandée](#13-architecture-logicielle-recommandée)
- [14. Calibration des servomoteurs](#14-calibration-des-servomoteurs)
- [15. Monitoring et sécurité](#15-monitoring-et-sécurité)
- [16. Pseudocode de référence](#16-pseudocode-de-référence)
- [17. Glossaire](#17-glossaire)
- [Annexes](#annexes)

---

## 1. Vue d'ensemble

HexaGram est un robot hexapode mobile autonome doté de 18 servomoteurs
(6 pattes × 3 articulations). Cette nouvelle fonctionnalité du projet vise à
développer un moteur de marche complet incluant :

- Cinématique inverse pour les 6 pattes
- Plusieurs allures de marche (tripode, ripple, vague)
- Compensation de posture
- Contrôle par vecteur de déplacement (avant/arrière, latéral, rotation)
- Monitoring temps réel (batterie, température, position)

### Caractéristiques clés du robot

| Paramètre | Valeur |
|-----------|--------|
| Nombre de pattes | 6 |
| Articulations par patte | 3 (coxa, fémur, tibia) |
| Total de servomoteurs | 18 |
| Modèle de servo | Hitec HS-475HB (tous identiques) |
| Carte de contrôle | Lynxmotion SSC-32U |
| Alimentation | LiPo 2S 6500 mAh embarquée |
| Poids total estimé | ~2,35 kg |
| Autonomie cible | ~35 minutes |
| Vitesse de marche cible | 3 à 5 cm/s |

---

## 2. Architecture matérielle

### 2.1 Schéma global du système

```
                         ┌─────────────────────────┐
                         │  Microcontrôleur hôte   │
                         │  (Arduino Mega / PC)    │
                         │                         │
                         │  - Cinématique inverse  │
                         │  - Génération de gait   │
                         │  - Logique d'état       │
                         └──────────┬──────────────┘
                                    │ Série TTL 115200 bps
                                    ▼
                         ┌─────────────────────────┐
                         │   Lynxmotion SSC-32U    │
                         │  (interpolation servos) │
                         └──────────┬──────────────┘
                                    │ PWM × 18
                ┌───────────────────┼───────────────────┐
                ▼                   ▼                   ▼
        Patte avant-droite   Patte milieu-droite   Patte arrière-droite
        Patte avant-gauche   Patte milieu-gauche   Patte arrière-gauche
        (chacune = 3 servos coxa, fémur, tibia)
```

### 2.2 Composants détaillés

| Composant | Modèle | Quantité |
|-----------|--------|----------|
| Servomoteur | Hitec HS-475HB | 18 |
| Carte de contrôle servo | Lynxmotion SSC-32U | 1 |
| Microcontrôleur hôte | Arduino Mega 2560 (suggéré) | 1 |
| BEC servos | Castle CC BEC Pro 20 A (sortie 6,0 V) | 2 |
| BEC logique | UBEC 5 V / 3 A | 1 |
| Batterie | OVONIC LiPo 2S 6500 mAh 50C+ XT60 | 1 |
| Fusible principal | 20 A | 1 |
| Buzzer alarme LiPo | 2S–6S | 1 |

### 2.3 Assignation des canaux SSC-32U

> **Convention** : VS1 = côté droit (canaux 0–15), VS2 = côté gauche (canaux 16–31).

| Patte | Côté | Coxa | Fémur | Tibia |
|-------|------|------|-------|-------|
| Avant-droite (RF) | VS1 | 0 | 1 | 2 |
| Milieu-droite (RM) | VS1 | 4 | 5 | 6 |
| Arrière-droite (RR) | VS1 | 8 | 9 | 10 |
| Avant-gauche (LF) | VS2 | 16 | 17 | 18 |
| Milieu-gauche (LM) | VS2 | 20 | 21 | 22 |
| Arrière-gauche (LR) | VS2 | 24 | 25 | 26 |

> Cette répartition équilibre la charge électrique entre les deux banques
> (9 servos par banque). À respecter impérativement.

---

## 3. Géométrie mécanique

### 3.1 Dimensions des segments d'une patte

```
                    ┌─────────────┐
                    │   CHÂSSIS   │
                    └──────┬──────┘
                           │
                      Axe Coxa
                           │
                    ┌──────●──────┐
                    │  Servo Coxa │ ◄── Rotation horizontale (yaw)
                    └──────┬──────┘
                           │   ─────► 5,0 cm  (L1 = coxa)
                           │
                    ┌──────●──────┐
                    │ Servo Fémur │ ◄── Élévation verticale (pitch)
                    └──────┬──────┘
                            \
                             \  ─────► 8,0 cm  (L2 = fémur)
                              \
                          ┌────●────┐
                          │ Tibia   │ ◄── Extension (knee)
                          └────┬────┘
                                \
                                 \  ─────► 11,5 cm (L3 = tibia)
                                  \
                                   ▼
                                  Pied

L1 (Coxa)  = 5,0  cm  = 50 mm
L2 (Fémur) = 8,0  cm  = 80 mm
L3 (Tibia) = 11,5 cm  = 115 mm

Allonge max (patte tendue) = L1 + L2 + L3 = 24,5 cm
Allonge min (patte repliée) ≈ L1 + |L2 - L3| = 8,5 cm
```

### 3.2 Positions des pattes sur le châssis

Les 6 pattes sont disposées en symétrie bilatérale autour de l'axe avant-arrière.
Les positions sont à mesurer sur le châssis réel et à renseigner ici lors de
la calibration.

| Patte | Position X (avant +) | Position Y (droite +) | Angle d'attache |
|-------|----------------------|------------------------|-----------------|
| RF | +__ mm | +__ mm | +60° |
| RM |   0 mm | +__ mm | 0° |
| RR | -__ mm | +__ mm | -60° |
| LF | +__ mm | -__ mm | +120° |
| LM |   0 mm | -__ mm | 180° |
| LR | -__ mm | -__ mm | -120° |

> 🔧 **À renseigner par mesure physique** lors du montage final.
> L'angle d'attache détermine l'orientation par défaut du plan d'action de chaque patte.

### 3.3 Compartiment batterie

| Dimension | Espace disponible | Batterie OVONIC 2S 6500 |
|-----------|--------------------|--------------------------|
| Longueur | 300 mm | 140 mm ✅ |
| Largeur | 70 mm | 47 mm ✅ |
| Épaisseur | 45 mm | 26 mm ✅ |

Marge confortable pour fixation, câblage et accès au connecteur.

---

## 4. Spécifications des servomoteurs

### 4.1 Hitec HS-475HB — caractéristiques officielles

| Paramètre | Valeur | Note |
|-----------|--------|------|
| Tension d'alimentation | 4,8 à 6,0 V | **Cible : 6,0 V** |
| Couple à 4,8 V | 4,4 kg·cm | — |
| **Couple à 6,0 V** | **5,5 kg·cm** | **Limite mécanique** |
| Vitesse à 6,0 V | 0,18 s / 60° | — |
| Courant au repos | ~8 mA | — |
| Courant en mouvement | 350 à 500 mA | Estimation moyenne |
| Courant de blocage | ~1,1 A | Pic court |
| Engrenages | Karbonite | Bonne résistance aux chocs |
| Plage angulaire utile | ~180° | Mécaniquement |
| Largeur d'impulsion | 900 à 2100 µs | 1500 µs = position centrale |

### 4.2 Conversion angle ↔ impulsion PWM

```
Convention :
- Impulsion 1500 µs = position centrale (angle 0°)
- Impulsion 900 µs  = position extrême négative (≈ -90°)
- Impulsion 2100 µs = position extrême positive (≈ +90°)

Linéaire : 1 µs ≈ 0,15° angulaire

Formule :
pulse_us = 1500 + (angle_deg × 600 / 90)
        = 1500 + (angle_deg × 6,667)

angle_deg = (pulse_us - 1500) × 90 / 600
         = (pulse_us - 1500) × 0,15

Sécurité :
- Toujours clamper pulse_us dans [900, 2100]
- Vérifier que l'angle calculé est dans les limites mécaniques de chaque servo
```

### 4.3 Limites angulaires par articulation

À calibrer mécaniquement par servo, mais en première approximation :

| Articulation | Angle min | Angle 0° (neutre) | Angle max |
|--------------|-----------|-------------------|-----------|
| Coxa | -45° | 0° (alignée latéralement) | +45° |
| Fémur | -45° (horizontal) | 0° (oblique 30° vers le bas) | +60° (vers le haut) |
| Tibia | -90° (replié) | 0° (90° vs fémur) | +30° (étendu) |

> ⚠️ Ces valeurs sont indicatives. Faire un test physique servo par servo
> avant de mettre en mouvement coordonné.

---

## 5. Bilan énergétique et alimentation

### 5.1 Architecture d'alimentation

```
         ┌────────────────────────────────┐
         │  LiPo 2S 6500 mAh 50C+ XT60    │
         │  (7,4 V nominal, 8,4 V max)    │
         │  + Buzzer alarme sous-tension  │
         └───────────────┬────────────────┘
                         │
                   Fusible 20 A
                   Interrupteur principal
                         │
                       AWG 12
                         │
            ┌────────────┼────────────┐
            │            │            │
        ┌───▼────┐  ┌────▼───┐   ┌────▼────┐
        │ Castle │  │ Castle │   │  UBEC   │
        │ CC BEC │  │ CC BEC │   │  5V/3A  │
        │ Pro 20A│  │ Pro 20A│   │         │
        │  → 6V  │  │  → 6V  │   │         │
        └───┬────┘  └────┬───┘   └────┬────┘
            │           │             │
      3300µF│     3300µF│             │
          ──┴──       ──┴──           │
            │           │             │
            ▼           ▼             ▼
           VS1         VS2            VL
      (canaux 0–8) (canaux 16–24) (logique)
            │           │             │
            └─────┬─────┴────────┬────┘
                  │              │
           ┌──────▼──────┐       │
           │  SSC-32U    │◄──────┘
           │ Jumpers :   │
           │  VS1=VS2 ✗  │
           │  VS=VL   ✗  │
           └──────┬──────┘
                  │
           ┌──────▼──────┐
           │  Hôte MCU   │
           └─────────────┘
```

### 5.2 Calcul de consommation prévisionnelle

| Régime | Conso par servo | Total 18 servos | Côté batterie |
|--------|------------------|------------------|----------------|
| Repos (sous tension) | 8 mA | 144 mA | ~0,12 A |
| Mouvement léger | 200 mA | 3,6 A | ~3,1 A |
| **Marche normale (cible)** | **450 mA** | **8,1 A** | **~7,0 A** |
| Pics fréquents | 700 mA | 12,6 A | ~10,9 A |
| Pic absolu | 1,1 A | 19,8 A | ~17,1 A |

Calcul côté batterie : division par η ≈ 0,87 (rendement BEC) et facteur 6/7,4 (rapport tension).

### 5.3 Autonomie prévisionnelle

```
Énergie totale batterie     = 6,5 Ah × 7,4 V = 48,1 Wh
Énergie utile (réserve 20%) = 48,1 × 0,8    = 38,5 Wh

En marche normale :
  Puissance côté basse tension = 8,1 A × 6 V    = 48,6 W
  Puissance côté batterie       = 48,6 / 0,87   = 55,9 W

  Autonomie = 38,5 / 55,9 = 0,69 h ≈ 41 min réelles

En repos :
  Puissance ≈ 1 W
  Autonomie ≈ 38 h
```

### 5.4 Tensions critiques de la batterie LiPo 2S

| Tension | État | Action logicielle |
|---------|------|--------------------|
| 8,4 V | 100% chargée | OK |
| 8,0 V | ~85% | OK |
| 7,4 V | ~50% (nominale) | OK |
| 7,0 V | ~20% (3,5 V/cellule) | ⚠️ **Alarme : afficher avertissement** |
| 6,8 V | ~10% (3,4 V/cellule) | ⚠️ **Mode économie : ralentir** |
| 6,6 V | ~5% (3,3 V/cellule) | 🛑 **Coupure obligatoire** |
| < 6,0 V | Critique | ❌ **Cellule endommagée — ne plus utiliser** |

> 💡 **Diviseur de tension** pour mesure sur entrée analogique :
> R1 = 22 kΩ (vers + batterie), R2 = 10 kΩ (vers GND)
> Ratio = 10/32 = 0,3125
> 8,4 V batterie → 2,625 V sur ADC (compatible 0–5 V Arduino)

### 5.5 Rôle des BEC dans l'architecture

**BEC** = **B**attery **E**liminator **C**ircuit (régulateur DC-DC abaisseur).
**UBEC** = **U**niversal **BEC** (variante moderne, tension réglable, large plage d'entrée).

Rôle : convertir la tension batterie (7,4 V) en tension utilisable par les servos (6,0 V)
ou par la logique (5,0 V), tout en supportant les pics de courant.

| BEC | Modèle recommandé | Entrée | Sortie | Courant continu | Pic |
|-----|---------------------|--------|--------|------------------|-----|
| Servos VS1 | Castle CC BEC Pro 20A | 7,4 V | **6,0 V** | 12 A | 20 A |
| Servos VS2 | Castle CC BEC Pro 20A | 7,4 V | **6,0 V** | 12 A | 20 A |
| Logique VL | UBEC 5V/3A | 7,4 V | **5,0 V** | 3 A | 5 A |

**Pourquoi 3 BEC séparés** :
- Un pic servo ne fait pas chuter la tension logique (pas de reset MCU)
- Répartition thermique entre les régulateurs
- Découplage VS1/VS2 : un blocage côté droit ne perturbe pas le côté gauche

---

## 6. Bilan de masse et calculs de couple

### 6.1 Répartition des masses

| Composant | Masse |
|-----------|-------|
| Châssis + 18 servos HS-475HB montés | 1750 g |
| Carte SSC-32U | ~40 g |
| Arduino Mega (ou équivalent) | ~37 g |
| 2× Castle CC BEC Pro 20A | ~80 g |
| UBEC logique 5V | ~10 g |
| Câblage (AWG 12 + 14 + servo) | ~80 g |
| Condensateurs + fusible + interrupteur | ~30 g |
| Visserie de fixation | ~20 g |
| Batterie OVONIC 2S 6500 mAh | ~300 g |
| **Poids total robot** | **~2347 g** |

### 6.2 Charge par patte selon la phase

Hypothèse de calcul : poids total **2,35 kg**, réparti uniformément.

| Phase | Pattes porteuses | Charge par patte |
|-------|------------------|-------------------|
| Statique 6 pattes | 6 | 392 g |
| Marche ripple (4–5 pattes au sol) | 4 à 5 | 470 à 588 g |
| **Tripode (3 pattes au sol)** | **3** | **783 g** |
| Transition tripode (2 pattes momentanées) | 2 | 1175 g |
| Pic dynamique (1 patte) | 1 | 2350 g |

### 6.3 Couple requis sur le servo fémur

**Le servo fémur est le servo le plus contraint** car il supporte la composante
verticale du poids du corps via son bras de levier.

#### Formule de couple

```
Couple_fémur (kg·cm) = Charge_par_patte (kg) × Bras_levier_horizontal (cm)

Avec :
  Bras_levier_horizontal = distance horizontale entre l'axe du servo fémur
                           et le point de contact du pied au sol

  Ce bras de levier dépend de la posture (angles fémur et tibia).
```

#### Table de référence — couple requis selon bras de levier

| Bras de levier | Tripode (783 g) | Transition (1175 g) | Ripple (550 g) |
|----------------|------------------|---------------------|-----------------|
| 3 cm (très compact) | 2,35 kg·cm ✅ | 3,53 kg·cm ✅ | 1,65 kg·cm ✅ |
| **5 cm (compact recommandé)** | **3,92 kg·cm ✅** | **5,88 kg·cm ⚠️** | **2,75 kg·cm ✅** |
| 7 cm (normal) | 5,48 kg·cm ⚠️ | 8,23 kg·cm ❌ | 3,85 kg·cm ✅ |
| 9 cm (étendu) | 7,05 kg·cm ❌ | 10,58 kg·cm ❌ | 4,95 kg·cm ✅ |

Légende : ✅ marge ≥ 20% | ⚠️ marge < 20% | ❌ dépassement

### 6.4 Conclusions opérationnelles critiques

1. **Le servo HS-475HB (5,5 kg·cm) est insuffisant** pour une marche tripode
   normale en transition. Le bras de levier doit être strictement limité.

2. **Posture compacte obligatoire** : le code doit maintenir une projection
   horizontale fémur ↔ pied inférieure à **5 cm** dans toutes les phases.

3. **Allure ripple préférée** : elle limite la charge par patte
   (toujours 4–5 pattes au sol au lieu de 3) et tolère un bras de levier
   plus important.

4. **Pas de mouvements brusques** : les accélérations augmentent le couple
   instantané au-delà du couple statique calculé.

---

## 7. Contraintes critiques pour la programmation

> ⚠️ **Cette section regroupe les valeurs limites à respecter par le code.**
> Toute violation peut endommager les servomoteurs ou compromettre la stabilité.

### 7.1 Limites de posture

```cpp
// Hauteur du corps au-dessus du sol
BODY_HEIGHT_MIN_MM     =  60   // 6 cm — posture basse
BODY_HEIGHT_MAX_MM     = 100   // 10 cm — posture haute, à éviter en marche
BODY_HEIGHT_DEFAULT_MM =  80   // 8 cm — posture normale

// Position du pied dans le repère lié au corps
FOOT_HORIZONTAL_MIN_MM =  90   // distance minimale corps ↔ pied (allonge proche)
FOOT_HORIZONTAL_MAX_MM = 150   // distance maximale corps ↔ pied (allonge loin)

// Projection horizontale FÉMUR ↔ PIED (paramètre critique)
LEVER_ARM_FEMUR_MAX_MM = 50    // 5 cm — IMPÉRATIF pour le couple
LEVER_ARM_FEMUR_TARGET_MM = 40 // 4 cm — valeur cible en marche normale
```

### 7.2 Limites de mouvement

```cpp
// Longueur de foulée (déplacement horizontal du pied par cycle)
STEP_LENGTH_MIN_MM     = 10    // 1 cm — pas minimal utile
STEP_LENGTH_MAX_MM     = 40    // 4 cm — pas maximal recommandé
STEP_LENGTH_DEFAULT_MM = 25    // 2,5 cm — valeur par défaut

// Hauteur de levée du pied pendant la phase swing
STEP_HEIGHT_MIN_MM     = 15    // 1,5 cm
STEP_HEIGHT_MAX_MM     = 30    // 3 cm — au-delà, sur-sollicitation tibia
STEP_HEIGHT_DEFAULT_MM = 20    // 2 cm

// Vitesse de marche
SPEED_SLOW_MM_S        = 20    // 2 cm/s — démarrage/manœuvre
SPEED_NORMAL_MM_S      = 40    // 4 cm/s — marche standard
SPEED_MAX_MM_S         = 80    // 8 cm/s — uniquement en ripple, courte durée

// Rotation
YAW_RATE_MAX_DEG_S     = 30    // 30°/s — rotation sur place max
```

### 7.3 Limites cinématiques

```cpp
// Fréquence de mise à jour de la boucle de contrôle
CONTROL_LOOP_HZ_MIN    = 30
CONTROL_LOOP_HZ_TARGET = 50    // boucle à 50 Hz = 20 ms par itération
CONTROL_LOOP_HZ_MAX    = 100

// Durée d'interpolation des commandes SSC-32U
SERVO_INTERP_TIME_MIN_MS = 50  // mouvements rapides
SERVO_INTERP_TIME_MAX_MS = 500 // mouvements lents
SERVO_INTERP_TIME_DEFAULT_MS = 100

// Accélération maximale (limitation des à-coups)
ACCEL_MAX_MM_S2 = 100
```

### 7.4 Modes de marche autorisés

| Mode | Autorisé ? | Conditions |
|------|------------|------------|
| **Statique 6 pattes** | ✅ Toujours | Aucune limite |
| **Ripple gait** | ✅ Mode par défaut | Vitesse jusqu'à 5 cm/s |
| **Tripode lent** | ⚠️ Conditionnel | Vitesse < 3 cm/s, posture compacte |
| **Tripode rapide** | ❌ Interdit | Surcharge fémur garantie |
| **Wave gait** | ✅ Toujours | Mode économie / précision |
| **Rotation sur place** | ✅ | Tripode lent uniquement |
| **Marche en pente** | ⚠️ | Pente max 10° |
| **Saut / mouvements explosifs** | ❌ Strictement interdit | Impossible mécaniquement |

### 7.5 Marges de sécurité

Le code doit appliquer une **marge de sécurité globale de 20%** sur :

- Le couple théorique calculé (ne jamais dépasser 80% de 5,5 kg·cm = 4,4 kg·cm)
- La tension batterie (couper avant 6,6 V, idéalement à 6,8 V)
- La durée de mouvement servo (minimum 50 ms par commande)

---

## 8. Système de coordonnées

### 8.1 Repère global (monde)

```
        Z (haut)
         ▲
         │
         │
         │
         └────────► X (avant du robot)
        ╱
       ╱
      ▼
     Y (droite du robot)
```

- **X positif** : direction avant du robot (direction d'avancée par défaut)
- **Y positif** : côté droit (les pattes RF/RM/RR sont en Y > 0)
- **Z positif** : vers le haut

### 8.2 Repère lié au corps (body frame)

Identique au repère global au démarrage, mais translate et tourne avec le robot.
L'origine du repère corps est généralement le **centre géométrique du châssis**.

### 8.3 Repère lié à la coxa de chaque patte

Chaque patte a son propre repère local centré sur l'axe du servo coxa :

```
       Z_local (haut)
         ▲
         │
         │
         └────────► X_local (vers l'extérieur de la patte, axe naturel)
        ╱
       ╱
      ▼
     Y_local (vers l'avant ou l'arrière selon la patte)
```

- **X_local** : direction "naturelle" d'extension de la patte (depuis le corps vers l'extérieur)
- L'angle d'attache de chaque patte (60° pour les pattes avant, 0° pour milieu, etc.)
  permet de passer du repère corps au repère local.

### 8.4 Transformation corps → local

Pour une patte attachée à la position `(cx, cy, 0)` dans le corps, avec un angle
d'attache `α` (rotation autour de Z) :

```
// Pied exprimé dans le repère corps : (fx, fy, fz)
// Transformation vers le repère local de la coxa :

dx = fx - cx
dy = fy - cy
dz = fz   // le servo coxa est à hauteur 0 du corps

// Rotation inverse d'angle α autour de Z
x_local =  dx * cos(α) + dy * sin(α)
y_local = -dx * sin(α) + dy * cos(α)
z_local = dz
```

---

## 9. Cinématique inverse d'une patte

### 9.1 Énoncé du problème

> **Donné** : position cible du pied `(x, y, z)` dans le repère local de la coxa.
> **Trouvé** : angles `(θ1, θ2, θ3)` des servos coxa, fémur, tibia.

### 9.2 Diagramme géométrique

```
Vue de dessus (plan XY local) :
                                                  Y_local
                                                   ▲
            ╔══════════╗                           │
            ║   Corps  ║                           │
            ╚══════════╝                           │
                 ●─── Axe coxa                     │
                  \                                │
                   \ θ1 (coxa)                     └────► X_local
                    \
                     ●─── Axe fémur

Vue de côté (plan radial-Z après rotation par θ1) :
                                          Z
            (Axe fémur après rotation coxa) ▲
                ●                            │
                ╲                            │
                 ╲ L2                        │
              θ2  ╲                          │
                   ╲                         └────► r (distance radiale = √(x²+y²) - L1)
                    ●─── Axe tibia
                    ╱
                   ╱ L3
                  ╱
              θ3 ╱
                ╱
               ▼ Pied (x, y, z)
```

### 9.3 Formules de calcul

#### Étape 1 — Angle de la coxa

```
θ1 = atan2(y, x)
```

L'angle θ1 fait tourner la patte horizontalement pour qu'elle pointe vers (x, y).

#### Étape 2 — Réduction au problème 2D

Après rotation par θ1, le problème devient 2D dans le plan vertical contenant
le pied. On définit :

```
r  = √(x² + y²) - L1     // distance radiale depuis l'axe fémur
D  = √(r² + z²)          // distance directe fémur ↔ pied
```

**Validation préalable** :

```
if (D > L2 + L3) :
    erreur("Position cible trop éloignée — patte ne peut pas l'atteindre")

if (D < |L2 - L3|) :
    erreur("Position cible trop proche — singularité")

if (D == 0) :
    erreur("Position cible sur l'axe — singularité")
```

#### Étape 3 — Angle du fémur (θ2)

```
α1 = atan2(-z, r)
     // angle entre l'horizontale (axe r) et la ligne fémur→pied
     // -z car typiquement z < 0 (pied sous le corps)

α2 = acos( (L2² + D² - L3²) / (2 × L2 × D) )
     // angle entre L2 (fémur) et D (ligne fémur→pied), loi des cosinus

θ2 = α1 + α2
```

#### Étape 4 — Angle du tibia (θ3)

```
γ  = acos( (L2² + L3² - D²) / (2 × L2 × L3) )
     // angle interne au "genou", loi des cosinus

θ3 = π - γ
     // angle complémentaire (selon convention de mesure depuis l'axe fémur)
```

### 9.4 Convention de signes et offsets

Les angles calculés `(θ1, θ2, θ3)` sont des **angles théoriques** dans le repère
géométrique. Ils doivent être convertis en angles servo via :

```
servo_angle_coxa  = θ1_deg + offset_coxa
servo_angle_femur = θ2_deg + offset_femur
servo_angle_tibia = θ3_deg + offset_tibia

// Les offsets sont mesurés à la calibration (voir section 14)
// Chaque servo peut avoir un sens de rotation différent (gauche/droite)
// → multiplier par +1 ou -1 selon orientation physique du servo

// Conversion finale en impulsion PWM
pulse_us = 1500 + (servo_angle_deg × 6,667 × sign)
pulse_us = clamp(pulse_us, 900, 2100)
```

### 9.5 Pseudocode complet IK d'une patte

```cpp
struct LegIKResult {
    bool valid;
    float theta1_deg;  // coxa
    float theta2_deg;  // fémur
    float theta3_deg;  // tibia
};

LegIKResult computeLegIK(float x, float y, float z) {
    const float L1 = 50.0f;   // coxa en mm
    const float L2 = 80.0f;   // fémur en mm
    const float L3 = 115.0f;  // tibia en mm

    LegIKResult result;
    result.valid = false;

    // Étape 1 : angle coxa
    float theta1 = atan2(y, x);

    // Étape 2 : réduction 2D
    float r = sqrt(x*x + y*y) - L1;
    float D = sqrt(r*r + z*z);

    // Validation
    if (D > (L2 + L3) || D < abs(L2 - L3) || D < 1.0f) {
        return result;  // invalid
    }

    // Étape 3 : angle fémur
    float alpha1 = atan2(-z, r);
    float cos_alpha2 = (L2*L2 + D*D - L3*L3) / (2.0f * L2 * D);
    cos_alpha2 = constrain(cos_alpha2, -1.0f, 1.0f);  // sécurité numérique
    float alpha2 = acos(cos_alpha2);
    float theta2 = alpha1 + alpha2;

    // Étape 4 : angle tibia
    float cos_gamma = (L2*L2 + L3*L3 - D*D) / (2.0f * L2 * L3);
    cos_gamma = constrain(cos_gamma, -1.0f, 1.0f);
    float gamma = acos(cos_gamma);
    float theta3 = PI - gamma;

    // Conversion radians → degrés
    result.theta1_deg = theta1 * 180.0f / PI;
    result.theta2_deg = theta2 * 180.0f / PI;
    result.theta3_deg = theta3 * 180.0f / PI;
    result.valid = true;

    return result;
}
```

---

## 10. Allures de marche

### 10.1 Définitions

Une **allure** (gait) est un motif temporel décrivant quand chaque patte est en
**phase de support** (au sol, soutient le poids) ou en **phase de swing**
(en l'air, avance vers la prochaine position).

Le **duty cycle** d'une patte = fraction de temps passé en support.

### 10.2 Allure TRIPODE (Tripod)

#### Principe

Les 6 pattes sont divisées en 2 groupes alternants :

- **Groupe A** : RF (avant-droite), LM (milieu-gauche), RR (arrière-droite)
- **Groupe B** : LF (avant-gauche), RM (milieu-droite), LR (arrière-gauche)

Quand le groupe A est en swing, le groupe B est en support. Et vice-versa.

#### Diagramme temporel

```
Temps  →  0%         50%         100%
RF (A) [══SUPPORT══][═══SWING═══]
LM (A) [══SUPPORT══][═══SWING═══]
RR (A) [══SUPPORT══][═══SWING═══]
LF (B) [═══SWING═══][══SUPPORT══]
RM (B) [═══SWING═══][══SUPPORT══]
LR (B) [═══SWING═══][══SUPPORT══]
```

#### Caractéristiques

| Paramètre | Valeur |
|-----------|--------|
| Duty cycle | 50% support / 50% swing |
| Pattes au sol | Toujours 3 |
| Vitesse | Rapide |
| Stabilité | Acceptable (triangle de support) |
| Couple fémur requis | **Maximal** ⚠️ |

#### Statut pour HexaGram

⚠️ **À UTILISER UNIQUEMENT À VITESSE LENTE** (< 3 cm/s) et avec posture compacte.
Risque de dépassement du couple HS-475HB en transition.

### 10.3 Allure RIPPLE (Ondulation) — RECOMMANDÉE ⭐

#### Principe

Les 6 pattes lèvent une par une, avec un **décalage de phase de 1/6 du cycle**.
À tout instant, 1 ou 2 pattes seulement sont en swing.

#### Diagramme temporel

```
Temps  →   0%   17%   33%   50%   67%   83%  100%
RF     [SUPP][SWNG][════════════ SUPPORT ════════════]
RR     [════ SUPPORT ════][SWNG][════════ SUPPORT ════]
LM     [════════ SUPPORT ════════][SWNG][═══ SUPPORT ══]
LF     [════════════ SUPPORT ════════════][SWNG][SUPP ]
LR     [══════════════ SUPPORT ════════════════][SWNG]
RM     [SWNG][═════════════ SUPPORT ════════════════]
```

#### Caractéristiques

| Paramètre | Valeur |
|-----------|--------|
| Duty cycle | ~83% support / ~17% swing |
| Pattes au sol | Toujours 5 (parfois 4) |
| Vitesse | Moyenne |
| Stabilité | Excellente |
| Couple fémur requis | **Faible** ✅ |

#### Statut pour HexaGram

✅ **MODE PAR DÉFAUT**. Sécurité maximale pour les HS-475HB.

### 10.4 Allure WAVE (Vague)

#### Principe

Les 6 pattes lèvent strictement une par une, sans chevauchement.
À tout instant, exactement 1 patte est en swing.

#### Caractéristiques

| Paramètre | Valeur |
|-----------|--------|
| Duty cycle | ~83% support / ~17% swing |
| Pattes au sol | Exactement 5 |
| Vitesse | Lente |
| Stabilité | Maximale |
| Couple fémur requis | Minimal ✅ |

#### Statut pour HexaGram

✅ **MODE PRÉCISION** : terrain délicat, posture statique stable, démarrage.

### 10.5 Tableau de décision automatique des allures

```cpp
GaitType selectGait(float target_speed_mm_s, BatteryState bat) {
    if (bat.voltage < 7.0f)        return GAIT_WAVE;   // économie
    if (target_speed_mm_s < 20.0f) return GAIT_WAVE;
    if (target_speed_mm_s < 50.0f) return GAIT_RIPPLE;
    if (target_speed_mm_s < 80.0f) return GAIT_TRIPOD;
    return GAIT_TRIPOD;  // plafond — mais déconseillé
}
```

---

## 11. Cycle de marche détaillé

### 11.1 Phases d'une patte

Une patte effectue un cycle composé de **2 phases** :

```
┌──────────────────── CYCLE COMPLET ────────────────────┐
│                                                        │
│    SUPPORT (stance)              SWING                 │
│    Pied au sol                   Pied en l'air         │
│    ─────────────────             ─────────────         │
│                                                        │
│    Le pied "pousse" vers          Le pied se lève,     │
│    l'arrière pour faire           avance vers la       │
│    avancer le corps               nouvelle position    │
│                                   et redescend         │
└────────────────────────────────────────────────────────┘
```

### 11.2 Trajectoire du pied pendant le swing

```
                        Apogée
                          ●
                       ╱─────╲
                      ╱       ╲       ← Demi-cercle ou
                     ╱         ╲         courbe lissée
                    ╱           ╲
                   ╱             ╲
                  ╱               ╲
   ─────────────●─────────────────●───────────────
              Décollage          Atterrissage
            (pos_actuelle)      (pos_actuelle + vecteur_pas)

   Hauteur d'apogée = STEP_HEIGHT (15–30 mm)
```

Formule paramétrique simple (interpolation linéaire + cloche sinusoïdale) :

```cpp
// t va de 0 à 1 pendant la phase swing
Vec3 footTrajectory(Vec3 start, Vec3 end, float step_height, float t) {
    Vec3 result;
    result.x = start.x + (end.x - start.x) * t;
    result.y = start.y + (end.y - start.y) * t;
    result.z = start.z + step_height * sin(t * PI);  // cloche
    return result;
}
```

### 11.3 Mouvement pendant le support

Pendant la phase support, le pied **reste au sol** (z constant) et glisse
vers l'arrière en suivant le **vecteur de déplacement inverse** du corps :

```cpp
// Pendant le support, le pied ne bouge pas dans le repère MONDE
// Mais dans le repère CORPS (qui avance), le pied recule vers l'arrière

// Sur une boucle de contrôle (dt = 20 ms à 50 Hz) :
foot_body_position.x -= body_velocity.x * dt;
foot_body_position.y -= body_velocity.y * dt;
// Plus rotation si yaw_rate != 0
```

### 11.4 Géométrie du polygone de support

À tout instant, les pattes en support définissent un **polygone de stabilité**.
Pour que le robot soit stable, son **centre de gravité projeté au sol** doit
être à l'intérieur de ce polygone.

```
       Polygone de support (tripode RF, LM, RR) :

              RF ●─────────────────● RR
                  ╲               ╱
                   ╲     ●CoG    ╱   ← Centre de gravité projeté
                    ╲   ▼       ╱
                     ╲         ╱
                      ╲       ╱
                       ╲     ╱
                        ╲   ╱
                         ╲ ╱
                          ● LM

       Si CoG sort du triangle → BASCULEMENT !
```

Le code doit **vérifier la stabilité** à chaque pas de temps et corriger
la posture (déplacer le corps légèrement vers le centre du polygone) si nécessaire.

---

## 12. Protocole de communication SSC-32U

### 12.1 Paramètres série

| Paramètre | Valeur |
|-----------|--------|
| Baud rate | 115200 |
| Bits de données | 8 |
| Parité | Aucune |
| Bits de stop | 1 |
| Niveau électrique | TTL 5 V |
| Contrôle de flux | Aucun |

### 12.2 Commandes principales

| Commande | Syntaxe | Description |
|----------|---------|-------------|
| Position seule | `#<n> P<pos><CR>` | Servo n à position pos (μs) |
| Position + temps | `#<n> P<pos> T<temps><CR>` | Atteindre pos en temps ms |
| Position + vitesse | `#<n> P<pos> S<vitesse><CR>` | Vitesse en μs/seconde |
| **Mouvement groupé** | `#0 P1500 #1 P1200 #2 P1800 ... T200<CR>` | Plusieurs servos synchronisés |
| Arrêt servo | `STOP<n><CR>` | Stoppe le canal n |
| État mouvement | `Q<CR>` | Renvoie `.` (fini) ou `+` (en cours) |
| Lire position | `QP<n><CR>` | Position actuelle du canal n |
| Version firmware | `VER<CR>` | Version de la SSC-32U |

> **Important** : `<CR>` = caractère ASCII 13 (Carriage Return, `\r`).
> Ne PAS envoyer `\n` (Line Feed) — uniquement `\r`.

### 12.3 Exemple de trame complète pour 18 servos

Pour positionner les 18 servos en 100 ms :

```
#0 P1500 #1 P1450 #2 P1550 #4 P1500 #5 P1450 #6 P1550 #8 P1500 #9 P1450 #10 P1550 #16 P1500 #17 P1450 #18 P1550 #20 P1500 #21 P1450 #22 P1550 #24 P1500 #25 P1450 #26 P1550 T100<CR>
```

> Une trame complète fait ~200 caractères. À 115200 bps, son envoi prend ~17 ms.
> Cela permet une fréquence de mise à jour confortable (50 Hz).

### 12.4 Synchronisation

La SSC-32U **interpole linéairement** entre la position actuelle et la position
cible sur la durée `T`. Cela donne :

- **Mouvement fluide** sans gérer soi-même les rampes
- **Synchronisation parfaite** entre tous les servos d'une même trame
- **Pas besoin de PID** côté hôte (la SSC-32U gère)

### 12.5 Vérification d'état

Pour savoir si un mouvement précédent est terminé avant d'envoyer le suivant :

```cpp
serial.write("Q\r");
char response = serial.read();
if (response == '.') {
    // Mouvement terminé, on peut envoyer la prochaine commande
} else if (response == '+') {
    // Mouvement en cours, attendre
}
```

> ⚠️ Ne pas envoyer trop de commandes à la suite sans vérifier `Q` —
> la SSC-32U a un buffer limité.

---

## 13. Architecture logicielle recommandée

### 13.1 Vue d'ensemble en couches

```
┌────────────────────────────────────────────┐
│ Couche 5 — INTERFACE UTILISATEUR           │
│ (Manette, télécommande, application)       │
└─────────────┬──────────────────────────────┘
              │ Vecteur de commande
┌─────────────▼──────────────────────────────┐
│ Couche 4 — LOGIQUE DE HAUT NIVEAU          │
│ (Sélection d'allure, gestion de l'état,    │
│  modes spéciaux, séquences scriptées)      │
└─────────────┬──────────────────────────────┘
              │ Mode + paramètres
┌─────────────▼──────────────────────────────┐
│ Couche 3 — GÉNÉRATEUR DE MARCHE (gait)     │
│ (Cycle, phases swing/support, trajectoire) │
└─────────────┬──────────────────────────────┘
              │ Positions de pieds (6 × Vec3)
┌─────────────▼──────────────────────────────┐
│ Couche 2 — CINÉMATIQUE INVERSE             │
│ (Position pied → angles articulaires)      │
└─────────────┬──────────────────────────────┘
              │ Angles (18 × float)
┌─────────────▼──────────────────────────────┐
│ Couche 1 — DRIVER SSC-32U                  │
│ (Conversion angle → PWM, protocole série)  │
└────────────────────────────────────────────┘
```

### 13.2 Structures de données suggérées

```cpp
// Vecteur 3D
struct Vec3 {
    float x, y, z;
};

// Paramètres d'un servo
struct ServoConfig {
    uint8_t channel;        // 0-31 sur SSC-32U
    int16_t center_pulse;   // typiquement 1500 μs
    int16_t min_pulse;      // limite physique min
    int16_t max_pulse;      // limite physique max
    int8_t  direction;      // +1 ou -1 (sens de rotation)
    float   offset_deg;     // décalage de calibration
};

// Une patte
struct Leg {
    Vec3        coxa_pos_in_body;   // position de l'axe coxa dans le repère corps
    float       attach_angle_deg;   // angle d'attache de la patte
    ServoConfig coxa;
    ServoConfig femur;
    ServoConfig tibia;
    Vec3        current_foot_world; // position courante du pied (monde)
    Vec3        target_foot_world;  // position cible (monde)
    GaitPhase   phase;              // SUPPORT ou SWING
    float       phase_progress;     // 0.0 à 1.0
};

// État global du robot
struct HexaGramState {
    Leg     legs[6];               // les 6 pattes
    Vec3    body_position;         // position du corps (monde)
    float   body_yaw_deg;          // orientation du corps
    Vec3    body_velocity;         // vitesse instantanée
    float   body_yaw_rate_dps;     // vitesse de rotation
    GaitType current_gait;         // allure active
    float   gait_cycle_progress;   // 0.0 à 1.0
    float   battery_voltage;
    bool    emergency_stop;
};
```

### 13.3 Boucle principale (50 Hz)

```cpp
void mainLoop() {
    static uint32_t last_tick = 0;
    const uint32_t period_ms = 20;  // 50 Hz

    uint32_t now = millis();
    if (now - last_tick < period_ms) return;
    float dt = (now - last_tick) / 1000.0f;
    last_tick = now;

    // 1. Lecture entrées
    InputCommand cmd = readUserInput();

    // 2. Mise à jour état batterie + sécurité
    state.battery_voltage = readBatteryVoltage();
    if (state.battery_voltage < 6.6f) {
        emergencyStop();
        return;
    }

    // 3. Sélection d'allure
    GaitType new_gait = selectGait(cmd.speed, state.battery_voltage);
    if (new_gait != state.current_gait) {
        transitionGait(new_gait);
    }

    // 4. Mise à jour du cycle de marche
    state.gait_cycle_progress += cmd.speed * dt / GAIT_LENGTH;
    if (state.gait_cycle_progress >= 1.0f) state.gait_cycle_progress -= 1.0f;

    // 5. Pour chaque patte, calculer la position cible
    for (int i = 0; i < 6; ++i) {
        updateLegPhase(state.legs[i], state.gait_cycle_progress, state.current_gait);
        computeFootTarget(state.legs[i], cmd, dt);
    }

    // 6. Cinématique inverse pour chaque patte
    float angles[18];
    for (int i = 0; i < 6; ++i) {
        Vec3 foot_local = bodyToLeg(state.legs[i].target_foot_world,
                                    state.legs[i]);
        LegIKResult ik = computeLegIK(foot_local.x, foot_local.y, foot_local.z);
        if (!ik.valid) continue;
        angles[i*3 + 0] = ik.theta1_deg;
        angles[i*3 + 1] = ik.theta2_deg;
        angles[i*3 + 2] = ik.theta3_deg;
    }

    // 7. Envoi à la SSC-32U
    sendServoCommandsToSSC32U(angles, period_ms);
}
```

### 13.4 Choix du langage et de la plateforme

Compte tenu du profil développeur C#/.NET du projet HexaGram :

| Architecture | Avantages | Inconvénients |
|--------------|-----------|----------------|
| **100% Arduino Mega (C++)** | Simple, autonome, faible latence | Pas de C# |
| **PC (C#) + Arduino (relais série)** | C# pour la logique, .NET disponible | Latence ajoutée, dépendance USB |
| **Raspberry Pi (C# .NET)** | Embarqué + C# possible (.NET 8+) | Démarrage lent, sensibilité courant |
| **ESP32 (Arduino C++ ou MicroPython)** | WiFi natif, double cœur, rapide | Pas de C# |

**Recommandation** : commencer par **Arduino Mega en C++** pour la couche de marche
(boucle 50 Hz, déterministe), puis ajouter un **superviseur C# sur PC** ou
**Raspberry Pi** pour la logique de haut niveau (planification, interface,
modes scriptés) via une communication série secondaire.

---

## 14. Calibration des servomoteurs

### 14.1 Procédure de calibration manuelle

Pour chaque servo, déterminer trois valeurs :

1. **Centre mécanique** : impulsion (μs) où la patte est dans sa position neutre
2. **Limite min** : impulsion (μs) où le servo est en butée mécanique côté minimum
3. **Limite max** : impulsion (μs) où le servo est en butée mécanique côté maximum

### 14.2 Méthode

```
Pour chaque servo :
1. Brancher uniquement ce servo sur la SSC-32U (autres débranchés ou immobilisés)
2. Démonter physiquement la patte pour éviter les contraintes mécaniques
3. Envoyer #<n> P1500 T2000<CR>
4. Noter visuellement la position angulaire
5. Ajuster #<n> P1450 ou P1550 jusqu'à atteindre la position neutre voulue
6. Sauvegarder cette valeur comme center_pulse
7. Remonter mécaniquement et tester les limites min/max sans forcer
```

### 14.3 Fichier de calibration

Format JSON ou CSV stocké en EEPROM (Arduino) ou fichier local (PC) :

```json
{
  "robot_name": "HexaGram-01",
  "calibration_date": "2026-05-23",
  "legs": [
    {
      "name": "RF",
      "coxa":  { "channel":  0, "center": 1500, "min": 900, "max": 2100, "dir":  1, "offset_deg":  0.0 },
      "femur": { "channel":  1, "center": 1500, "min": 1100, "max": 1900, "dir":  1, "offset_deg":  0.0 },
      "tibia": { "channel":  2, "center": 1500, "min": 900, "max": 2100, "dir":  1, "offset_deg":  0.0 }
    }
  ]
}
```

---

## 15. Monitoring et sécurité

### 15.1 Mesures à logger à chaque cycle

| Mesure | Fréquence | Source | Action si dépassement |
|--------|-----------|--------|------------------------|
| Tension batterie | 50 Hz | ADC + diviseur | Alarme < 7,0 V, coupe < 6,6 V |
| État SSC-32U (commande Q) | 10 Hz | Série | Reset si pas de réponse |
| Position cible vs limites | À chaque IK | Calcul | Saturation + alerte |
| Cycle de marche | 50 Hz | État interne | — |
| Temps de boucle effectif | 50 Hz | millis() | Alerte si > 25 ms |

### 15.2 Système d'alerte hiérarchique

```cpp
enum AlertLevel {
    ALERT_NONE,      // Tout va bien
    ALERT_INFO,      // Information (changement d'allure, etc.)
    ALERT_WARNING,   // Attention (batterie basse, IK saturée)
    ALERT_CRITICAL,  // Critique (servo bloqué, tension <)
    ALERT_FATAL      // Arrêt immédiat (batterie morte, perte SSC-32U)
};

void raiseAlert(AlertLevel level, const char* msg) {
    // Log + buzzer + LED + affichage selon niveau
}
```

### 15.3 Comportements d'urgence

| Situation | Action |
|-----------|--------|
| Tension batterie < 6,6 V | Posture statique 6 pattes (basse), buzzer continu |
| Perte communication SSC-32U | Reset série, 3 tentatives, puis arrêt |
| IK invalide pour > 2 pattes | Posture statique, attendre commande valide |
| Boucle de contrôle > 50 ms | Log + réduction de fréquence cible |
| Buzzer LiPo déclenché | Arrêt immédiat, requête utilisateur |

---

## 16. Pseudocode de référence

### 16.1 Initialisation au démarrage

```cpp
void setup() {
    // 1. Initialiser la communication série avec la SSC-32U
    Serial1.begin(115200);
    delay(1000);  // attendre que la SSC-32U soit prête

    // 2. Charger la calibration depuis EEPROM
    loadCalibration();

    // 3. Mettre les servos en position neutre (lentement, 2 secondes)
    sendNeutralPosition(2000);
    delay(2500);

    // 4. Adopter la posture de démarrage (6 pattes au sol, hauteur 8 cm)
    adoptStandingPose(1500);
    delay(2000);

    // 5. Initialiser le monitoring batterie
    pinMode(BATTERY_ADC_PIN, INPUT);

    // 6. Démarrer la boucle principale
    Serial.println("HexaGram ready.");
}
```

### 16.2 Génération du cycle ripple

```cpp
// Phases relatives de chaque patte dans le cycle ripple
const float ripple_phase_offsets[6] = {
    0.0f / 6.0f,  // RF
    1.0f / 6.0f,  // RM (note : décalage non trivial selon convention)
    2.0f / 6.0f,  // RR
    3.0f / 6.0f,  // LR
    4.0f / 6.0f,  // LM
    5.0f / 6.0f   // LF
};

// Durée de swing dans le cycle (17% en ripple)
const float SWING_DUTY = 0.17f;

void updateLegPhaseRipple(Leg& leg, int leg_index, float cycle_progress) {
    float local_phase = cycle_progress - ripple_phase_offsets[leg_index];
    if (local_phase < 0.0f) local_phase += 1.0f;

    if (local_phase < SWING_DUTY) {
        leg.phase = SWING;
        leg.phase_progress = local_phase / SWING_DUTY;
    } else {
        leg.phase = SUPPORT;
        leg.phase_progress = (local_phase - SWING_DUTY) / (1.0f - SWING_DUTY);
    }
}
```

### 16.3 Calcul de la position cible du pied

```cpp
Vec3 computeFootTarget(Leg& leg, InputCommand cmd, float dt) {
    Vec3 target;

    if (leg.phase == SUPPORT) {
        // Le pied reste au sol et glisse en direction inverse du déplacement
        target.x = leg.current_foot_world.x - cmd.velocity.x * dt;
        target.y = leg.current_foot_world.y - cmd.velocity.y * dt;
        target.z = 0.0f;  // au sol
    } else {  // SWING
        // Trajectoire en cloche depuis position de décollage vers nouvelle cible
        Vec3 takeoff = leg.takeoff_position;
        Vec3 landing = computeLandingPosition(leg, cmd);
        target = footTrajectory(takeoff, landing, STEP_HEIGHT_DEFAULT_MM,
                                leg.phase_progress);
    }

    return target;
}
```

### 16.4 Envoi groupé à la SSC-32U

```cpp
void sendServoCommandsToSSC32U(float angles[18], int duration_ms) {
    char buffer[512];
    int idx = 0;

    const uint8_t channels[18] = {
         0,  1,  2,    // RF
         4,  5,  6,    // RM
         8,  9, 10,    // RR
        16, 17, 18,    // LF
        20, 21, 22,    // LM
        24, 25, 26     // LR
    };

    for (int i = 0; i < 18; ++i) {
        int pulse = angleToPulse(angles[i], servo_configs[i]);
        idx += sprintf(buffer + idx, "#%d P%d ", channels[i], pulse);
    }
    idx += sprintf(buffer + idx, "T%d\r", duration_ms);

    Serial1.write(buffer, idx);
}

int angleToPulse(float angle_deg, ServoConfig& cfg) {
    float corrected = angle_deg + cfg.offset_deg;
    int pulse = cfg.center_pulse + (int)(corrected * 6.667f * cfg.direction);
    return constrain(pulse, cfg.min_pulse, cfg.max_pulse);
}
```

---

## 17. Glossaire

| Terme | Définition |
|-------|------------|
| **Allure (gait)** | Motif temporel décrivant le mouvement coordonné des pattes |
| **BEC** | Battery Eliminator Circuit — régulateur DC-DC abaisseur |
| **Bras de levier** | Distance horizontale entre l'axe d'un servo et le point d'application de la force |
| **CoG** | Center of Gravity — centre de gravité |
| **Coxa** | Premier segment d'une patte (et terminologie hexapode) |
| **C-rate** | Multiplicateur du courant max d'une batterie par rapport à sa capacité |
| **Cycle de marche** | Période complète après laquelle le motif de marche se répète |
| **Duty cycle** | Fraction de temps qu'une patte passe en support |
| **Fémur** | Deuxième segment d'une patte |
| **IK (Inverse Kinematics)** | Cinématique inverse — calcul d'angles à partir d'une position |
| **LiPo** | Lithium Polymer — chimie de batterie haute densité |
| **PWM** | Pulse Width Modulation — modulation par largeur d'impulsion |
| **Polygone de support** | Surface au sol délimitée par les pieds en contact |
| **Ripple** | Allure de marche où une patte lève à la fois en séquence ondulée |
| **SSC-32U** | Carte contrôleur de servos Lynxmotion 32 canaux USB |
| **Stance / Support** | Phase d'une patte où le pied est au sol |
| **Swing** | Phase d'une patte où le pied est en l'air |
| **Tibia** | Troisième segment d'une patte |
| **Tripode (tripod)** | Allure où 3 pattes sont au sol simultanément |
| **TTL** | Transistor-Transistor Logic — niveau logique 0/5 V |
| **UBEC** | Universal BEC — type de BEC polyvalent et réglable |
| **VS1 / VS2** | Entrées d'alimentation servos de la SSC-32U (banques 1 et 2) |
| **Wave (vague)** | Allure très lente, 1 patte lève à la fois sans chevauchement |
| **Yaw** | Rotation autour de l'axe vertical (gauche/droite vue de dessus) |

---

## Annexes

### A. Constantes numériques de référence

```cpp
// Géométrie
#define L1_COXA_MM          50.0f
#define L2_FEMUR_MM         80.0f
#define L3_TIBIA_MM        115.0f
#define LEG_MAX_REACH_MM   245.0f   // L1 + L2 + L3

// Posture
#define BODY_HEIGHT_DEFAULT_MM   80.0f
#define BODY_HEIGHT_MIN_MM       60.0f
#define BODY_HEIGHT_MAX_MM      100.0f
#define LEVER_ARM_FEMUR_MAX_MM   50.0f
#define LEVER_ARM_FEMUR_TARGET_MM 40.0f

// Marche
#define STEP_LENGTH_DEFAULT_MM   25.0f
#define STEP_LENGTH_MIN_MM       10.0f
#define STEP_LENGTH_MAX_MM       40.0f
#define STEP_HEIGHT_DEFAULT_MM   20.0f
#define STEP_HEIGHT_MIN_MM       15.0f
#define STEP_HEIGHT_MAX_MM       30.0f

// Vitesses
#define SPEED_SLOW_MM_S          20.0f
#define SPEED_NORMAL_MM_S        40.0f
#define SPEED_MAX_MM_S           80.0f
#define YAW_RATE_MAX_DEG_S       30.0f

// Servo HS-475HB
#define SERVO_PULSE_CENTER_US   1500
#define SERVO_PULSE_MIN_US       900
#define SERVO_PULSE_MAX_US      2100
#define SERVO_TORQUE_MAX_KGCM    5.5f
#define SERVO_TORQUE_SAFE_KGCM   4.4f   // 80% du max

// Batterie LiPo 2S
#define BAT_VOLT_FULL          8.4f
#define BAT_VOLT_NOMINAL       7.4f
#define BAT_VOLT_WARNING       7.0f
#define BAT_VOLT_ECONOMY       6.8f
#define BAT_VOLT_CUTOFF        6.6f
#define BAT_VOLT_DAMAGED       6.0f

// Boucle de contrôle
#define CONTROL_LOOP_HZ          50
#define CONTROL_LOOP_PERIOD_MS   20
#define SERVO_INTERP_DEFAULT_MS 100
```

### B. Historique des révisions

| Date | Version | Auteur | Modifications |
|------|---------|--------|---------------|
| 2026-05-23 | 1.0 | — | Création initiale |

---

*Document généré pour le projet HexaGram — moteur de marche d'hexapode SSC-32U + 18 × HS-475HB*
