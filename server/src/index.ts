import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import authRouter from "./auth";
import profilesRouter from "./profiles";
import sequencesRouter from "./sequences";
import programsRouter from "./programs";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

// Fallback dev secret — en prod, HEXAGRAM_JWT_SECRET doit être défini dans .env
if (!process.env.HEXAGRAM_JWT_SECRET) {
  process.env.HEXAGRAM_JWT_SECRET = "hexagram-dev-secret-change-in-prod";
  console.warn("[hexagram-api] HEXAGRAM_JWT_SECRET absent — secret de dev utilisé");
}

app.use(
  cors({
    origin: process.env.NODE_ENV === "production" ? false : "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/sequences", sequencesRouter);
app.use("/api/programs", programsRouter);

// Gestionnaire d'erreur JSON global — retourne toujours du JSON
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? "Erreur interne" });
});

app.listen(PORT, () => {
  console.log(`[hexagram-api] Écoute sur http://localhost:${PORT}`);
});
