import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { estimates, users, priceDefaults } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { InsertEstimate, Estimate, User, InsertPriceDefaults, PriceDefaults } from "@shared/schema";
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

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS price_defaults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shingle_price_per_sq REAL,
    shingle_material_price_per_sq REAL,
    underlayment_price_per_sq REAL,
    underlayment_material_price_per_sq REAL,
    starter_price_per_unit REAL,
    starter_material_price_per_unit REAL,
    ridge_cap_price_per_unit REAL,
    ridge_cap_material_price_per_unit REAL,
    ice_water_price_per_unit REAL,
    ice_water_material_price_per_unit REAL,
    drip_edge_price_per_unit REAL,
    drip_edge_material_price_per_unit REAL,
    step_flashing_price_per_unit REAL,
    step_flashing_material_price_per_unit REAL,
    trim_coil_price_per_unit REAL,
    trim_coil_material_price_per_unit REAL,
    pipe_boots_price_per_unit REAL,
    pipe_boots_material_price_per_unit REAL,
    stationary_vents_price_per_unit REAL,
    stationary_vents_material_price_per_unit REAL,
    power_vents_price_per_unit REAL,
    power_vents_material_price_per_unit REAL,
    solar_vents_price_per_unit REAL,
    solar_vents_material_price_per_unit REAL,
    ventilation_price_per_unit REAL,
    ventilation_material_price_per_unit REAL,
    decking_price_per_unit REAL,
    decking_material_price_per_unit REAL,
    flintlastic_price_per_unit REAL,
    flintlastic_material_price_per_unit REAL,
    chimney_small_price_per_unit REAL,
    chimney_small_material_price_per_unit REAL,
    chimney_average_price_per_unit REAL,
    chimney_average_material_price_per_unit REAL,
    chimney_large_price_per_unit REAL,
    chimney_large_material_price_per_unit REAL,
    updated_at TEXT
  )
`);

// Migrate: add any columns that may be missing from older databases
const _addCol = (table: string, col: string, type: string) => {
  try { sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch {}
};
_addCol("estimates", "user_id", "INTEGER");
_addCol("estimates", "referral_fee", "REAL");
_addCol("estimates", "referral_name", "TEXT");
_addCol("estimates", "layers_to_remove", "REAL DEFAULT 1");
_addCol("estimates", "layers_qty", "REAL");
_addCol("estimates", "layers_price_per_unit", "REAL");
_addCol("estimates", "stationary_vents_qty", "REAL");
_addCol("estimates", "stationary_vents_price_per_unit", "REAL");
_addCol("estimates", "power_vents_qty", "REAL");
_addCol("estimates", "power_vents_price_per_unit", "REAL");
_addCol("estimates", "solar_vents_qty", "REAL");
_addCol("estimates", "solar_vents_price_per_unit", "REAL");
_addCol("estimates", "chimney_qty", "REAL");
_addCol("estimates", "chimney_size", "TEXT");
_addCol("estimates", "chimney_price_per_unit", "REAL");
_addCol("estimates", "chimneys_json", "TEXT");
_addCol("estimates", "flintlastic_qty", "REAL");
_addCol("estimates", "flintlastic_price_per_unit", "REAL");
_addCol("estimates", "material_tax_rate", "REAL DEFAULT 0");
_addCol("estimates", "shingle_material_price_per_sq", "REAL");
_addCol("estimates", "underlayment_material_price_per_sq", "REAL");
_addCol("estimates", "starter_material_price_per_unit", "REAL");
_addCol("estimates", "ridge_cap_material_price_per_unit", "REAL");
_addCol("estimates", "ice_water_material_price_per_unit", "REAL");
_addCol("estimates", "drip_edge_material_price_per_unit", "REAL");
_addCol("estimates", "step_flashing_material_price_per_unit", "REAL");
_addCol("estimates", "trim_coil_material_price_per_unit", "REAL");
_addCol("estimates", "pipe_boots_material_price_per_unit", "REAL");
_addCol("estimates", "stationary_vents_material_price_per_unit", "REAL");
_addCol("estimates", "power_vents_material_price_per_unit", "REAL");
_addCol("estimates", "solar_vents_material_price_per_unit", "REAL");
_addCol("estimates", "ventilation_material_price_per_unit", "REAL");
_addCol("estimates", "decking_material_price_per_unit", "REAL");
_addCol("estimates", "flintlastic_material_price_per_unit", "REAL");
_addCol("estimates", "construction_type", "TEXT DEFAULT 'reroof'");
_addCol("estimates", "landmark_pro_qty", "REAL");
_addCol("estimates", "four_star_warranty_qty", "REAL");
_addCol("estimates", "four_star_warranty_price_per_unit", "REAL");
_addCol("estimates", "four_star_warranty_material_price_per_unit", "REAL");
_addCol("price_defaults", "four_star_warranty_price_per_unit", "REAL");
_addCol("price_defaults", "four_star_warranty_material_price_per_unit", "REAL");
_addCol("estimates", "landmark_pro_price_per_unit", "REAL");
_addCol("price_defaults", "landmark_pro_price_per_unit", "REAL");
_addCol("estimates", "include_landmark_pro", "INTEGER DEFAULT 0");
_addCol("estimates", "include_four_star_warranty", "INTEGER DEFAULT 0");
_addCol("estimates", "include_drip_edge", "INTEGER DEFAULT 0");

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

  // Price Defaults (shared price book)
  getPriceDefaults(): PriceDefaults | undefined;
  savePriceDefaults(data: Partial<InsertPriceDefaults>): PriceDefaults;
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

  // ── Price Defaults ─────────────────────────────────────────────────────────
  getPriceDefaults(): PriceDefaults | undefined {
    return db.select().from(priceDefaults).where(eq(priceDefaults.id, 1)).get();
  }
  savePriceDefaults(data: Partial<InsertPriceDefaults>): PriceDefaults {
    const existing = this.getPriceDefaults();
    const payload = { ...data, updatedAt: new Date().toISOString() };
    if (existing) {
      return db.update(priceDefaults).set(payload).where(eq(priceDefaults.id, 1)).returning().get();
    }
    return db.insert(priceDefaults).values({ id: 1, ...payload }).returning().get();
  }
}

export const storage = new Storage();
