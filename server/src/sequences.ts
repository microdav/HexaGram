import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "./db";
import { CreateSequenceSchema, UpdateSequenceSchema } from "./schemas";
import { requireAuth, AuthRequest } from "./middleware/jwt";

const router = Router();
router.use(requireAuth);

function parseSequence(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    steps: JSON.parse(row.steps as string),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/sequences
router.get("/", (req: AuthRequest, res: Response): void => {
  const rows = db
    .prepare(
      "SELECT id, name, created_at, updated_at FROM sequences WHERE user_id = ? ORDER BY updated_at DESC"
    )
    .all(req.userId) as Record<string, unknown>[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  );
});

// POST /api/sequences
router.post("/", (req: AuthRequest, res: Response): void => {
  const parsed = CreateSequenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { name, steps } = parsed.data;
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    "INSERT INTO sequences (id, user_id, name, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, req.userId, name, JSON.stringify(steps), now, now);

  const row = db.prepare("SELECT * FROM sequences WHERE id = ?").get(id) as Record<string, unknown>;
  res.status(201).json(parseSequence(row));
});

// GET /api/sequences/:id
router.get("/:id", (req: AuthRequest, res: Response): void => {
  const row = db
    .prepare("SELECT * FROM sequences WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Séquence introuvable" });
    return;
  }
  res.json(parseSequence(row));
});

// PUT /api/sequences/:id
router.put("/:id", (req: AuthRequest, res: Response): void => {
  const existing = db
    .prepare("SELECT * FROM sequences WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: "Séquence introuvable" });
    return;
  }
  const parsed = UpdateSequenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { name, steps } = parsed.data;
  const now = Date.now();
  const newName = name ?? (existing.name as string);
  const newSteps = steps ? JSON.stringify(steps) : (existing.steps as string);
  db.prepare(
    "UPDATE sequences SET name = ?, steps = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(newName, newSteps, now, req.params.id, req.userId);

  const row = db.prepare("SELECT * FROM sequences WHERE id = ?").get(req.params.id) as Record<string, unknown>;
  res.json(parseSequence(row));
});

// DELETE /api/sequences/:id
router.delete("/:id", (req: AuthRequest, res: Response): void => {
  const result = db
    .prepare("DELETE FROM sequences WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  if (result.changes === 0) {
    res.status(404).json({ error: "Séquence introuvable" });
    return;
  }
  res.status(204).send();
});

export default router;
