import { Response, NextFunction } from "express";
import db from "../db";
import { AuthRequest } from "./jwt";

export { CENTRAL_ADMIN_LOGIN } from "../db";

/**
 * À chaîner APRÈS `requireAuth` : vérifie que l'utilisateur courant est un
 * administrateur actif. Renvoie 403 sinon.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const row = db
    .prepare("SELECT is_admin, is_active FROM users WHERE id = ?")
    .get(req.userId) as { is_admin: number; is_active: number } | undefined;
  if (!row) {
    res.status(401).json({ error: "Utilisateur introuvable" });
    return;
  }
  if (!row.is_active) {
    res.status(403).json({ error: "Compte désactivé" });
    return;
  }
  if (!row.is_admin) {
    res.status(403).json({ error: "Accès réservé aux administrateurs" });
    return;
  }
  next();
}
