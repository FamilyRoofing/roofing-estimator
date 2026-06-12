import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("salesperson"), // "admin" | "salesperson"
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ─── Estimates ───────────────────────────────────────────────────────────────
export const estimates = sqliteTable("estimates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),  // FK → users.id (null = legacy/admin-created)
  customerName: text("customer_name").notNull(),
  customerAddress: text("customer_address").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  createdAt: text("created_at").notNull(),
  // Roof sections (up to 3 pitches)
  section1Squares: real("section1_squares"),
  section1Pitch: text("section1_pitch"),
  section2Squares: real("section2_squares"),
  section2Pitch: text("section2_pitch"),
  section3Squares: real("section3_squares"),
  section3Pitch: text("section3_pitch"),
  wastePercent: real("waste_percent").default(15),
  totalSquares: real("total_squares"),
  totalSquaresWithWaste: real("total_squares_with_waste"),
  // Shingle
  shingleType: text("shingle_type"),
  shingleColor: text("shingle_color"),
  shingleQty: real("shingle_qty"),
  shinglePricePerSq: real("shingle_price_per_sq"),
  landmarkProUpcharge: real("landmark_pro_upcharge"),
  // Synthetic Underlayment
  underlaymentQty: real("underlayment_qty"),
  underlaymentPricePerSq: real("underlayment_price_per_sq"),
  // Starter Strip
  starterQty: real("starter_qty"),
  starterPricePerUnit: real("starter_price_per_unit"),
  // Ridge Cap (hip & ridge removed)
  ridgeCapQty: real("ridge_cap_qty"),
  ridgeCapPricePerUnit: real("ridge_cap_price_per_unit"),
  // Ice & Water Shield
  iceWaterQty: real("ice_water_qty"),
  iceWaterPricePerUnit: real("ice_water_price_per_unit"),
  // Drip Edge
  dripEdgeQty: real("drip_edge_qty"),
  dripEdgeColor: text("drip_edge_color"),
  dripEdgePricePerUnit: real("drip_edge_price_per_unit"),
  // Aluminum Step Flashing
  stepFlashingQty: real("step_flashing_qty"),
  stepFlashingPricePerUnit: real("step_flashing_price_per_unit"),
  // Trim Coil
  trimCoilQty: real("trim_coil_qty"),
  trimCoilPricePerUnit: real("trim_coil_price_per_unit"),
  // Pipe Boots
  pipeBootsQty: real("pipe_boots_qty"),
  pipeBootsPricePerUnit: real("pipe_boots_price_per_unit"),
  // Bay Windows / Dormers
  bayWindowsQty: real("bay_windows_qty"),
  bayWindowsPricePerUnit: real("bay_windows_price_per_unit"),
  // Skylights — stored as JSON array of skylight line items
  skylightsJson: text("skylights_json"),
  // Ventilation
  ventilationQty: real("ventilation_qty"),
  ventilationPricePerUnit: real("ventilation_price_per_unit"),
  // Decking
  deckingQty: real("decking_qty"),
  deckingPricePerUnit: real("decking_price_per_unit"),
  // Labor
  laborQty: real("labor_qty"),
  laborPricePerUnit: real("labor_price_per_unit"),
  // Referral
  referralFee: real("referral_fee"),
  referralName: text("referral_name"),
  // Miscellaneous hidden
  miscAmount: real("misc_amount").default(220),
  // Totals
  subtotal: real("subtotal"),
  totalWithMisc: real("total_with_misc"),
  notes: text("notes"),
  status: text("status").default("draft"),
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true });
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

// Skylight line item type (stored as JSON in skylightsJson)
export interface SkylightItem {
  id: string;
  model: string;       // e.g. "FS C06"
  size: string;        // e.g. "21\" x 46\""
  type: "deck" | "curb" | "custom";
  qty: number;
  materialPrice: number;  // Velux unit price
  installPrice: number;   // always $75
  flashingPrice: number;  // $140 for deck, $0 for curb/custom
  totalPerUnit: number;   // material + install + flashing
  lineTotal: number;      // totalPerUnit * qty
}
