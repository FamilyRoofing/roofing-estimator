import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Companies ──────────────────────────────────────────────────────────────
// One row per customer company (multi-tenancy). Everything below this point
// is scoped to a companyId so separate companies' data never mixes.
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // used at login to identify the company, e.g. "call-family-roofing"
  createdAt: text("created_at").notNull(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({ id: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// ─── Users ───────────────────────────────────────────────────────────────────
// Username is unique per company, not globally (see server/storage.ts's users
// table rebuild — SQLite can't ALTER a UNIQUE constraint, so this shape is
// enforced by recreating the table, not by a simple ADD COLUMN).
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  username: text("username").notNull(),
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
  companyId: integer("company_id"), // FK → companies.id — added via _addCol, see server/storage.ts
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
  wastePercent: real("waste_percent").default(10),
  totalSquares: real("total_squares"),
  totalSquaresWithWaste: real("total_squares_with_waste"),
  // Material Tax % — applied to every material price below (labor is untaxed)
  materialTaxRate: real("material_tax_rate").default(0),
  // Construction Type — "reroof" | "new_construction". Tear-off surcharge
  // (layersToRemove) only applies to reroofs; new construction has no
  // existing layers to remove.
  constructionType: text("construction_type").default("reroof"),
  // Layers to Remove (tear-off surcharge: $30/SQ per layer above 1)
  layersToRemove: real("layers_to_remove").default(1),
  layersQty: real("layers_qty"),
  layersPricePerUnit: real("layers_price_per_unit"),
  // Shingle — brand determines the auto-filled base/premium product names
  // (see BASE_SHINGLE_BY_BRAND/PREMIUM_SHINGLE_BY_BRAND on the Estimator
  // page); the price fields below hold whatever was actually charged on
  // this specific job, regardless of brand. Each brand's own remembered
  // default rate lives on price_defaults instead (see below).
  brand: text("brand").default("certainteed"), // "certainteed"|"owensCorning"|"gaf"|"atlas"|"iko"|"tamko"
  shingleType: text("shingle_type"),
  shingleColor: text("shingle_color"),
  shingleQty: real("shingle_qty"),
  shinglePricePerSq: real("shingle_price_per_sq"), // labor $/unit
  shingleMaterialPricePerSq: real("shingle_material_price_per_sq"),
  landmarkProUpcharge: real("landmark_pro_upcharge"), // retired — kept for old estimates
  landmarkProQty: real("landmark_pro_qty"), // retired — kept for old estimates
  // Premium shingle upgrade (e.g. Landmark PRO for CertainTeed, Timberline
  // HDZ for GAF) — bottom-of-report add-on: qty is always totalWithWaste,
  // not stored. Only counts toward the total when includeLandmarkPro is
  // true. Column names kept as "landmarkPro*" for backward compatibility —
  // the field represents whichever brand's premium line was actually used.
  includeLandmarkPro: integer("include_landmark_pro", { mode: "boolean" }).default(false),
  landmarkProPricePerUnit: real("landmark_pro_price_per_unit"),
  // Synthetic Underlayment
  underlaymentQty: real("underlayment_qty"),
  underlaymentPricePerSq: real("underlayment_price_per_sq"), // labor $/unit
  underlaymentMaterialPricePerSq: real("underlayment_material_price_per_sq"),
  // Starter Strip
  starterQty: real("starter_qty"),
  starterPricePerUnit: real("starter_price_per_unit"), // labor $/unit
  starterMaterialPricePerUnit: real("starter_material_price_per_unit"),
  // Ridge Cap (hip & ridge removed)
  ridgeCapQty: real("ridge_cap_qty"),
  ridgeCapPricePerUnit: real("ridge_cap_price_per_unit"), // labor $/unit
  ridgeCapMaterialPricePerUnit: real("ridge_cap_material_price_per_unit"),
  // Ice & Water Shield
  iceWaterQty: real("ice_water_qty"),
  iceWaterPricePerUnit: real("ice_water_price_per_unit"), // labor $/unit
  iceWaterMaterialPricePerUnit: real("ice_water_material_price_per_unit"),
  // Drip Edge (retired — split into separate Rakes/Eaves line items below,
  // kept for old estimates only).
  includeDripEdge: integer("include_drip_edge", { mode: "boolean" }).default(false),
  dripEdgeQty: real("drip_edge_qty"),
  dripEdgeColor: text("drip_edge_color"),
  dripEdgePricePerUnit: real("drip_edge_price_per_unit"), // labor $/unit
  dripEdgeMaterialPricePerUnit: real("drip_edge_material_price_per_unit"),
  // Rakes — qty/prices are always tracked (for material planning), but only
  // counts toward the bottom-of-report Add-Ons total when selected.
  includeRakes: integer("include_rakes", { mode: "boolean" }).default(false),
  rakesQty: real("rakes_qty"),
  rakesColor: text("rakes_color"),
  rakesPricePerUnit: real("rakes_price_per_unit"), // labor $/unit
  rakesMaterialPricePerUnit: real("rakes_material_price_per_unit"),
  // Eaves — same treatment as Rakes, tracked separately since a roof can
  // have one without the other (e.g. a hip roof has eaves but no rakes).
  includeEaves: integer("include_eaves", { mode: "boolean" }).default(false),
  eavesQty: real("eaves_qty"),
  eavesColor: text("eaves_color"),
  eavesPricePerUnit: real("eaves_price_per_unit"), // labor $/unit
  eavesMaterialPricePerUnit: real("eaves_material_price_per_unit"),
  // Aluminum Step Flashing
  stepFlashingQty: real("step_flashing_qty"),
  stepFlashingPricePerUnit: real("step_flashing_price_per_unit"), // labor $/unit
  stepFlashingMaterialPricePerUnit: real("step_flashing_material_price_per_unit"),
  // Trim Coil
  trimCoilQty: real("trim_coil_qty"),
  trimCoilPricePerUnit: real("trim_coil_price_per_unit"), // labor $/unit
  trimCoilMaterialPricePerUnit: real("trim_coil_material_price_per_unit"),
  // Pipe Boots
  pipeBootsQty: real("pipe_boots_qty"),
  pipeBootsPricePerUnit: real("pipe_boots_price_per_unit"), // labor $/unit
  pipeBootsMaterialPricePerUnit: real("pipe_boots_material_price_per_unit"),
  // Bay Windows / Dormers (retired — kept for old estimates, no longer editable in the UI)
  bayWindowsQty: real("bay_windows_qty"),
  bayWindowsPricePerUnit: real("bay_windows_price_per_unit"),
  // Chimney (retired single-item fields — kept for old estimates)
  chimneyQty: real("chimney_qty"),
  chimneySize: text("chimney_size"), // "small" | "average" | "large"
  chimneyPricePerUnit: real("chimney_price_per_unit"),
  // Chimneys — stored as JSON array of chimney line items (size determines
  // unit price: small=$200, average=$300, large=$400)
  chimneysJson: text("chimneys_json"),
  // Stationary Vents (750/Turtle Vents)
  stationaryVentsQty: real("stationary_vents_qty"),
  stationaryVentsPricePerUnit: real("stationary_vents_price_per_unit"), // labor $/unit
  stationaryVentsMaterialPricePerUnit: real("stationary_vents_material_price_per_unit"),
  // Power Vents
  powerVentsQty: real("power_vents_qty"),
  powerVentsPricePerUnit: real("power_vents_price_per_unit"), // labor $/unit
  powerVentsMaterialPricePerUnit: real("power_vents_material_price_per_unit"),
  // Solar Vents
  solarVentsQty: real("solar_vents_qty"),
  solarVentsPricePerUnit: real("solar_vents_price_per_unit"), // labor $/unit
  solarVentsMaterialPricePerUnit: real("solar_vents_material_price_per_unit"),
  // Skylights — stored as JSON array of skylight line items
  skylightsJson: text("skylights_json"),
  // Ventilation (Ridge Vent)
  ventilationQty: real("ventilation_qty"),
  ventilationPricePerUnit: real("ventilation_price_per_unit"), // labor $/unit
  ventilationMaterialPricePerUnit: real("ventilation_material_price_per_unit"),
  // Decking
  deckingQty: real("decking_qty"),
  deckingPricePerUnit: real("decking_price_per_unit"), // labor $/unit
  deckingMaterialPricePerUnit: real("decking_material_price_per_unit"),
  // Flintlastic
  flintlasticQty: real("flintlastic_qty"),
  flintlasticPricePerUnit: real("flintlastic_price_per_unit"), // labor $/unit
  flintlasticMaterialPricePerUnit: real("flintlastic_material_price_per_unit"),
  fourStarWarrantyQty: real("four_star_warranty_qty"), // retired — kept for old estimates
  fourStarWarrantyMaterialPricePerUnit: real("four_star_warranty_material_price_per_unit"), // retired — kept for old estimates
  // 4-Star Warranty — bottom-of-report add-on (see Estimator page): qty is
  // always totalSqForPrice (incl. hip/ridge + starter), not stored. Only
  // counts toward the total when includeFourStarWarranty is true.
  includeFourStarWarranty: integer("include_four_star_warranty", { mode: "boolean" }).default(false),
  fourStarWarrantyPricePerUnit: real("four_star_warranty_price_per_unit"),
  // Labor
  laborQty: real("labor_qty"),
  laborPricePerUnit: real("labor_price_per_unit"),
  // Referral
  referralFee: real("referral_fee"),
  referralName: text("referral_name"),
  // Shop Supplies & Fees — admin-only itemized job costs (qty is always
  // formula-derived from other fields, never stored) that replace the old
  // flat misc amount below. Coil nails/felt nails/caulk/paint are taxed
  // material costs; delivery fee and the report cost are untaxed "other".
  coilNailsPricePerUnit: real("coil_nails_price_per_unit"),
  feltNailsPricePerUnit: real("felt_nails_price_per_unit"),
  caulkPricePerUnit: real("caulk_price_per_unit"),
  paintPricePerUnit: real("paint_price_per_unit"),
  deliveryFeePricePerUnit: real("delivery_fee_price_per_unit"),
  // Measurement report cost — which provider's report (if any) was
  // imported into this estimate, and that provider's per-report cost.
  reportSource: text("report_source"), // "gaf" | "roofr" | "eagleview" | null
  gafReportPricePerUnit: real("gaf_report_price_per_unit"),
  roofrReportPricePerUnit: real("roofr_report_price_per_unit"),
  eagleviewReportPricePerUnit: real("eagleview_report_price_per_unit"),
  // City/County — flat fee when the job site is inside city limits. The
  // checkbox itself is visible to Sales (they know the job site); the
  // dollar breakdown is admin-only like the rest of this section.
  isCityJob: integer("is_city_job", { mode: "boolean" }).default(false),
  cityFeeAmount: real("city_fee_amount"),
  // Miscellaneous (retired — replaced by the itemized Shop Supplies & Fees
  // above; kept for old estimates only).
  miscAmount: real("misc_amount").default(0),
  // Totals
  subtotal: real("subtotal"),
  totalWithMisc: real("total_with_misc"),
  notes: text("notes"),
  status: text("status").default("draft"),
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true });
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

// ─── Price Defaults ────────────────────────────────────────────────────────────
// One "price book" row per company (looked up by companyId — see
// server/storage.ts). Every estimate save updates its company's row from
// whatever material/labor prices were used, so future new estimates start
// from the most recently saved numbers instead of the hardcoded ones.
export const priceDefaults = sqliteTable("price_defaults", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id"), // FK → companies.id — one price book per company, see server/storage.ts
  shinglePricePerSq: real("shingle_price_per_sq"), // legacy — CertainTeed fallback only, see certainteedShinglePricePerSq below
  shingleMaterialPricePerSq: real("shingle_material_price_per_sq"), // legacy — CertainTeed fallback only
  // Per-brand shingle pricing — each brand (base line + premium upgrade)
  // remembers its own rate separately, since switching brands on a new job
  // shouldn't carry over another brand's price. CertainTeed additionally
  // falls back to the legacy fields above when unset, to preserve pricing
  // saved before multi-brand support existed.
  certainteedShinglePricePerSq: real("certainteed_shingle_price_per_sq"),
  certainteedShingleMaterialPricePerSq: real("certainteed_shingle_material_price_per_sq"),
  certainteedPremiumPricePerUnit: real("certainteed_premium_price_per_unit"),
  owensCorningShinglePricePerSq: real("owens_corning_shingle_price_per_sq"),
  owensCorningShingleMaterialPricePerSq: real("owens_corning_shingle_material_price_per_sq"),
  owensCorningPremiumPricePerUnit: real("owens_corning_premium_price_per_unit"),
  gafShinglePricePerSq: real("gaf_shingle_price_per_sq"),
  gafShingleMaterialPricePerSq: real("gaf_shingle_material_price_per_sq"),
  gafPremiumPricePerUnit: real("gaf_premium_price_per_unit"),
  atlasShinglePricePerSq: real("atlas_shingle_price_per_sq"),
  atlasShingleMaterialPricePerSq: real("atlas_shingle_material_price_per_sq"),
  atlasPremiumPricePerUnit: real("atlas_premium_price_per_unit"),
  ikoShinglePricePerSq: real("iko_shingle_price_per_sq"),
  ikoShingleMaterialPricePerSq: real("iko_shingle_material_price_per_sq"),
  ikoPremiumPricePerUnit: real("iko_premium_price_per_unit"),
  tamkoShinglePricePerSq: real("tamko_shingle_price_per_sq"),
  tamkoShingleMaterialPricePerSq: real("tamko_shingle_material_price_per_sq"),
  tamkoPremiumPricePerUnit: real("tamko_premium_price_per_unit"),
  underlaymentPricePerSq: real("underlayment_price_per_sq"),
  underlaymentMaterialPricePerSq: real("underlayment_material_price_per_sq"),
  starterPricePerUnit: real("starter_price_per_unit"),
  starterMaterialPricePerUnit: real("starter_material_price_per_unit"),
  ridgeCapPricePerUnit: real("ridge_cap_price_per_unit"),
  ridgeCapMaterialPricePerUnit: real("ridge_cap_material_price_per_unit"),
  iceWaterPricePerUnit: real("ice_water_price_per_unit"),
  iceWaterMaterialPricePerUnit: real("ice_water_material_price_per_unit"),
  dripEdgePricePerUnit: real("drip_edge_price_per_unit"), // retired — kept for old estimates
  dripEdgeMaterialPricePerUnit: real("drip_edge_material_price_per_unit"), // retired — kept for old estimates
  rakesPricePerUnit: real("rakes_price_per_unit"),
  rakesMaterialPricePerUnit: real("rakes_material_price_per_unit"),
  eavesPricePerUnit: real("eaves_price_per_unit"),
  eavesMaterialPricePerUnit: real("eaves_material_price_per_unit"),
  stepFlashingPricePerUnit: real("step_flashing_price_per_unit"),
  stepFlashingMaterialPricePerUnit: real("step_flashing_material_price_per_unit"),
  trimCoilPricePerUnit: real("trim_coil_price_per_unit"),
  trimCoilMaterialPricePerUnit: real("trim_coil_material_price_per_unit"),
  pipeBootsPricePerUnit: real("pipe_boots_price_per_unit"),
  pipeBootsMaterialPricePerUnit: real("pipe_boots_material_price_per_unit"),
  stationaryVentsPricePerUnit: real("stationary_vents_price_per_unit"),
  stationaryVentsMaterialPricePerUnit: real("stationary_vents_material_price_per_unit"),
  powerVentsPricePerUnit: real("power_vents_price_per_unit"),
  powerVentsMaterialPricePerUnit: real("power_vents_material_price_per_unit"),
  solarVentsPricePerUnit: real("solar_vents_price_per_unit"),
  solarVentsMaterialPricePerUnit: real("solar_vents_material_price_per_unit"),
  ventilationPricePerUnit: real("ventilation_price_per_unit"), // Ridge Vent
  ventilationMaterialPricePerUnit: real("ventilation_material_price_per_unit"),
  deckingPricePerUnit: real("decking_price_per_unit"),
  deckingMaterialPricePerUnit: real("decking_material_price_per_unit"),
  flintlasticPricePerUnit: real("flintlastic_price_per_unit"),
  flintlasticMaterialPricePerUnit: real("flintlastic_material_price_per_unit"),
  fourStarWarrantyPricePerUnit: real("four_star_warranty_price_per_unit"),
  fourStarWarrantyMaterialPricePerUnit: real("four_star_warranty_material_price_per_unit"), // retired — unused
  landmarkProPricePerUnit: real("landmark_pro_price_per_unit"),
  chimneySmallPricePerUnit: real("chimney_small_price_per_unit"),
  chimneySmallMaterialPricePerUnit: real("chimney_small_material_price_per_unit"),
  chimneyAveragePricePerUnit: real("chimney_average_price_per_unit"),
  chimneyAverageMaterialPricePerUnit: real("chimney_average_material_price_per_unit"),
  chimneyLargePricePerUnit: real("chimney_large_price_per_unit"),
  chimneyLargeMaterialPricePerUnit: real("chimney_large_material_price_per_unit"),
  coilNailsPricePerUnit: real("coil_nails_price_per_unit"),
  feltNailsPricePerUnit: real("felt_nails_price_per_unit"),
  caulkPricePerUnit: real("caulk_price_per_unit"),
  paintPricePerUnit: real("paint_price_per_unit"),
  deliveryFeePricePerUnit: real("delivery_fee_price_per_unit"),
  gafReportPricePerUnit: real("gaf_report_price_per_unit"),
  roofrReportPricePerUnit: real("roofr_report_price_per_unit"),
  eagleviewReportPricePerUnit: real("eagleview_report_price_per_unit"),
  cityFeeAmount: real("city_fee_amount"),
  updatedAt: text("updated_at"),
});

export const insertPriceDefaultsSchema = createInsertSchema(priceDefaults).omit({ id: true });
export type InsertPriceDefaults = z.infer<typeof insertPriceDefaultsSchema>;
export type PriceDefaults = typeof priceDefaults.$inferSelect;

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

// Chimney line item type (stored as JSON in chimneysJson)
export interface ChimneyItem {
  id: string;
  size: "small" | "average" | "large";
  qty: number;
  pricePerUnit: number;          // labor $/unit — derived from size by default: small=$200, average=$300, large=$400
  materialPricePerUnit: number;  // material $/unit (taxed by the estimate's material tax rate)
  lineTotal: number;             // qty * (materialPricePerUnit * (1 + taxRate) + pricePerUnit)
}
