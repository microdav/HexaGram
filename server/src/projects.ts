import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "./db";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ImportProjectSchema,
} from "./schemas";
import { requireAuth, AuthRequest } from "./middleware/jwt";

const router = Router();
router.use(requireAuth);

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  hardware: string;
  created_at: number;
  updated_at: number;
}

function parseProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    hardware: JSON.parse(row.hardware),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseProjectSummary(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function countsForProject(projectId: string) {
  const profiles = (db
    .prepare("SELECT COUNT(*) as n FROM robot_profiles WHERE project_id = ?")
    .get(projectId) as { n: number }).n;
  const sequences = (db
    .prepare("SELECT COUNT(*) as n FROM sequences WHERE project_id = ?")
    .get(projectId) as { n: number }).n;
  const programs = (db
    .prepare("SELECT COUNT(*) as n FROM programs WHERE project_id = ?")
    .get(projectId) as { n: number }).n;
  return { profiles, sequences, programs };
}

// GET /api/projects — liste avec compteurs
router.get("/", (req: AuthRequest, res: Response): void => {
  const rows = db
    .prepare(
      "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC"
    )
    .all(req.userId) as ProjectRow[];
  res.json(
    rows.map((r) => ({
      ...parseProjectSummary(r),
      counts: countsForProject(r.id),
    }))
  );
});

// POST /api/projects
router.post("/", (req: AuthRequest, res: Response): void => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { name, description, hardware } = parsed.data;
  const id = uuidv4();
  const now = Date.now();
  const hardwareJson = JSON.stringify(hardware ?? {
    servoTypeId: null,
    servoControllerId: null,
    commandElectronicsId: null,
    customServoTypes: [],
  });
  db.prepare(
    "INSERT INTO projects (id, user_id, name, description, hardware, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, req.userId, name, description ?? null, hardwareJson, now, now);

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
  res.status(201).json(parseProject(row));
});

// GET /api/projects/:id
router.get("/:id", (req: AuthRequest, res: Response): void => {
  const row = db
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as ProjectRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Projet introuvable" });
    return;
  }
  res.json({ ...parseProject(row), counts: countsForProject(row.id) });
});

// PUT /api/projects/:id
router.put("/:id", (req: AuthRequest, res: Response): void => {
  const existing = db
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as ProjectRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Projet introuvable" });
    return;
  }
  const parsed = UpdateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { name, description, hardware } = parsed.data;
  const now = Date.now();
  const newName = name ?? existing.name;
  const newDescription = description !== undefined ? description : existing.description;
  const newHardware = hardware !== undefined
    ? JSON.stringify(hardware)
    : existing.hardware;

  db.prepare(
    "UPDATE projects SET name = ?, description = ?, hardware = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(newName, newDescription, newHardware, now, req.params.id, req.userId);

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as ProjectRow;
  res.json(parseProject(row));
});

// DELETE /api/projects/:id — cascade ON DELETE supprime tous les enfants
router.delete("/:id", (req: AuthRequest, res: Response): void => {
  const result = db
    .prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  if (result.changes === 0) {
    res.status(404).json({ error: "Projet introuvable" });
    return;
  }
  // Cleanup explicite des enfants (la FK n'a pas été déclarée sur les colonnes ajoutées via ALTER)
  db.prepare("DELETE FROM robot_profiles WHERE project_id = ?").run(req.params.id);
  db.prepare("DELETE FROM sequences WHERE project_id = ?").run(req.params.id);
  db.prepare("DELETE FROM programs WHERE project_id = ?").run(req.params.id);
  res.status(204).send();
});

// POST /api/projects/:id/import — copie d'éléments depuis un projet source
router.post("/:id/import", (req: AuthRequest, res: Response): void => {
  const target = db
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as ProjectRow | undefined;
  if (!target) {
    res.status(404).json({ error: "Projet cible introuvable" });
    return;
  }
  const parsed = ImportProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { sourceProjectId, profileIds, sequenceIds, programIds } = parsed.data;
  const source = db
    .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
    .get(sourceProjectId, req.userId);
  if (!source) {
    res.status(404).json({ error: "Projet source introuvable" });
    return;
  }
  if (sourceProjectId === req.params.id) {
    res.status(400).json({ error: "Le projet source et le projet cible doivent être différents" });
    return;
  }

  const now = Date.now();
  const profileIdMap: Record<string, string> = {};
  const sequenceIdMap: Record<string, string> = {};

  // Profils
  for (const pid of profileIds ?? []) {
    const row = db
      .prepare("SELECT * FROM robot_profiles WHERE id = ? AND project_id = ? AND user_id = ?")
      .get(pid, sourceProjectId, req.userId) as Record<string, unknown> | undefined;
    if (!row) continue;
    const newId = uuidv4();
    db.prepare(
      "INSERT INTO robot_profiles (id, user_id, project_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(newId, req.userId, req.params.id, `${row.name} (importé)`, row.data, now, now);
    profileIdMap[pid] = newId;
  }

  // Séquences
  for (const sid of sequenceIds ?? []) {
    const row = db
      .prepare("SELECT * FROM sequences WHERE id = ? AND project_id = ? AND user_id = ?")
      .get(sid, sourceProjectId, req.userId) as Record<string, unknown> | undefined;
    if (!row) continue;
    const newId = uuidv4();
    db.prepare(
      "INSERT INTO sequences (id, user_id, project_id, name, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(newId, req.userId, req.params.id, `${row.name} (importé)`, row.steps, now, now);
    sequenceIdMap[sid] = newId;
  }

  // Programmes (avec remappage des refs)
  for (const pgid of programIds ?? []) {
    const row = db
      .prepare("SELECT * FROM programs WHERE id = ? AND project_id = ? AND user_id = ?")
      .get(pgid, sourceProjectId, req.userId) as Record<string, unknown> | undefined;
    if (!row) continue;
    const newId = uuidv4();
    const data = JSON.parse(row.data as string);
    // Remappe profile_id si on a aussi importé le profil ; sinon laisse tel quel (peut être orphelin)
    const newProfileId = profileIdMap[row.profile_id as string] ?? row.profile_id;
    // Remappe les références aux séquences importées
    if (Array.isArray(data.steps)) {
      for (const step of data.steps) {
        if (step.type === "ref" && sequenceIdMap[step.sequenceId]) {
          step.sequenceId = sequenceIdMap[step.sequenceId];
        }
      }
    }
    db.prepare(
      "INSERT INTO programs (id, user_id, project_id, profile_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      newId,
      req.userId,
      req.params.id,
      newProfileId,
      `${row.name} (importé)`,
      JSON.stringify(data),
      now,
      now
    );
  }

  // Touch le projet cible
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, req.params.id);

  res.json({
    profilesImported: Object.keys(profileIdMap).length,
    sequencesImported: Object.keys(sequenceIdMap).length,
    programsImported: programIds?.length ?? 0,
  });
});

export default router;
