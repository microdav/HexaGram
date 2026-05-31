import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import db from "./db";
import { requireAuth, AuthRequest } from "./middleware/jwt";
import { requireAdmin, CENTRAL_ADMIN_LOGIN } from "./middleware/admin";
import {
  AdminResetPasswordSchema,
  AdminUpdateUserSchema,
  CATALOG_SCHEMAS,
  isCatalogKind,
} from "./schemas";

const router = Router();
router.use(requireAuth, requireAdmin);

// ── Utilisateurs ─────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  login: string;
  country: string | null;
  avatar_seed: string;
  created_at: number;
  is_admin: number;
  is_active: number;
}

function parseUser(row: UserRow) {
  return {
    id: row.id,
    login: row.login,
    country: row.country ?? null,
    avatarSeed: row.avatar_seed,
    createdAt: row.created_at,
    isAdmin: !!row.is_admin,
    isActive: !!row.is_active,
    projectCount: (
      db.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?").get(row.id) as { n: number }
    ).n,
  };
}

// GET /api/admin/users
router.get("/users", (_req: AuthRequest, res: Response): void => {
  const rows = db
    .prepare("SELECT * FROM users ORDER BY login ASC")
    .all() as UserRow[];
  res.json(rows.map(parseUser));
});

// POST /api/admin/users/:id/reset-password
router.post("/users/:id/reset-password", (req: AuthRequest, res: Response): void => {
  const parsed = AdminResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Mot de passe invalide (6 caractères minimum)" });
    return;
  }
  const target = db
    .prepare("SELECT id FROM users WHERE id = ?")
    .get(req.params.id) as { id: string } | undefined;
  if (!target) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }
  const hash = bcrypt.hashSync(parsed.data.password, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.params.id);
  res.status(204).send();
});

// PATCH /api/admin/users/:id — droits admin / activation
router.patch("/users/:id", (req: AuthRequest, res: Response): void => {
  const parsed = AdminUpdateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const target = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(req.params.id) as UserRow | undefined;
  if (!target) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  const { isAdmin, isActive } = parsed.data;

  // Garde-fou : l'administrateur central ne peut être ni rétrogradé ni désactivé.
  if (target.login === CENTRAL_ADMIN_LOGIN) {
    if (isAdmin === false || isActive === false) {
      res.status(409).json({
        error: "L'administrateur central « microdav » ne peut être ni rétrogradé ni désactivé",
      });
      return;
    }
  }

  const newIsAdmin = isAdmin !== undefined ? (isAdmin ? 1 : 0) : target.is_admin;
  const newIsActive = isActive !== undefined ? (isActive ? 1 : 0) : target.is_active;
  db.prepare("UPDATE users SET is_admin = ?, is_active = ? WHERE id = ?").run(
    newIsAdmin,
    newIsActive,
    req.params.id
  );
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id) as UserRow;
  res.json(parseUser(row));
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", (req: AuthRequest, res: Response): void => {
  const target = db
    .prepare("SELECT id, login FROM users WHERE id = ?")
    .get(req.params.id) as { id: string; login: string } | undefined;
  if (!target) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }
  if (target.login === CENTRAL_ADMIN_LOGIN) {
    res.status(409).json({ error: "L'administrateur central « microdav » ne peut être supprimé" });
    return;
  }
  if (target.id === req.userId) {
    res.status(409).json({ error: "Vous ne pouvez pas supprimer votre propre compte" });
    return;
  }
  // ON DELETE CASCADE retire projets/profils/séquences/programmes/poses liés.
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.status(204).send();
});

// ── Référentiels matériels ───────────────────────────────────────────────────

interface CatalogRow {
  kind: string;
  entry_id: string;
  data: string;
  builtin: number;
  sort: number;
}

// POST /api/admin/catalogs/:kind — créer une entrée
router.post("/catalogs/:kind", (req: AuthRequest, res: Response): void => {
  const kind = req.params.kind;
  if (!isCatalogKind(kind)) {
    res.status(400).json({ error: "Type de référentiel inconnu" });
    return;
  }
  const parsed = CATALOG_SCHEMAS[kind].safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const entryId = (parsed.data as { id: string }).id;
  const existing = db
    .prepare("SELECT entry_id FROM catalog_entries WHERE kind = ? AND entry_id = ?")
    .get(kind, entryId);
  if (existing) {
    res.status(409).json({ error: `L'identifiant « ${entryId} » existe déjà` });
    return;
  }
  const maxSort = (
    db.prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM catalog_entries WHERE kind = ?").get(kind) as {
      m: number;
    }
  ).m;
  const now = Date.now();
  db.prepare(
    `INSERT INTO catalog_entries (kind, entry_id, data, builtin, sort, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`
  ).run(kind, entryId, JSON.stringify(parsed.data), maxSort + 1, now, now);
  res.status(201).json(parsed.data);
});

// PUT /api/admin/catalogs/:kind/:id — modifier une entrée
router.put("/catalogs/:kind/:id", (req: AuthRequest, res: Response): void => {
  const kind = req.params.kind;
  if (!isCatalogKind(kind)) {
    res.status(400).json({ error: "Type de référentiel inconnu" });
    return;
  }
  const row = db
    .prepare("SELECT * FROM catalog_entries WHERE kind = ? AND entry_id = ?")
    .get(kind, req.params.id) as CatalogRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Entrée introuvable" });
    return;
  }
  const parsed = CATALOG_SCHEMAS[kind].safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const newId = (parsed.data as { id: string }).id;
  // Renommage d'identifiant : vérifier l'absence de conflit.
  if (newId !== req.params.id) {
    const conflict = db
      .prepare("SELECT entry_id FROM catalog_entries WHERE kind = ? AND entry_id = ?")
      .get(kind, newId);
    if (conflict) {
      res.status(409).json({ error: `L'identifiant « ${newId} » existe déjà` });
      return;
    }
  }
  const now = Date.now();
  db.prepare(
    "UPDATE catalog_entries SET entry_id = ?, data = ?, updated_at = ? WHERE kind = ? AND entry_id = ?"
  ).run(newId, JSON.stringify(parsed.data), now, kind, req.params.id);
  res.json(parsed.data);
});

// DELETE /api/admin/catalogs/:kind/:id
router.delete("/catalogs/:kind/:id", (req: AuthRequest, res: Response): void => {
  const kind = req.params.kind;
  if (!isCatalogKind(kind)) {
    res.status(400).json({ error: "Type de référentiel inconnu" });
    return;
  }
  const result = db
    .prepare("DELETE FROM catalog_entries WHERE kind = ? AND entry_id = ?")
    .run(kind, req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Entrée introuvable" });
    return;
  }
  res.status(204).send();
});

export default router;
