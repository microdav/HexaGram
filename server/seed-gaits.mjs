/**
 * Seed les 3 gaits de marche standard dans la DB SQLite.
 * Usage : node --experimental-sqlite server/seed-gaits.mjs
 *
 * Conventions pose (18 valeurs, ordre L0…L5, chaque leg = [coxa, femur, tibia]) :
 *   Legs gauche (0,1,2) : fwd = coxa -25 ; bck = coxa +25
 *   Legs droite (3,4,5) : fwd = coxa +25 ; bck = coxa -25
 *   (miroir coxa : -deg côté opposé → voir useHexapodStore.ts)
 *   U   = [0,  20, -30]  patte levée (swing)
 *   fwd = [±25, -20, -60]  patte en avant (début stance)
 *   mid = [0,  -20, -60]  position neutre (mi-stance)
 *   bck = [∓25, -20, -60]  patte en arrière (fin stance)
 */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "data", "data.db");
const db = new DatabaseSync(DB_PATH);

// ── helpers ────────────────────────────────────────────────────────────────
const U   = (side) => side === "L" ? [0,  20, -30] : [0,  20, -30];
const fwd = (side) => side === "L" ? [-25, -20, -60] : [25, -20, -60];
const mid = ()     => [0, -20, -60];
const bck = (side) => side === "L" ? [25, -20, -60] : [-25, -20, -60];

// side par leg index : 0,1,2 = L ; 3,4,5 = R
const S = ["L","L","L","R","R","R"];

function pose(...legs) {
  // legs = tableau de 6 éléments, chacun = [coxa, femur, tibia]
  return legs.flat();
}

function step(name, ...legs) {
  return {
    id: randomUUID(),
    name,
    type: "defined",
    pose: pose(...legs),
  };
}

// ── TRIPOD ─────────────────────────────────────────────────────────────────
// Groupe A : L0(FL), L2(RL), L4(MR) ; Groupe B : L1(ML), L3(FR), L5(RR)
const tripodSteps = [
  step("A avant, B levé",
    fwd("L"), U("L"),   fwd("L"),   // L0, L1, L2
    U("R"),   fwd("R"), U("R")),    // L3, L4, L5

  step("A arrière, B avant",
    bck("L"), fwd("L"),  bck("L"),  // L0, L1, L2
    fwd("R"), bck("R"),  fwd("R")), // L3, L4, L5

  step("A levé, B avant",
    U("L"),   fwd("L"),  U("L"),    // L0, L1, L2
    fwd("R"), U("R"),    fwd("R")), // L3, L4, L5

  step("A avant, B arrière",
    fwd("L"), bck("L"),  fwd("L"),  // L0, L1, L2
    bck("R"), fwd("R"),  bck("R")), // L3, L4, L5
];

// ── RIPPLE ─────────────────────────────────────────────────────────────────
// Paires diagonales : A={L0,L5}, B={L2,L3}, C={L1,L4}
// Stance de 4 pas : fwd → mid → bck → bck
// (2 pattes en l'air à chaque étape)
const rippleSteps = [
  // s1 : A=U (swing), B=bck (4e stance), C=mid (2e stance)
  step("Paire A levée",
    U("L"),    mid("L"), bck("L"),  // L0=U, L1=mid, L2=bck
    bck("R"),  mid("R"), U("R")),   // L3=bck, L4=mid, L5=U

  // s2 : A=fwd (atterrit), B=bck, C=bck
  step("Paire A atterrit",
    fwd("L"), bck("L"),  bck("L"),  // L0=fwd, L1=bck, L2=bck
    bck("R"),  bck("R"), fwd("R")), // L3=bck, L4=bck, L5=fwd

  // s3 : B=U (swing), A=mid (1e stance), C=bck
  step("Paire B levée",
    mid("L"), bck("L"),  U("L"),    // L0=mid, L1=bck, L2=U
    U("R"),   bck("R"),  mid("R")), // L3=U, L4=bck, L5=mid

  // s4 : B=fwd (atterrit), A=bck, C=bck
  step("Paire B atterrit",
    bck("L"), bck("L"),  fwd("L"),  // L0=bck, L1=bck, L2=fwd
    fwd("R"),  bck("R"), bck("R")), // L3=fwd, L4=bck, L5=bck

  // s5 : C=U (swing), A=bck, B=mid
  step("Paire C levée",
    bck("L"), U("L"),    mid("L"),  // L0=bck, L1=U, L2=mid
    mid("R"),  U("R"),   bck("R")), // L3=mid, L4=U, L5=bck

  // s6 : C=fwd (atterrit), A=bck, B=bck
  step("Paire C atterrit",
    bck("L"), fwd("L"),  bck("L"),  // L0=bck, L1=fwd, L2=bck
    bck("R"),  fwd("R"), bck("R")), // L3=bck, L4=fwd, L5=bck
];

// ── WAVE ───────────────────────────────────────────────────────────────────
// Ordre de levée : L0 → L3 → L1 → L4 → L2 → L5
// Progression stance sur 5 pas : fwd(F) → mid(N) → mid(N) → bck(B) → bck(B)
//
// Table calculée (U=swing, F=fwd, N=mid, B=bck) :
//   s1 : L0=U  L1=B  L2=N  L3=B  L4=N  L5=F
//   s2 : L0=F  L1=B  L2=N  L3=U  L4=B  L5=N
//   s3 : L0=N  L1=U  L2=B  L3=F  L4=B  L5=N
//   s4 : L0=N  L1=F  L2=B  L3=N  L4=U  L5=B
//   s5 : L0=B  L1=N  L2=U  L3=N  L4=F  L5=B
//   s6 : L0=B  L1=N  L2=F  L3=B  L4=N  L5=U
const waveSteps = [
  step("L0 levée (FL)",
    U("L"),   bck("L"),  mid("L"),  // L0=U,  L1=bck, L2=mid
    bck("R"), mid("R"),  fwd("R")), // L3=bck, L4=mid, L5=fwd

  step("L3 levée (FR)",
    fwd("L"), bck("L"),  mid("L"),  // L0=fwd, L1=bck, L2=mid
    U("R"),   bck("R"),  mid("R")), // L3=U,  L4=bck, L5=mid

  step("L1 levée (ML)",
    mid("L"), U("L"),    bck("L"),  // L0=mid, L1=U,   L2=bck
    fwd("R"), bck("R"),  mid("R")), // L3=fwd, L4=bck, L5=mid

  step("L4 levée (MR)",
    mid("L"), fwd("L"),  bck("L"),  // L0=mid, L1=fwd, L2=bck
    mid("R"), U("R"),    bck("R")), // L3=mid, L4=U,   L5=bck

  step("L2 levée (RL)",
    bck("L"), mid("L"),  U("L"),    // L0=bck, L1=mid, L2=U
    mid("R"), fwd("R"),  bck("R")), // L3=mid, L4=fwd, L5=bck

  step("L5 levée (RR)",
    bck("L"), mid("L"),  fwd("L"),  // L0=bck, L1=mid, L2=fwd
    bck("R"), mid("R"),  U("R")),   // L3=bck, L4=mid, L5=U
];

// ── Insertion ──────────────────────────────────────────────────────────────
const users = db.prepare("SELECT id FROM users ORDER BY created_at ASC").all();
if (users.length === 0) { console.error("Aucun utilisateur trouvé."); process.exit(1); }

const insert = db.prepare(
  "INSERT INTO sequences (id, user_id, name, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const exists = db.prepare(
  "SELECT id FROM sequences WHERE user_id = ? AND name = ?"
);

const gaits = [
  { name: "Gait — Tripod", steps: tripodSteps },
  { name: "Gait — Ripple", steps: rippleSteps },
  { name: "Gait — Wave",   steps: waveSteps   },
];

for (const { id: userId } of users) {
  let inserted = 0;
  for (const { name, steps } of gaits) {
    if (exists.get(userId, name)) continue; // idempotent: skip if already present
    const now = Date.now();
    insert.run(randomUUID(), userId, name, JSON.stringify(steps), now, now);
    inserted++;
  }
  console.log(`User ${userId}: ${inserted} séquence(s) insérée(s)`);
}

console.log("Seed terminé.");
