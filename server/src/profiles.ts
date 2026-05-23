import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "./db";
import { CreateProfileSchema, UpdateProfileSchema } from "./schemas";
import { requireAuth, AuthRequest } from "./middleware/jwt";

const router = Router();
router.use(requireAuth);

function parseProfile(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    data: JSON.parse(row.data as string),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/profiles  — liste (sans data)
router.get("/", (req: AuthRequest, res: Response): void => {
  const rows = db
    .prepare(
      "SELECT id, name, created_at, updated_at FROM robot_profiles WHERE user_id = ? ORDER BY updated_at DESC"
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

// POST /api/profiles
router.post("/", (req: AuthRequest, res: Response): void => {
  const parsed = CreateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { name, data } = parsed.data;
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    "INSERT INTO robot_profiles (id, user_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, req.userId, name, JSON.stringify(data), now, now);

  const row = db.prepare("SELECT * FROM robot_profiles WHERE id = ?").get(id) as Record<string, unknown>;
  res.status(201).json(parseProfile(row));
});

// GET /api/profiles/:id
router.get("/:id", (req: AuthRequest, res: Response): void => {
  const row = db
    .prepare("SELECT * FROM robot_profiles WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }
  res.json(parseProfile(row));
});

// PUT /api/profiles/:id
router.put("/:id", (req: AuthRequest, res: Response): void => {
  const existing = db
    .prepare("SELECT * FROM robot_profiles WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { name, data } = parsed.data;
  const now = Date.now();
  const newName = name ?? (existing.name as string);
  const newData = data ? JSON.stringify(data) : (existing.data as string);
  db.prepare(
    "UPDATE robot_profiles SET name = ?, data = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).run(newName, newData, now, req.params.id, req.userId);

  const row = db.prepare("SELECT * FROM robot_profiles WHERE id = ?").get(req.params.id) as Record<string, unknown>;
  res.json(parseProfile(row));
});

// DELETE /api/profiles/:id
router.delete("/:id", (req: AuthRequest, res: Response): void => {
  const result = db
    .prepare("DELETE FROM robot_profiles WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  if (result.changes === 0) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }
  res.status(204).send();
});

export default router;
