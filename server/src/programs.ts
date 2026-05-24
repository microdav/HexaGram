import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "./db";
import { CreateProgramSchema, UpdateProgramSchema } from "./schemas";
import { requireAuth, AuthRequest } from "./middleware/jwt";

const router = Router();
router.use(requireAuth);

function parseProgram(row: Record<string, unknown>) {
  const data = JSON.parse(row.data as string);
  return {
    id: row.id,
    name: row.name,
    profileId: row.profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    initPose: data.initPose ?? null,
    initPoseName: data.initPoseName ?? "",
    steps: data.steps ?? [],
    loop: data.loop ?? { type: 'none' },
  };
}

// GET /api/programs
router.get("/", (req: AuthRequest, res: Response): void => {
  const rows = db
    .prepare(
      "SELECT id, name, profile_id, created_at, updated_at FROM programs WHERE user_id = ? ORDER BY updated_at DESC"
    )
    .all(req.userId) as Record<string, unknown>[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      profileId: r.profile_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  );
});

// POST /api/programs
router.post("/", (req: AuthRequest, res: Response): void => {
  const parsed = CreateProgramSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { name, profileId, initPose, initPoseName, steps, loop } = parsed.data;
  const id = uuidv4();
  const now = Date.now();
  const data = JSON.stringify({ initPose, initPoseName, steps, loop });
  db.prepare(
    "INSERT INTO programs (id, user_id, profile_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, req.userId, profileId, name, data, now, now);

  const row = db.prepare("SELECT * FROM programs WHERE id = ?").get(id) as Record<string, unknown>;
  res.status(201).json(parseProgram(row));
});

// GET /api/programs/:id
router.get("/:id", (req: AuthRequest, res: Response): void => {
  const row = db
    .prepare("SELECT * FROM programs WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Programme introuvable" });
    return;
  }
  res.json(parseProgram(row));
});

// PUT /api/programs/:id
router.put("/:id", (req: AuthRequest, res: Response): void => {
  const existing = db
    .prepare("SELECT * FROM programs WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: "Programme introuvable" });
    return;
  }
  const parsed = UpdateProgramSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const patch = parsed.data;
  const now = Date.now();
  const newName = patch.name ?? (existing.name as string);
  const newProfileId = patch.profileId ?? (existing.profile_id as string);

  const existingData = JSON.parse(existing.data as string);
  const newData = JSON.stringify({
    initPose: patch.initPose !== undefined ? patch.initPose : existingData.initPose,
    initPoseName: patch.initPoseName ?? existingData.initPoseName,
    steps: patch.steps ?? existingData.steps,
    loop: patch.loop ?? existingData.loop,
  });

  db.prepare(
    "UPDATE programs SET name = ?, profile_id = ?, data = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(newName, newProfileId, newData, now, req.params.id, req.userId);

  const row = db.prepare("SELECT * FROM programs WHERE id = ?").get(req.params.id) as Record<string, unknown>;
  res.json(parseProgram(row));
});

// DELETE /api/programs/:id
router.delete("/:id", (req: AuthRequest, res: Response): void => {
  const result = db
    .prepare("DELETE FROM programs WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  if (result.changes === 0) {
    res.status(404).json({ error: "Programme introuvable" });
    return;
  }
  res.status(204).send();
});

export default router;
