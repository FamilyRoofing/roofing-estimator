import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertEstimateSchema } from "@shared/schema";
import bcrypt from "bcryptjs";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { parseGafReport } from "./gafParser";

const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("Only PDF files are accepted"));
    cb(null, true);
  },
});

// ─── Session type augmentation ────────────────────────────────────────────────
declare module "express-session" {
  interface SessionData {
    userId: number;
    role: "admin" | "salesperson";
    displayName: string;
  }
}

// ─── Auth middleware helpers ──────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// Pull the material/labor price fields out of a saved estimate (plus its
// chimneys) so they can be upserted into the shared price_defaults book.
const PRICE_DEFAULT_KEYS = [
  "shinglePricePerSq", "shingleMaterialPricePerSq",
  "underlaymentPricePerSq", "underlaymentMaterialPricePerSq",
  "starterPricePerUnit", "starterMaterialPricePerUnit",
  "ridgeCapPricePerUnit", "ridgeCapMaterialPricePerUnit",
  "iceWaterPricePerUnit", "iceWaterMaterialPricePerUnit",
  "dripEdgePricePerUnit", "dripEdgeMaterialPricePerUnit",
  "stepFlashingPricePerUnit", "stepFlashingMaterialPricePerUnit",
  "trimCoilPricePerUnit", "trimCoilMaterialPricePerUnit",
  "pipeBootsPricePerUnit", "pipeBootsMaterialPricePerUnit",
  "stationaryVentsPricePerUnit", "stationaryVentsMaterialPricePerUnit",
  "powerVentsPricePerUnit", "powerVentsMaterialPricePerUnit",
  "solarVentsPricePerUnit", "solarVentsMaterialPricePerUnit",
  "ventilationPricePerUnit", "ventilationMaterialPricePerUnit",
  "deckingPricePerUnit", "deckingMaterialPricePerUnit",
  "flintlasticPricePerUnit", "flintlasticMaterialPricePerUnit",
  "fourStarWarrantyPricePerUnit", "fourStarWarrantyMaterialPricePerUnit",
  "landmarkProPricePerUnit",
] as const;

function extractPriceDefaults(data: Record<string, unknown>) {
  const out: Record<string, number> = {};
  for (const key of PRICE_DEFAULT_KEYS) {
    if (typeof data[key] === "number") out[key] = data[key] as number;
  }
  if (typeof data.chimneysJson === "string") {
    try {
      const chimneys = JSON.parse(data.chimneysJson) as {
        size: "small" | "average" | "large";
        pricePerUnit: number;
        materialPricePerUnit?: number;
      }[];
      for (const c of chimneys) {
        if (c.size !== "small" && c.size !== "average" && c.size !== "large") continue;
        out[`chimney${c.size[0].toUpperCase()}${c.size.slice(1)}PricePerUnit`] = c.pricePerUnit;
        out[`chimney${c.size[0].toUpperCase()}${c.size.slice(1)}MaterialPricePerUnit`] = c.materialPricePerUnit ?? 0;
      }
    } catch {}
  }
  return out;
}

export function registerRoutes(httpServer: Server, app: Express) {

  // ── Auth ───────────────────────────────────────────────────────────────────

  // POST /api/auth/login
  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    const user = storage.getUserByUsername(username.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: "Invalid username or password" });
    const ok = bcrypt.compareSync(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid username or password" });
    req.session.userId = user.id;
    req.session.role = user.role as "admin" | "salesperson";
    req.session.displayName = user.displayName;
    res.json({ id: user.id, username: user.username, role: user.role, displayName: user.displayName });
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  // GET /api/auth/me
  app.get("/api/auth/me", (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
    const user = storage.getUserById(req.session.userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json({ id: user.id, username: user.username, role: user.role, displayName: user.displayName });
  });

  // ── User management (admin only) ───────────────────────────────────────────

  // GET /api/users
  app.get("/api/users", requireAdmin, (_req, res) => {
    const allUsers = storage.getAllUsers().map(u => ({
      id: u.id, username: u.username, role: u.role, displayName: u.displayName, createdAt: u.createdAt,
    }));
    res.json(allUsers);
  });

  // POST /api/users  — create salesperson
  app.post("/api/users", requireAdmin, (req, res) => {
    const { username, password, displayName, role } = req.body ?? {};
    if (!username || !password || !displayName) {
      return res.status(400).json({ error: "username, password, and displayName are required" });
    }
    const existing = storage.getUserByUsername(username.trim().toLowerCase());
    if (existing) return res.status(409).json({ error: "Username already taken" });
    const passwordHash = bcrypt.hashSync(password, 10);
    const user = storage.createUser({
      username: username.trim().toLowerCase(),
      passwordHash,
      role: role === "admin" ? "admin" : "salesperson",
      displayName: displayName.trim(),
    });
    res.status(201).json({ id: user.id, username: user.username, role: user.role, displayName: user.displayName });
  });

  // DELETE /api/users/:id
  app.delete("/api/users/:id", requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    if (id === req.session.userId) return res.status(400).json({ error: "Cannot delete yourself" });
    storage.deleteUser(id);
    res.json({ success: true });
  });

  // PUT /api/users/:id/password  — admin resets a user's password
  app.put("/api/users/:id/password", requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const { password } = req.body ?? {};
    if (isNaN(id) || !password) return res.status(400).json({ error: "Invalid request" });
    const hash = bcrypt.hashSync(password, 10);
    storage.updateUserPassword(id, hash);
    res.json({ success: true });
  });

  // ── Estimates ──────────────────────────────────────────────────────────────

  // GET all estimates — admin sees all, salesperson sees only theirs
  app.get("/api/estimates", requireAuth, (req, res) => {
    try {
      const all = req.session.role === "admin"
        ? storage.getAllEstimates()
        : storage.getEstimatesByUser(req.session.userId!);
      res.json(all);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch estimates" });
    }
  });

  // GET single estimate
  app.get("/api/estimates/:id", requireAuth, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const est = storage.getEstimate(id);
      if (!est) return res.status(404).json({ error: "Not found" });
      // Salesperson can only see their own
      if (req.session.role !== "admin" && est.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(est);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch estimate" });
    }
  });

  // POST create estimate — auto-attach userId
  app.post("/api/estimates", requireAuth, (req, res) => {
    try {
      const parsed = insertEstimateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const data = { ...parsed.data, userId: req.session.userId! };
      const created = storage.createEstimate(data);
      storage.savePriceDefaults(extractPriceDefaults(data));
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: "Failed to create estimate" });
    }
  });

  // PUT update estimate
  app.put("/api/estimates/:id", requireAuth, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const est = storage.getEstimate(id);
      if (!est) return res.status(404).json({ error: "Not found" });
      if (req.session.role !== "admin" && est.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const parsed = insertEstimateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const updated = storage.updateEstimate(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Not found" });
      storage.savePriceDefaults(extractPriceDefaults(parsed.data));
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: "Failed to update estimate" });
    }
  });

  // DELETE estimate
  app.delete("/api/estimates/:id", requireAuth, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const est = storage.getEstimate(id);
      if (!est) return res.status(404).json({ error: "Not found" });
      if (req.session.role !== "admin" && est.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      storage.deleteEstimate(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete estimate" });
    }
  });

  // ── Price Defaults (shared price book — updated automatically on every
  //    estimate save so new estimates start from the latest numbers) ─────────

  // GET current price defaults
  app.get("/api/price-defaults", requireAuth, (_req, res) => {
    try {
      res.json(storage.getPriceDefaults() ?? {});
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch price defaults" });
    }
  });

  // ── GAF QuickMeasure report import ──────────────────────────────────────────

  // POST upload + parse a GAF QuickMeasure "Full Report" PDF
  app.post("/api/parse-gaf-report", requireAuth, (req, res) => {
    reportUpload.single("report")(req, res, async (uploadErr) => {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message || "Upload failed" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      try {
        const parser = new PDFParse({ data: req.file.buffer });
        const result = await parser.getText();
        await parser.destroy();
        res.json(parseGafReport(result.text));
      } catch (err) {
        console.error("GAF report parse error:", err);
        res.status(500).json({ error: "Failed to read that PDF. Make sure it's a GAF QuickMeasure report." });
      }
    });
  });
}
