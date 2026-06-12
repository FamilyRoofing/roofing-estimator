import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertEstimateSchema } from "@shared/schema";
import bcrypt from "bcryptjs";

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
}
