import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { estimates, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { InsertEstimate, Estimate, User } from "@shared/schema";
import bcrypt from "bcryptjs";

// Use /data volume on Railway (persistent), fall back to local for dev
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? process.env.RAILWAY_VOLUME_MOUNT_PATH
  : path.resolve(".");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, "data.db");
const sqlite = new Database(DB_PATH);
console.log("[db] using", DB_PATH);
const db = drizzle(sqlite);

// ─── Bootstrap tables (ADD COLUMN if missing, never DROP) ─────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'salesperson',
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    customer_name TEXT NOT NULL,
    customer_address TEXT NOT NULL,
    customer_phone TEXT,
    customer_email TEXT,
    created_at TEXT NOT NULL,
    section1_squares REAL,
    section1_pitch TEXT,
    section2_squares REAL,
    section2_pitch TEXT,
    section3_squares REAL,
    section3_pitch TEXT,
    waste_percent REAL DEFAULT 15,
    total_squares REAL,
    total_squares_with_waste REAL,
    shingle_type TEXT,
    shingle_color TEXT,
    shingle_qty REAL,
    shingle_price_per_sq REAL,
    landmark_pro_upcharge REAL,
    underlayment_qty REAL,
    underlayment_price_per_sq REAL,
    starter_qty REAL,
    starter_price_per_unit REAL,
    ridge_cap_qty REAL,
    ridge_cap_price_per_unit REAL,
    ice_water_qty REAL,
    ice_water_price_per_unit REAL,
    drip_edge_qty REAL,
    drip_edge_color TEXT,
    drip_edge_price_per_unit REAL,
    step_flashing_qty REAL,
    step_flashing_price_per_unit REAL,
    trim_coil_qty REAL,
    trim_coil_price_per_unit REAL,
    pipe_boots_qty REAL,
    pipe_boots_price_per_unit REAL,
    bay_windows_qty REAL,
    bay_windows_price_per_unit REAL,
    skylights_json TEXT,
    ventilation_qty REAL,
    ventilation_price_per_unit REAL,
    decking_qty REAL,
    decking_price_per_unit REAL,
    labor_qty REAL,
    labor_price_per_unit REAL,
    referral_fee REAL,
    referral_name TEXT,
    misc_amount REAL DEFAULT 220,
    subtotal REAL,
    total_with_misc REAL,
    notes TEXT,
    status TEXT DEFAULT 'draft'
  )
`);

// Migrate: add any columns that may be missing from older databases
const _addCol = (col: string, type: string) => {
  try { sqlite.exec(`ALTER TABLE estimates ADD COLUMN ${col} ${type}`); } catch {}
};
_addCol("user_id", "INTEGER");
_addCol("referral_fee", "REAL");
_addCol("referral_name", "TEXT");
_addCol("layers_to_remove", "REAL DEFAULT 1");
_addCol("layers_qty", "REAL");
_addCol("layers_price_per_unit", "REAL");
_addCol("stationary_vents_qty", "REAL");
_addCol("stationary_vents_price_per_unit", "REAL");
_addCol("power_vents_qty", "REAL");
_addCol("power_vents_price_per_unit", "REAL");
_addCol("solar_vents_qty", "REAL");
_addCol("solar_vents_price_per_unit", "REAL");
_addCol("chimney_qty", "REAL");
_addCol("chimney_size", "TEXT");
_addCol("chimney_price_per_unit", "REAL");
_addCol("chimneys_json", "TEXT");

// ─── Seed / secure default admin account ───────────────────────────────────────
// Uses ADMIN_USERNAME / ADMIN_PASSWORD env vars if set. Otherwise generates a
// random password on first boot and logs it once. Also detects installations
// still running the old hardcoded "admin123" password and auto-rotates it.
function generateRandomPassword(): string {
  return crypto.randomBytes(18).toString("base64url");
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const existingAdmin = sqlite
  .prepare("SELECT id, password_hash FROM users WHERE username = ?")
  .get(ADMIN_USERNAME) as { id: number; password_hash: string } | undefined;

if (!existingAdmin) {
  const password = process.env.ADMIN_PASSWORD || generateRandomPassword();
  const hash = bcrypt.hashSync(password, 10);
  sqlite.prepare(
    "INSERT INTO users (username, password_hash, role, display_name, created_at) VALUES (?, ?, 'admin', 'Administrator', ?)"
  ).run(ADMIN_USERNAME, hash, new Date().toISOString());
  if (process.env.ADMIN_PASSWORD) {
    console.log(`[storage] Seeded admin account: username=${ADMIN_USERNAME} (password set from ADMIN_PASSWORD)`);
  } else {
    console.log(`[storage] Seeded admin account: username=${ADMIN_USERNAME} password=${password}`);
    console.log("[storage] Save this password now — it will not be shown again. Set ADMIN_PASSWORD to control it explicitly.");
  }
} else if (bcrypt.compareSync("admin123", existingAdmin.password_hash)) {
  // Existing install still has the old hardcoded password — rotate it now.
  const password = process.env.ADMIN_PASSWORD || generateRandomPassword();
  const hash = bcrypt.hashSync(password, 10);
  sqlite.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, existingAdmin.id);
  if (process.env.ADMIN_PASSWORD) {
    console.log(`[storage] SECURITY: admin account had the default password — rotated to ADMIN_PASSWORD value.`);
  } else {
    console.log(`[storage] SECURITY: admin account had the default password — rotated. New password=${password}`);
    console.log("[storage] Save this password now — it will not be shown again. Set ADMIN_PASSWORD to control it explicitly.");
  }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────
export interface IStorage {
  // Users
  getUserByUsername(username: string): User | undefined;
  getUserById(id: number): User | undefined;
  getAllUsers(): User[];
  createUser(data: { username: string; passwordHash: string; role: string; displayName: string }): User;
  deleteUser(id: number): void;
  updateUserPassword(id: number, passwordHash: string): void;

  // Estimates
  getAllEstimates(): Estimate[];
  getEstimatesByUser(userId: number): Estimate[];
  getEstimate(id: number): Estimate | undefined;
  createEstimate(data: InsertEstimate): Estimate;
  updateEstimate(id: number, data: Partial<InsertEstimate>): Estimate | undefined;
  deleteEstimate(id: number): void;
}

export class Storage implements IStorage {
  // ── Users ──────────────────────────────────────────────────────────────────
  getUserByUsername(username: string): User | undefined {
    return db.select().from(users).where(eq(users.username, username)).get();
  }
  getUserById(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  getAllUsers(): User[] {
    return db.select().from(users).all();
  }
  createUser(data: { username: string; passwordHash: string; role: string; displayName: string }): User {
    return db.insert(users).values({
      username: data.username,
      passwordHash: data.passwordHash,
      role: data.role,
      displayName: data.displayName,
      createdAt: new Date().toISOString(),
    }).returning().get();
  }
  deleteUser(id: number): void {
    db.delete(users).where(eq(users.id, id)).run();
  }
  updateUserPassword(id: number, passwordHash: string): void {
    db.update(users).set({ passwordHash }).where(eq(users.id, id)).run();
  }

  // ── Estimates ──────────────────────────────────────────────────────────────
  getAllEstimates(): Estimate[] {
    return db.select().from(estimates).all();
  }
  getEstimatesByUser(userId: number): Estimate[] {
    return db.select().from(estimates).where(eq(estimates.userId, userId)).all();
  }
  getEstimate(id: number): Estimate | undefined {
    return db.select().from(estimates).where(eq(estimates.id, id)).get();
  }
  createEstimate(data: InsertEstimate): Estimate {
    return db.insert(estimates).values(data).returning().get();
  }
  updateEstimate(id: number, data: Partial<InsertEstimate>): Estimate | undefined {
    return db.update(estimates).set(data).where(eq(estimates.id, id)).returning().get();
  }
  deleteEstimate(id: number): void {
    db.delete(estimates).where(eq(estimates.id, id)).run();
  }
}

export const storage = new Storage();
