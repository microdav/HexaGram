/* eslint-disable @typescript-eslint/no-require-imports */
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

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

export default db;
