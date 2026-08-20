import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertEstimateSchema } from "@shared/schema";
import { BRAND_PRICE_FIELDS, SHINGLE_BRANDS } from "@shared/shingleBrands";
import type { ShingleBrand } from "@shared/shingleBrands";
import bcrypt from "bcryptjs";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { parseGafReport } from "./gafParser";
import { parseRoofrReport } from "./roofrParser";
import { parseEagleviewReport } from "./eagleviewParser";
import { detectReportSource } from "./reportDetector";

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
    companyId: number;
    role: "admin" | "salesperson";
    displayName: string;
  }
}

// ─── Auth middleware helpers ──────────────────────────────────────────────────
// A session from before the multi-tenancy migration has userId/role but no
// companyId — without this check it sails past auth and only fails deep
// inside a route's `est.companyId !== req.session.companyId` comparison,
// surfacing as a confusing generic error instead of a clean re-login prompt.
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId || !req.session?.companyId) return res.status(401).json({ error: "Not authenticated" });
  next();
}
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId || !req.session?.companyId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// Pull the material/labor price fields out of a saved estimate (plus its
// chimneys) so they can be upserted into the shared price_defaults book.
const PRICE_DEFAULT_KEYS = [
  "underlaymentPricePerSq", "underlaymentMaterialPricePerSq",
  "starterPricePerUnit", "starterMaterialPricePerUnit",
  "ridgeCapPricePerUnit", "ridgeCapMaterialPricePerUnit",
  "iceWaterPricePerUnit", "iceWaterMaterialPricePerUnit",
  "rakesPricePerUnit", "rakesMaterialPricePerUnit",
  "eavesPricePerUnit", "eavesMaterialPricePerUnit",
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
  "coilNailsPricePerUnit", "feltNailsPricePerUnit", "caulkPricePerUnit", "paintPricePerUnit",
  "deliveryFeePricePerUnit", "gafReportPricePerUnit", "roofrReportPricePerUnit",
  "eagleviewReportPricePerUnit", "cityFeeAmount",
] as const;

// People naturally type a company's display name ("Family Roofing"), not its
// URL-safe slug ("family-roofing") — fold whitespace/underscores to hyphens
// so the login field forgives that instead of demanding an exact slug match.
function normalizeCompanySlug(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function extractPriceDefaults(data: Record<string, unknown>) {
  const out: Record<string, number> = {};
  for (const key of PRICE_DEFAULT_KEYS) {
    if (typeof data[key] === "number") out[key] = data[key] as number;
  }
  const brandKey = typeof data.brand === "string" ? data.brand : "certainteed";
  const brand: ShingleBrand = brandKey in BRAND_PRICE_FIELDS ? (brandKey as ShingleBrand) : "certainteed";
  const fields = BRAND_PRICE_FIELDS[brand];
  if (typeof data.shinglePricePerSq === "number") {
    out[fields.labor] = data.shinglePricePerSq;
    // Also keep the legacy generic field current for CertainTeed, since it
    // doubles as the pre-multi-brand fallback (see priceForBrand on the
    // Estimator page).
    if (brand === "certainteed") out.shinglePricePerSq = data.shinglePricePerSq;
  }
  if (typeof data.shingleMaterialPricePerSq === "number") {
    out[fields.material] = data.shingleMaterialPricePerSq;
    if (brand === "certainteed") out.shingleMaterialPricePerSq = data.shingleMaterialPricePerSq;
  }
  if (typeof data.landmarkProPricePerUnit === "number") {
    out[fields.premium] = data.landmarkProPricePerUnit;
    if (brand === "certainteed") out.landmarkProPricePerUnit = data.landmarkProPricePerUnit;
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
    const { company, username, password } = req.body ?? {};
    if (!company || !username || !password) {
      return res.status(400).json({ error: "Company, username, and password are required" });
    }
    const companyRow = storage.getCompanyBySlug(normalizeCompanySlug(String(company)));
    if (!companyRow) return res.status(401).json({ error: "Invalid company, username, or password" });
    const user = storage.getUserByUsernameInCompany(companyRow.id, username.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: "Invalid company, username, or password" });
    const ok = bcrypt.compareSync(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid company, username, or password" });
    req.session.userId = user.id;
    req.session.companyId = user.companyId;
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
    // Defensive check against a stale/tampered session — the user's actual
    // company must still match what the session claims.
    if (!user || user.companyId !== req.session.companyId) return res.status(401).json({ error: "User not found" });
    res.json({ id: user.id, username: user.username, role: user.role, displayName: user.displayName });
  });

  // ── User management (admin only) ───────────────────────────────────────────

  // GET /api/users
  app.get("/api/users", requireAdmin, (req, res) => {
    const allUsers = storage.getUsersByCompany(req.session.companyId!).map(u => ({
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
    const existing = storage.getUserByUsernameInCompany(req.session.companyId!, username.trim().toLowerCase());
    if (existing) return res.status(409).json({ error: "Username already taken" });
    const passwordHash = bcrypt.hashSync(password, 10);
    const user = storage.createUser({
      companyId: req.session.companyId!,
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
    const target = storage.getUserById(id);
    if (!target || target.companyId !== req.session.companyId) return res.status(404).json({ error: "Not found" });
    storage.deleteUser(id);
    res.json({ success: true });
  });

  // PUT /api/users/:id/password  — admin resets a user's password
  app.put("/api/users/:id/password", requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const { password } = req.body ?? {};
    if (isNaN(id) || !password) return res.status(400).json({ error: "Invalid request" });
    const target = storage.getUserById(id);
    if (!target || target.companyId !== req.session.companyId) return res.status(404).json({ error: "Not found" });
    const hash = bcrypt.hashSync(password, 10);
    storage.updateUserPassword(id, hash);
    res.json({ success: true });
  });

  // ── Estimates ──────────────────────────────────────────────────────────────

  // GET all estimates — admin sees all in their company, salesperson sees only theirs
  app.get("/api/estimates", requireAuth, (req, res) => {
    try {
      const all = req.session.role === "admin"
        ? storage.getEstimatesByCompany(req.session.companyId!)
        : storage.getEstimatesByUserInCompany(req.session.userId!, req.session.companyId!);
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
      // A different company's estimate ID should look identical to a
      // nonexistent one — never confirm it exists via a 403 instead of 404.
      if (!est || est.companyId !== req.session.companyId) return res.status(404).json({ error: "Not found" });
      // Salesperson can only see their own
      if (req.session.role !== "admin" && est.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(est);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch estimate" });
    }
  });

  // POST create estimate — auto-attach userId and companyId
  app.post("/api/estimates", requireAuth, (req, res) => {
    try {
      const parsed = insertEstimateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const data = { ...parsed.data, userId: req.session.userId!, companyId: req.session.companyId! };
      const created = storage.createEstimate(data);
      storage.savePriceDefaultsForCompany(req.session.companyId!, extractPriceDefaults(data));
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
      if (!est || est.companyId !== req.session.companyId) return res.status(404).json({ error: "Not found" });
      if (req.session.role !== "admin" && est.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const parsed = insertEstimateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const updated = storage.updateEstimate(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Not found" });
      storage.savePriceDefaultsForCompany(req.session.companyId!, extractPriceDefaults(parsed.data));
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
      if (!est || est.companyId !== req.session.companyId) return res.status(404).json({ error: "Not found" });
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
  app.get("/api/price-defaults", requireAuth, (req, res) => {
    try {
      res.json(storage.getPriceDefaultsForCompany(req.session.companyId!) ?? {});
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch price defaults" });
    }
  });

  // PUT shingle brand pricing — admin-only settings page for the per-brand
  // base (material+labor) and premium rates every estimate's Brand selector
  // pulls from. Scoped to just the known brand price fields (not a general
  // price_defaults editor) so it can't be used to write arbitrary columns.
  const SHINGLE_PRICE_FIELD_NAMES = new Set(
    SHINGLE_BRANDS.flatMap(b => Object.values(BRAND_PRICE_FIELDS[b.value]))
  );
  app.put("/api/price-defaults/shingle-brands", requireAdmin, (req, res) => {
    try {
      const body = req.body ?? {};
      const update: Record<string, number> = {};
      for (const key of Array.from(SHINGLE_PRICE_FIELD_NAMES)) {
        if (typeof body[key] === "number" && !isNaN(body[key])) update[key] = body[key];
      }
      const saved = storage.savePriceDefaultsForCompany(req.session.companyId!, update);
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: "Failed to save shingle brand pricing" });
    }
  });

  // ── Measurement report import (GAF, Roofr, EagleView) ───────────────────────

  // POST upload + parse a roof measurement report PDF. Auto-detects which
  // of the supported providers produced it and dispatches accordingly.
  app.post("/api/parse-report", requireAuth, (req, res) => {
    reportUpload.single("report")(req, res, async (uploadErr) => {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message || "Upload failed" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      try {
        const parser = new PDFParse({ data: req.file.buffer });
        const result = await parser.getText();
        await parser.destroy();
        const source = detectReportSource(result.text);
        if (source === "gaf") return res.json(parseGafReport(result.text));
        if (source === "roofr") return res.json(parseRoofrReport(result.text));
        if (source === "eagleview") return res.json(parseEagleviewReport(result.text));
        res.status(400).json({ error: "Couldn't identify this report format. Supported: GAF QuickMeasure, Roofr, EagleView." });
      } catch (err) {
        console.error("Report parse error:", err);
        res.status(500).json({ error: "Failed to read that PDF." });
      }
    });
  });
}
