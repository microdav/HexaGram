import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "./db";
import {
  CreatePoseSchema,
  UpdatePoseSchema,
  ReorderPosesSchema,
  PropagatePoseSchema,
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
    thumbnail: (row.thumbnail as string | null) ?? null,
    thumbnailContext: (row.thumbnail_context as string | null) ?? null,
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

/** Retourne le project_id de la pose si elle appartient au user, sinon null. */
function poseProjectId(userId: string, poseId: string): string | null {
  const row = db
    .prepare("SELECT project_id FROM poses WHERE id = ? AND user_id = ?")
    .get(poseId, userId) as { project_id: string } | undefined;
  return row ? row.project_id : null;
}

interface StoredStep {
  sourcePoseId?: string | null;
  pose?: number[];
  [k: string]: unknown;
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
  const { name, angles, profileId, position, thumbnail, thumbnailContext } = parsed.data;
  const id = uuidv4();
  const now = Date.now();
  const pos = position ?? nextPosition(req.userId!, projectId);
  db.prepare(
    "INSERT INTO poses (id, user_id, project_id, profile_id, name, angles, position, thumbnail, thumbnail_context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    req.userId,
    projectId,
    profileId ?? null,
    name,
    JSON.stringify(angles),
    pos,
    thumbnail ?? null,
    thumbnailContext ?? null,
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
  const { name, angles, position, thumbnail, thumbnailContext } = parsed.data;
  const now = Date.now();
  const newName = name ?? (existing.name as string);
  // Si les angles changent, la vignette est invalidée tant qu'une nouvelle n'est
  // pas fournie (sinon elle correspondrait à une pose obsolète).
  const anglesChanged = angles !== undefined;
  const newAngles = anglesChanged ? JSON.stringify(angles) : (existing.angles as string);
  const newPosition = position ?? (existing.position as number);
  const newThumb = thumbnail !== undefined
    ? thumbnail
    : anglesChanged
      ? null
      : (existing.thumbnail as string | null);
  const newThumbCtx = thumbnailContext !== undefined
    ? thumbnailContext
    : anglesChanged
      ? null
      : (existing.thumbnail_context as string | null);
  db.prepare(
    "UPDATE poses SET name = ?, angles = ?, position = ?, thumbnail = ?, thumbnail_context = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(newName, newAngles, newPosition, newThumb, newThumbCtx, now, req.params.id, req.userId);

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

// GET /api/poses/:id/usage — séquences du projet dont des steps réfèrent la pose
router.get("/:id/usage", (req: AuthRequest, res: Response): void => {
  const poseId = req.params.id;
  const projectId = poseProjectId(req.userId!, poseId);
  if (!projectId) {
    res.status(404).json({ error: "Pose introuvable" });
    return;
  }
  const like = `%"sourcePoseId":"${poseId}"%`;
  const rows = db
    .prepare(
      "SELECT id, name, steps FROM sequences WHERE user_id = ? AND project_id = ? AND steps LIKE ?"
    )
    .all(req.userId, projectId, like) as Record<string, unknown>[];
  const sequences: { id: string; name: string; stepCount: number }[] = [];
  for (const r of rows) {
    let steps: StoredStep[];
    try {
      steps = JSON.parse(r.steps as string);
    } catch {
      continue;
    }
    const stepCount = steps.filter((s) => s.sourcePoseId === poseId).length;
    if (stepCount > 0) {
      sequences.push({ id: r.id as string, name: r.name as string, stepCount });
    }
  }
  const total = sequences.reduce((acc, s) => acc + s.stepCount, 0);
  res.json({ total, sequences });
});

// POST /api/poses/:id/propagate — body : { angles }
// Met à jour les angles de la pose ET la pose de tous les steps liés (toutes
// séquences du projet), dans une transaction. Invalide les vignettes concernées.
router.post("/:id/propagate", (req: AuthRequest, res: Response): void => {
  const poseId = req.params.id;
  const projectId = poseProjectId(req.userId!, poseId);
  if (!projectId) {
    res.status(404).json({ error: "Pose introuvable" });
    return;
  }
  const parsed = PropagatePoseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { angles } = parsed.data;
  const now = Date.now();
  const like = `%"sourcePoseId":"${poseId}"%`;
  const seqRows = db
    .prepare(
      "SELECT id, steps FROM sequences WHERE user_id = ? AND project_id = ? AND steps LIKE ?"
    )
    .all(req.userId, projectId, like) as Record<string, unknown>[];

  const sequencesUpdated: string[] = [];
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE poses SET angles = ?, thumbnail = NULL, thumbnail_context = NULL, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(JSON.stringify(angles), now, poseId, req.userId);

    const updStmt = db.prepare(
      "UPDATE sequences SET steps = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    );
    for (const r of seqRows) {
      let steps: StoredStep[];
      try {
        steps = JSON.parse(r.steps as string);
      } catch {
        continue;
      }
      let changed = false;
      const newSteps = steps.map((s) => {
        if (s.sourcePoseId !== poseId) return s;
        changed = true;
        return { ...s, pose: angles, thumbnail: null, thumbnailContext: null };
      });
      if (changed) {
        updStmt.run(JSON.stringify(newSteps), now, r.id, req.userId);
        sequencesUpdated.push(r.id as string);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const row = db.prepare("SELECT * FROM poses WHERE id = ?").get(poseId) as Record<string, unknown>;
  res.json({ pose: parsePose(row), sequencesUpdated });
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
