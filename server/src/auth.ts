import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import db from "./db";
import { SignupSchema, LoginSchema } from "./schemas";
import { requireAuth, AuthRequest } from "./middleware/jwt";

const router = Router();

function makeToken(userId: string): string {
  const secret = process.env.HEXAGRAM_JWT_SECRET!;
  return jwt.sign({ sub: userId }, secret, { expiresIn: "30d" });
}

function safeUser(row: Record<string, unknown>) {
  return {
    id: row.id,
    login: row.login,
    country: row.country ?? null,
    avatarSeed: row.avatar_seed,
    createdAt: row.created_at,
  };
}

// POST /api/auth/signup
router.post("/signup", (req: Request, res: Response): void => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    return;
  }
  const { login, password, country, avatarSeed } = parsed.data;

  const existing = db.prepare("SELECT id FROM users WHERE login = ?").get(login);
  if (existing) {
    res.status(409).json({ error: "Ce login est déjà utilisé" });
    return;
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = Date.now();

  db.prepare(
    "INSERT INTO users (id, login, password_hash, country, avatar_seed, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, login, passwordHash, country ?? null, avatarSeed, now);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown>;
  res.status(201).json({ token: makeToken(id), user: safeUser(user) });
});

// POST /api/auth/login
router.post("/login", (req: Request, res: Response): void => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides" });
    return;
  }
  const { login, password } = parsed.data;

  const row = db.prepare("SELECT * FROM users WHERE login = ?").get(login) as Record<string, unknown> | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash as string)) {
    res.status(401).json({ error: "Login ou mot de passe incorrect" });
    return;
  }

  res.json({ token: makeToken(row.id as string), user: safeUser(row) });
});

// GET /api/auth/me
router.get("/me", requireAuth, (req: AuthRequest, res: Response): void => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }
  res.json({ user: safeUser(row) });
});

export default router;
