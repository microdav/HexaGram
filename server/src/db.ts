/* eslint-disable @typescript-eslint/no-require-imports */
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { CATALOG_SEED, CATALOG_KINDS } from "./catalogs/seedData";

// node:sqlite est expérimental en Node 22/24 — types non encore dans @types/node
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = require("node:sqlite") as any;

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "data.db");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    country TEXT,
    avatar_seed TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    hardware TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS robot_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sequences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    steps TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS programs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS poses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    profile_id TEXT,
    name TEXT NOT NULL,
    angles TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Référentiels matériels éditables (servomoteurs, cartes servo, cartes de
  -- commande, capteurs). Source de vérité côté serveur, seedée au démarrage
  -- depuis le snapshot intégré (catalogs/seedData.ts).
  CREATE TABLE IF NOT EXISTS catalog_entries (
    kind TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    data TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (kind, entry_id)
  );
`);

// ── Migrations idempotentes ──────────────────────────────────────────────────

function tableHasColumn(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  if (!tableHasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[hexagram-api] migration: ${table}.${column} ajouté`);
  }
}

addColumnIfMissing("robot_profiles", "project_id", "TEXT");
addColumnIfMissing("sequences",      "project_id", "TEXT");
addColumnIfMissing("programs",       "project_id", "TEXT");
addColumnIfMissing("projects",       "preferences", "TEXT NOT NULL DEFAULT '{}'");
// Vignettes pré-générées (PNG dataURL) + empreinte du contexte de rendu.
// Si l'empreinte ne matche pas le contexte courant côté client, la vignette
// est ignorée et régénérée à la volée. Pour les steps de séquence, ces
// champs sont portés par chaque step à l'intérieur du JSON `steps`.
addColumnIfMissing("poses",          "thumbnail",         "TEXT");
addColumnIfMissing("poses",          "thumbnail_context", "TEXT");
// Marque « pose de base » (stance de référence pour la génération de démarche).
addColumnIfMissing("poses",          "is_base",           "INTEGER NOT NULL DEFAULT 0");
// Droits d'administration et état d'activation des comptes.
addColumnIfMissing("users",          "is_admin",          "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users",          "is_active",         "INTEGER NOT NULL DEFAULT 1");

// ── Migration « offset de montage » (convention repère servo) ────────────────
// Bascule unique : les angles étaient stockés en repère géométrique (tibia 0 =
// aligné). On passe au repère servo (0 = centre = tibia perpendiculaire) en
// décalant le tibia de +90° dans toutes les poses stockées, et en posant
// geometry.mountingOffsetsDeg (tibia −90°). La FK rajoute l'offset → rendu
// IDENTIQUE ; seul l'envoi au robot devient correct. Idempotent via user_version.
const MOUNTING_MIGRATION_VERSION = 1;
const TIBIA_INDICES = [2, 5, 8, 11, 14, 17];
const DEFAULT_MOUNTING_OFFSETS = Array.from({ length: 18 }, (_, i) => (i % 3 === 2 ? -90 : 0));

function shiftTibiaPose(angles: unknown): unknown {
  if (!Array.isArray(angles)) return angles;
  const out = angles.slice();
  for (const i of TIBIA_INDICES) {
    if (typeof out[i] === "number") out[i] = out[i] + 90;
  }
  return out;
}

function shiftStepsPoses(steps: unknown): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (step && Array.isArray((step as { pose?: unknown }).pose)) {
      (step as { pose: unknown }).pose = shiftTibiaPose((step as { pose: unknown }).pose);
    }
  }
}

function runMountingOffsetMigration(): void {
  const cur = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (cur >= MOUNTING_MIGRATION_VERSION) return;

  db.exec("BEGIN");
  try {
    // Poses
    const poses = db.prepare("SELECT id, angles FROM poses").all() as Array<{ id: string; angles: string }>;
    const updPose = db.prepare("UPDATE poses SET angles = ? WHERE id = ?");
    for (const p of poses) {
      try { updPose.run(JSON.stringify(shiftTibiaPose(JSON.parse(p.angles))), p.id); } catch { /* skip */ }
    }
    // Séquences (steps[].pose)
    const seqs = db.prepare("SELECT id, steps FROM sequences").all() as Array<{ id: string; steps: string }>;
    const updSeq = db.prepare("UPDATE sequences SET steps = ? WHERE id = ?");
    for (const s of seqs) {
      try { const steps = JSON.parse(s.steps); shiftStepsPoses(steps); updSeq.run(JSON.stringify(steps), s.id); } catch { /* skip */ }
    }
    // Programmes (data.initPose + data.steps[].pose ; steps "ref" sans pose ignorés)
    const progs = db.prepare("SELECT id, data FROM programs").all() as Array<{ id: string; data: string }>;
    const updProg = db.prepare("UPDATE programs SET data = ? WHERE id = ?");
    for (const pr of progs) {
      try {
        const data = JSON.parse(pr.data);
        if (Array.isArray(data.initPose)) data.initPose = shiftTibiaPose(data.initPose);
        shiftStepsPoses(data.steps);
        updProg.run(JSON.stringify(data), pr.id);
      } catch { /* skip */ }
    }
    // Profils (geometry.mountingOffsetsDeg + keyframes[].pose)
    const profs = db.prepare("SELECT id, data FROM robot_profiles").all() as Array<{ id: string; data: string }>;
    const updProf = db.prepare("UPDATE robot_profiles SET data = ? WHERE id = ?");
    for (const rp of profs) {
      try {
        const data = JSON.parse(rp.data);
        if (data.geometry && !Array.isArray(data.geometry.mountingOffsetsDeg)) {
          data.geometry.mountingOffsetsDeg = DEFAULT_MOUNTING_OFFSETS;
        }
        if (Array.isArray(data.keyframes)) {
          for (const kf of data.keyframes) {
            if (kf && Array.isArray(kf.pose)) kf.pose = shiftTibiaPose(kf.pose);
          }
        }
        updProf.run(JSON.stringify(data), rp.id);
      } catch { /* skip */ }
    }
    db.exec(`PRAGMA user_version = ${MOUNTING_MIGRATION_VERSION}`);
    db.exec("COMMIT");
    console.log(
      `[hexagram-api] migration offsets de montage : ${poses.length} pose(s), ${seqs.length} séquence(s), ${progs.length} programme(s), ${profs.length} profil(s) — tibia +90° (repère servo)`
    );
  } catch (e) {
    db.exec("ROLLBACK");
    console.error("[hexagram-api] migration offsets de montage ÉCHEC (rollback)", e);
  }
}
runMountingOffsetMigration();

// ── Administrateur central : microdav ────────────────────────────────────────
// Promotion idempotente d'un compte existant (sans toucher au mot de passe).
// microdav ne peut jamais perdre l'admin ni être désactivé/supprimé (cf. admin.ts).
export const CENTRAL_ADMIN_LOGIN = "microdav";

function promoteCentralAdmin(): void {
  const res = db
    .prepare("UPDATE users SET is_admin = 1 WHERE login = ?")
    .run(CENTRAL_ADMIN_LOGIN);
  if (res.changes > 0) {
    console.log(`[hexagram-api] microdav promu administrateur central`);
  }
}

// ── Seed des référentiels matériels ──────────────────────────────────────────
// Insère les entrées intégrées manquantes (idempotent : ne touche pas aux
// entrées déjà présentes, donc préserve les éditions admin et les ajouts).
function seedCatalogs(): void {
  const now = Date.now();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO catalog_entries
       (kind, entry_id, data, builtin, sort, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`
  );
  let inserted = 0;
  for (const kind of CATALOG_KINDS) {
    CATALOG_SEED[kind].forEach((entry, index) => {
      const res = insert.run(kind, entry.id, JSON.stringify(entry.data), index, now, now);
      inserted += res.changes;
    });
  }
  if (inserted > 0) {
    console.log(`[hexagram-api] seed référentiels : ${inserted} entrée(s) ajoutée(s)`);
  }
}

// ── Migration des données existantes vers un projet par utilisateur ─────────

interface LegacyHardware {
  servoTypeId: string | null;
  servoControllerId: string | null;
  commandElectronicsId: string | null;
}

function extractHardwareFromProfileData(raw: string): LegacyHardware {
  try {
    const data = JSON.parse(raw) as {
      globalServoTypeId?: string | null;
      electronics?: { servoControllerId?: string; commandElectronicsId?: string };
    };
    return {
      servoTypeId: data.globalServoTypeId ?? null,
      servoControllerId: data.electronics?.servoControllerId ?? null,
      commandElectronicsId: data.electronics?.commandElectronicsId ?? null,
    };
  } catch {
    return { servoTypeId: null, servoControllerId: null, commandElectronicsId: null };
  }
}

function migrateUserToProject(userId: string): void {
  // Récupère tous les profils orphelins du user (pas encore liés à un projet)
  const orphanProfiles = db
    .prepare(
      "SELECT id, data, updated_at FROM robot_profiles WHERE user_id = ? AND project_id IS NULL ORDER BY updated_at DESC"
    )
    .all(userId) as Array<{ id: string; data: string; updated_at: number }>;
  const orphanSequences = db
    .prepare("SELECT id FROM sequences WHERE user_id = ? AND project_id IS NULL")
    .all(userId) as Array<{ id: string }>;
  const orphanPrograms = db
    .prepare("SELECT id FROM programs WHERE user_id = ? AND project_id IS NULL")
    .all(userId) as Array<{ id: string }>;

  if (orphanProfiles.length === 0 && orphanSequences.length === 0 && orphanPrograms.length === 0) {
    return;
  }

  // Hardware extrait du profil le plus récent
  const hardware: LegacyHardware = orphanProfiles.length > 0
    ? extractHardwareFromProfileData(orphanProfiles[0].data)
    : { servoTypeId: null, servoControllerId: null, commandElectronicsId: null };

  const projectId = uuidv4();
  const now = Date.now();
  db.prepare(
    "INSERT INTO projects (id, user_id, name, description, hardware, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    projectId,
    userId,
    "Hexapode Project",
    "Projet créé automatiquement lors de la migration des données existantes.",
    JSON.stringify({ ...hardware, customServoTypes: [] }),
    now,
    now
  );

  db.prepare(
    "UPDATE robot_profiles SET project_id = ? WHERE user_id = ? AND project_id IS NULL"
  ).run(projectId, userId);
  db.prepare(
    "UPDATE sequences SET project_id = ? WHERE user_id = ? AND project_id IS NULL"
  ).run(projectId, userId);
  db.prepare(
    "UPDATE programs SET project_id = ? WHERE user_id = ? AND project_id IS NULL"
  ).run(projectId, userId);

  console.log(
    `[hexagram-api] migration: user=${userId} → projet "${projectId}" (${orphanProfiles.length} profils, ${orphanSequences.length} séquences, ${orphanPrograms.length} programmes)`
  );
}

function runProjectMigration(): void {
  // Liste des users ayant au moins une entité orpheline
  const rows = db
    .prepare(`
      SELECT DISTINCT user_id FROM (
        SELECT user_id FROM robot_profiles WHERE project_id IS NULL
        UNION
        SELECT user_id FROM sequences WHERE project_id IS NULL
        UNION
        SELECT user_id FROM programs WHERE project_id IS NULL
      )
    `)
    .all() as Array<{ user_id: string }>;
  for (const row of rows) {
    migrateUserToProject(row.user_id);
  }
}

runProjectMigration();
promoteCentralAdmin();
seedCatalogs();

export default db;
