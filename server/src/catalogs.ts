import { Router, Request, Response } from "express";
import db from "./db";
import { CATALOG_KINDS, CatalogKind } from "./catalogs/seedData";

const router = Router();

interface CatalogRow {
  kind: string;
  entry_id: string;
  data: string;
  builtin: number;
  sort: number;
}

function listKind(kind: CatalogKind): unknown[] {
  const rows = db
    .prepare("SELECT * FROM catalog_entries WHERE kind = ? ORDER BY sort ASC, entry_id ASC")
    .all(kind) as CatalogRow[];
  return rows.map((r) => {
    try {
      return JSON.parse(r.data);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// GET /api/catalogs — public (lu au démarrage du client, y compris en mode démo)
router.get("/", (_req: Request, res: Response): void => {
  res.json({
    servoTypes: listKind("servoType"),
    servoControllers: listKind("servoController"),
    commandElectronics: listKind("commandElectronics"),
    peripherals: listKind("peripheral"),
  });
});

export { CATALOG_KINDS };
export default router;
