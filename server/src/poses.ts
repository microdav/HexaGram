import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "./db";
import {
  CreatePoseSchema,
  UpdatePoseSchema,
  ReorderPosesSchema,
} from "./schemas";
import { requireAuth, AuthRequest } from "./middleware/jwt";

const router = Router();
router.use(requireAuth);

function parsePose(row: Record<string, unknown>) {
  return {
    id: row.id,
    projectId: row.project_id,
    profileId: row.profile_id ?? null,
    name: row.name,
    angles: JSON.parse(row.angles as string),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureProjectOwnership(userId: string, projectId: string): boolean {
  const row = db
    .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
    .get(projectId, userId);
  return !!row;
}

function nextPosition(userId: string, projectId: string): number {
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) AS m FROM poses WHERE user_id = ? AND project_id = ?"
    )
    .get(userId, projectId) as { m: number };
  return (row.m ?? -1) + 1;
}

// GET /api/poses?projectId=...
router.get("/", (req: AuthRequest, res: Response): void => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) {
    res.status(400).json({ error: "projectId requis" });
    return;
  }
  if (!ensureProjectOwnership(req.userId!, projectId)) {
    res.status(404).json({ error: "Projet introuvable" });
    return;
  }
  const rows = db
    .prepare(
      "SELECT * FROM poses WHERE user_id = ? AND project_id = ? ORDER BY position ASC, created_at ASC"
    )
    .all(req.userId, projectId) as Record<string, unknown>[];
  res.json(rows.map(parsePose));
});

// POST /api/poses — body : { name, angles, profileId?, position?, projectId }
router.post("/", (req: AuthRequest, res: Response): void => {
  const projectId = req.body?.projectId as string | undefined;
  if (!projectId) {
    res.status(400).json({ error: "projectId requis" });
    return;
  }
  if (!ensureProjectOwnership(req.userId!, projectId)) {
    res.status(404).json({ error: "Projet introuvable" });
    return;
  }
  const parsed = CreatePoseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { name, angles, profileId, position } = parsed.data;
  const id = uuidv4();
  const now = Date.now();
  const pos = position ?? nextPosition(req.userId!, projectId);
  db.prepare(
    "INSERT INTO poses (id, user_id, project_id, profile_id, name, angles, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    req.userId,
    projectId,
    profileId ?? null,
    name,
    JSON.stringify(angles),
    pos,
    now,
    now
  );

  const row = db.prepare("SELECT * FROM poses WHERE id = ?").get(id) as Record<string, unknown>;
  res.status(201).json(parsePose(row));
});

// PUT /api/poses/:id
router.put("/:id", (req: AuthRequest, res: Response): void => {
  const existing = db
    .prepare("SELECT * FROM poses WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: "Pose introuvable" });
    return;
  }
  const parsed = UpdatePoseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { name, angles, position } = parsed.data;
  const now = Date.now();
  const newName = name ?? (existing.name as string);
  const newAngles = angles ? JSON.stringify(angles) : (existing.angles as string);
  const newPosition = position ?? (existing.position as number);
  db.prepare(
    "UPDATE poses SET name = ?, angles = ?, position = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(newName, newAngles, newPosition, now, req.params.id, req.userId);

  const row = db.prepare("SELECT * FROM poses WHERE id = ?").get(req.params.id) as Record<string, unknown>;
  res.json(parsePose(row));
});

// POST /api/poses/reorder?projectId=... — body : { order: [id, id, ...] }
router.post("/reorder", (req: AuthRequest, res: Response): void => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) {
    res.status(400).json({ error: "projectId requis" });
    return;
  }
  if (!ensureProjectOwnership(req.userId!, projectId)) {
    res.status(404).json({ error: "Projet introuvable" });
    return;
  }
  const parsed = ReorderPosesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const now = Date.now();
  const stmt = db.prepare(
    "UPDATE poses SET position = ?, updated_at = ? WHERE id = ? AND user_id = ? AND project_id = ?"
  );
  db.exec("BEGIN");
  try {
    parsed.data.order.forEach((id, idx) =>
      stmt.run(idx, now, id, req.userId, projectId)
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  res.status(204).send();
});

// DELETE /api/poses/:id
router.delete("/:id", (req: AuthRequest, res: Response): void => {
  const result = db
    .prepare("DELETE FROM poses WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  if (result.changes === 0) {
    res.status(404).json({ error: "Pose introuvable" });
    return;
  }
  res.status(204).send();
});

export default router;
