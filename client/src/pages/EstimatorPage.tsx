import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronLeft, Save, Eye, EyeOff, Plus, Trash2, Printer, Upload } from "lucide-react";
import type { Estimate, SkylightItem, ChimneyItem, PriceDefaults } from "@shared/schema";
import type { ReportData, BuildingData, ReportSource } from "@shared/reportTypes";
import type { ShingleBrand } from "@shared/shingleBrands";
import { SHINGLE_BRANDS, BASE_SHINGLE_BY_BRAND, PREMIUM_SHINGLE_BY_BRAND } from "@shared/shingleBrands";
import { ALL_VELUX_MODELS, SKYLIGHT_INSTALL_COST, SKYLIGHT_FLASHING_COST } from "@/lib/velux";

// Measurement report import (GAF QuickMeasure, Roofr, EagleView) — matches
// the normalized shape every server/*Parser.ts produces.
const REPORT_SOURCE_LABELS: Record<ReportSource, string> = {
  gaf: "GAF QuickMeasure",
  roofr: "Roofr",
  eagleview: "EagleView",
};
// Applied when a report doesn't provide a suggested waste factor (e.g. Roofr never does).
const DEFAULT_WASTE_PERCENT = 10;

// Summarize a report's measurements into the estimator's applicable fields,
// optionally excluding certain buildings (split out into their own
// estimate instead of being folded into this one). With no buildings data
// (single-structure reports) or nothing excluded, this reduces to the
// report's own aggregate figures.
function summarizeReportBuildings(data: ReportData, excluded: Set<number>): {
  roofAreaSqFt: number | null; pitch: string | null; eavesFt: number | null; rakesFt: number | null;
  leakBarrierFt: number | null; ridgeCapFt: number | null; starterFt: number | null; ridgesFt: number | null;
  valleysFt: number | null; stepFt: number | null;
} {
  if (data.buildings.length === 0 || excluded.size === 0) {
    return {
      roofAreaSqFt: data.roofAreaSqFt, pitch: data.pitch, eavesFt: data.eavesFt, rakesFt: data.rakesFt,
      leakBarrierFt: data.leakBarrierFt, ridgeCapFt: data.ridgeCapFt, starterFt: data.starterFt,
      ridgesFt: data.ridgesFt, valleysFt: data.valleysFt, stepFt: data.stepFt,
    };
  }
  const included = data.buildings.filter((_, i) => !excluded.has(i));
  const sum = (key: keyof BuildingData) => included.reduce((s, b) => s + (Number(b[key]) || 0), 0);
  const largest = included.reduce((a, b) => (b.roofAreaSqFt ?? 0) > (a?.roofAreaSqFt ?? 0) ? b : a, included[0]);
  return {
    roofAreaSqFt: included.length ? sum("roofAreaSqFt") : null,
    pitch: largest?.pitch ?? data.pitch,
    eavesFt: included.length ? sum("eavesFt") : null,
    rakesFt: included.length ? sum("rakesFt") : null,
    leakBarrierFt: included.length ? sum("leakBarrierFt") : null,
    ridgeCapFt: included.length ? sum("ridgeCapFt") : null,
    starterFt: included.length ? sum("starterFt") : null,
    ridgesFt: included.length ? sum("ridgesFt") : null,
    valleysFt: included.length ? sum("valleysFt") : null,
    stepFt: included.length ? sum("stepFt") : null,
  };
}

// ─── Pricing model ────────────────────────────────────────────────────────────
// A     = raw material costs + hidden misc $220
// B     = A × 0.40  (markup)
// E     = A + B     (subtotal before commission)
// Total = E / (1 - commission rate)   → commission is X% of Total
// F     = Total × commission rate

const DEFAULT_MARKUP_RATE = 0.50;
// Kept as a whole percentage (not a 0–1 fraction like DEFAULT_MARKUP_RATE)
// because 0.07 * 100 lands on 7.000000000000001 in floating point — dividing
// this by 100 where a fraction is needed round-trips cleanly, multiplying
// does not.
const DEFAULT_MATERIAL_TAX_PERCENT = 7;
const COMMISSION_OFFICE = 0.10;
const COMMISSION_SELF   = 0.14;

const PITCHES = ["3/12","4/12","5/12","6/12","7/12","8/12","9/12","10/12","11/12","12/12","13/12","14/12"];

// Steep pitch adder: $5/SQ for each increment above 8/12
// e.g. 9/12 → +$5, 10/12 → +$10, 12/12 → +$20, etc.
function pitchAdderPerSq(pitch: string): number {
  const n = parseInt(pitch.split("/")[0], 10);
  return n > 8 ? (n - 8) * 5 : 0;
}
const DRIP_EDGE_COLORS = ["White","Black","Brown","Almond","Mill Finish"];
const DECKING_THICKNESSES = ["7/16\"","15/32\"","19/32\"","23/32\""];
const DECKING_TYPES = ["Plywood","OSB"];

// ─── Shingle brands ───────────────────────────────────────────────────────────
// Picking a brand auto-fills the base shingle's product name and determines
// which product name shows on the premium upgrade line. Each brand also
// remembers its own base/premium $/unit rates separately in the shared price
// book (see priceForBrand below) — switching brands shouldn't carry over
// another brand's pricing. Brand metadata lives in shared/shingleBrands.ts
// (also used by the Shingle Pricing settings page) so the two can't drift.

// Each brand's remembered base ($/SQ material + labor) and premium ($/unit)
// rates from the shared price book. CertainTeed falls back to the old
// generic shingle/landmarkPro fields when its own slot is unset, to
// preserve pricing saved before multi-brand support existed.
function priceForBrand(brand: ShingleBrand, pd: PriceDefaults | undefined) {
  switch (brand) {
    case "certainteed": return {
      shingleLabor: num(pd?.certainteedShinglePricePerSq) || num(pd?.shinglePricePerSq) || D.shingle,
      shingleMaterial: num(pd?.certainteedShingleMaterialPricePerSq) || num(pd?.shingleMaterialPricePerSq),
      premium: num(pd?.certainteedPremiumPricePerUnit) || num(pd?.landmarkProPricePerUnit) || D.premiumShingle,
    };
    case "owensCorning": return {
      shingleLabor: num(pd?.owensCorningShinglePricePerSq) || D.shingle,
      shingleMaterial: num(pd?.owensCorningShingleMaterialPricePerSq),
      premium: num(pd?.owensCorningPremiumPricePerUnit) || D.premiumShingle,
    };
    case "gaf": return {
      shingleLabor: num(pd?.gafShinglePricePerSq) || D.shingle,
      shingleMaterial: num(pd?.gafShingleMaterialPricePerSq),
      premium: num(pd?.gafPremiumPricePerUnit) || D.premiumShingle,
    };
    case "atlas": return {
      shingleLabor: num(pd?.atlasShinglePricePerSq) || D.shingle,
      shingleMaterial: num(pd?.atlasShingleMaterialPricePerSq),
      premium: num(pd?.atlasPremiumPricePerUnit) || D.premiumShingle,
    };
    case "iko": return {
      shingleLabor: num(pd?.ikoShinglePricePerSq) || D.shingle,
      shingleMaterial: num(pd?.ikoShingleMaterialPricePerSq),
      premium: num(pd?.ikoPremiumPricePerUnit) || D.premiumShingle,
    };
    case "tamko": return {
      shingleLabor: num(pd?.tamkoShinglePricePerSq) || D.shingle,
      shingleMaterial: num(pd?.tamkoShingleMaterialPricePerSq),
      premium: num(pd?.tamkoPremiumPricePerUnit) || D.premiumShingle,
    };
  }
}

// ─── Bundle / roll / piece helpers (match spreadsheet ROUNDUP formulas) ──────
// These compute the TOTAL cost for a given quantity, rounding up to whole units.
function roundUp(x: number) { return Math.ceil(x); }

// Round up to the nearest third of a square (whole, .33, or .67) — matches
// how squares are measured/ordered on the roof (1 bundle = 1/3 SQ).
function roundUpToThird(x: number) {
  return Math.round((Math.ceil(x * 3) / 3) * 100) / 100;
}

// Round up to the nearest 10 — synthetic underlayment sells in 10 SQ rolls.
function roundUpToTen(x: number) {
  return Math.ceil(x / 10) * 10;
}

// Hip & Ridge: 25 lf/bundle, bundle cost = 68*1.07+25 — used only as the
// default $/unit price below; admin can edit the price directly per estimate.
const HR_BUNDLE_LF   = 25;
const HR_BUNDLE_COST = 68 * 1.07 + 25;   // $97.76

// Starter Strip: 116 lf/bundle, bundle cost = 58*1.07+25
const ST_BUNDLE_LF   = 116;
const ST_BUNDLE_COST = 58 * 1.07 + 25;   // $87.06

// Synthetic Underlayment: 10 SQ/roll, roll cost = 70*1.07+10
const UL_ROLL_SQ   = 10;
const UL_ROLL_COST = 70 * 1.07 + 10;     // $84.90

// Ice & Water Shield: 66 lf/roll (= 2 SQ), roll cost = 70*1.07+10
const IW_ROLL_LF   = 66;
const IW_ROLL_COST = 70 * 1.07 + 10;     // $84.90

// Drip Edge: 10 lf/piece, piece cost = 10*1.07+10
const DE_PIECE_LF   = 10;
const DE_PIECE_COST = 10 * 1.07 + 10;    // $20.70

// Ridge Vent: 4 lf/piece, piece cost = 9.25*1.07+4
const RV_PIECE_LF   = 4;
const RV_PIECE_COST = 9.25 * 1.07 + 4;   // $13.8975

// Fixed per-unit items (no bundling logic needed)
const D = {
  shingle:      193.56,  // up to 8/12: 70+108*1.07+8
  premiumShingle: 15,    // default $/SQ for a brand's premium upgrade line, until admin sets one
  proUpcharge:  20,
  stepFlashing: 4.82,    // 1.75+1.07+2
  trimCoil:     3.14,    // 2*1.07+1  (note: spreadsheet has 3.14, not 5.21)
  pipeBoot:     12.84,   // 12*1.07
  decking:      40.00,   // 25+15
  coilNails:    48.25,   // per box
  feltNails:    28,      // per bucket
  caulk:        8.36,    // per tube
  paint:        8.41,    // per can
  deliveryFee:  60,      // per order
  cityFee:      100,     // flat, when the job is inside city limits
  gafReport:    20,      // per GAF QuickMeasure report imported
  roofrReport:  18,      // per Roofr report imported
  eagleviewReport: 40,   // per EagleView report imported
};

// Shop Supplies & Fees — replaces the old flat misc amount with itemized,
// always-on job costs (admin-only, hidden from the Sales view). Box/bucket
// counts round up with a small grace period past the nominal per-unit
// coverage, matching how these are actually ordered.
function coilNailBoxes(shingleSquares: number): number {
  return shingleSquares > 0 ? Math.max(1, Math.ceil((shingleSquares - 4) / 16)) : 0;
}
function feltNailBuckets(underlaymentSquares: number): number {
  return underlaymentSquares > 0 ? Math.max(1, Math.ceil((underlaymentSquares - 5) / 24)) : 0;
}
const CAULK_TUBES_PER_CHIMNEY: Record<"small" | "average" | "large", number> = { small: 2, average: 3, large: 4 };

const CONSTRUCTION_TYPES: { value: "reroof" | "new_construction"; label: string }[] = [
  { value: "reroof", label: "Replacement" },
  { value: "new_construction", label: "New Construction" },
];
const CHIMNEY_SIZES: { value: "small" | "average" | "large"; label: string }[] = [
  { value: "small",   label: "Small (up to 24\"x24\")" },
  { value: "average", label: "Average (up to 24\"x48\")" },
  { value: "large",   label: "Large (bigger than 24\"x48\")" },
];
const CHIMNEY_PRICES: Record<"small" | "average" | "large", number> = { small: 200, average: 300, large: 400 };

function fmt(v: number) {
  if (!v || v === 0) return "—";
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function fmtBig(v: number) {
  return "$" + (v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function num(v: string | number | null | undefined) {
  const n = parseFloat(String(v ?? ""));
  return isNaN(n) ? 0 : n;
}
function uid() { return Math.random().toString(36).slice(2, 9); }

function buildSkylightItem(overrides: Partial<SkylightItem> = {}): SkylightItem {
  const model = ALL_VELUX_MODELS[0];
  const materialPrice = overrides.materialPrice ?? model.materialPrice;
  const installPrice = SKYLIGHT_INSTALL_COST;
  const flashingPrice = (overrides.type ?? model.mountType) === "deck" ? SKYLIGHT_FLASHING_COST : 0;
  const qty = overrides.qty ?? 1;
  const totalPerUnit = materialPrice + installPrice + flashingPrice;
  return {
    id: uid(),
    model: model.code,
    size: model.size,
    type: model.mountType,
    qty,
    materialPrice,
    installPrice,
    flashingPrice,
    totalPerUnit,
    lineTotal: totalPerUnit * qty,
    ...overrides,
  };
}

function buildChimneyItem(overrides: Partial<ChimneyItem> = {}): ChimneyItem {
  const size = overrides.size ?? "small";
  const qty = overrides.qty ?? 1;
  const pricePerUnit = overrides.pricePerUnit ?? CHIMNEY_PRICES[size];
  const materialPricePerUnit = overrides.materialPricePerUnit ?? 0;
  // Tax isn't applied here — new items always start with materialPricePerUnit
  // at 0, so tax has no effect until updateChimney recomputes it in-component.
  return {
    id: uid(),
    size,
    qty,
    pricePerUnit,
    materialPricePerUnit,
    lineTotal: materialPricePerUnit * qty + pricePerUnit * qty,
    ...overrides,
  };
}

export default function EstimatorPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = !params.id;

  const { user } = useAuth();
  const canSeeAdminView = user?.role === "admin";
  const [role, setRole] = useState<"admin" | "sales">(canSeeAdminView ? "admin" : "sales");

  // Lead type for commission calculation
  const [leadType, setLeadType] = useState<"office" | "self">("office");
  const commissionRate = leadType === "office" ? COMMISSION_OFFICE : COMMISSION_SELF;

  // Markup rate — editable by admin
  const [markupRateInput, setMarkupRateInput] = useState(String(DEFAULT_MARKUP_RATE * 100));
  const markupRate = Math.max(0, Math.min(100, num(markupRateInput))) / 100;

  // Material Tax % — applied to every material price below (labor is untaxed)
  const [materialTaxRateInput, setMaterialTaxRateInput] = useState(String(DEFAULT_MATERIAL_TAX_PERCENT));
  const materialTaxRate = Math.max(0, num(materialTaxRateInput)) / 100;

  // Customer
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const handlePhoneChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    let formatted = digits;
    if (digits.length >= 7) {
      formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
    } else if (digits.length >= 4) {
      formatted = `(${digits.slice(0,3)}) ${digits.slice(3)}`;
    } else if (digits.length > 0) {
      formatted = `(${digits}`;
    }
    setCustomerPhone(formatted);
  };
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");

  // Roof sections
  const [sections, setSections] = useState([{ squares: "", pitch: "6/12" }]);
  const [wastePercent, setWastePercent] = useState("10");
  const [constructionType, setConstructionType] = useState<"reroof" | "new_construction">("reroof");
  const [layersToRemove, setLayersToRemove] = useState("1");

  const totalRawSq = sections.reduce((s, sec) => s + num(sec.squares), 0);
  const wasteMultiplier = 1 + num(wastePercent) / 100;
  const totalWithWaste = roundUpToThird(totalRawSq * wasteMultiplier);

  const [brand, setBrand] = useState<ShingleBrand>("certainteed");
  // Materials — each item has a Labor $/unit (the historical single price) and
  // a Material $/unit (new; defaults to 0 until broken out from the labor number).
  const [shingleType, setShingleType] = useState("Landmark");
  const [shingleColor, setShingleColor] = useState("");
  const [shingleQty, setShingleQty] = useState("");
  const [shinglePrice, setShinglePrice] = useState(String(D.shingle));
  const [shingleMaterialPrice, setShingleMaterialPrice] = useState("0");

  const [underlaymentQty, setUnderlaymentQty] = useState("");
  const [underlaymentPrice, setUnderlaymentPrice] = useState((UL_ROLL_COST / UL_ROLL_SQ).toFixed(4));
  const [underlaymentMaterialPrice, setUnderlaymentMaterialPrice] = useState("0");

  const [starterQty, setStarterQty] = useState("");
  const [starterPrice, setStarterPrice] = useState((ST_BUNDLE_COST / ST_BUNDLE_LF).toFixed(4));
  const [starterMaterialPrice, setStarterMaterialPrice] = useState("0");

  const [ridgeCapQty, setRidgeCapQty] = useState("");
  const [ridgeCapPrice, setRidgeCapPrice] = useState((HR_BUNDLE_COST / HR_BUNDLE_LF).toFixed(4));
  const [ridgeCapMaterialPrice, setRidgeCapMaterialPrice] = useState("0");

  const [iceWaterQty, setIceWaterQty] = useState("");
  const [iceWaterPrice, setIceWaterPrice] = useState((IW_ROLL_COST / IW_ROLL_LF).toFixed(4));
  const [iceWaterMaterialPrice, setIceWaterMaterialPrice] = useState("0");

  // Rakes and Eaves (formerly a single combined "Drip Edge" line item) —
  // qty/price tracked for the job regardless, but — like Landmark PRO /
  // 4-Star Warranty — only counts toward the bottom-of-report Add-Ons total
  // once explicitly selected. Split into two so a roof can have one without
  // the other (e.g. a hip roof has eaves but no rakes).
  const [rakesQty, setRakesQty] = useState("");
  const [rakesColor, setRakesColor] = useState("White");
  const [rakesPrice, setRakesPrice] = useState((DE_PIECE_COST / DE_PIECE_LF).toFixed(4));
  const [rakesMaterialPrice, setRakesMaterialPrice] = useState("0");
  const [includeRakes, setIncludeRakes] = useState(false);

  const [eavesQty, setEavesQty] = useState("");
  const [eavesColor, setEavesColor] = useState("White");
  const [eavesPrice, setEavesPrice] = useState((DE_PIECE_COST / DE_PIECE_LF).toFixed(4));
  const [eavesMaterialPrice, setEavesMaterialPrice] = useState("0");
  const [includeEaves, setIncludeEaves] = useState(false);

  const [stepFlashingQty, setStepFlashingQty] = useState("");
  const [stepFlashingPrice, setStepFlashingPrice] = useState(String(D.stepFlashing));
  const [stepFlashingMaterialPrice, setStepFlashingMaterialPrice] = useState("0");

  const [trimCoilQty, setTrimCoilQty] = useState("");
  const [trimCoilPrice, setTrimCoilPrice] = useState(String(D.trimCoil));
  const [trimCoilMaterialPrice, setTrimCoilMaterialPrice] = useState("0");

  const [pipeBootsQty, setPipeBootsQty] = useState("");
  const [pipeBootsPrice, setPipeBootsPrice] = useState(String(D.pipeBoot));
  const [pipeBootsMaterialPrice, setPipeBootsMaterialPrice] = useState("0");

  // Chimneys — dynamic array, same pattern as skylights
  const [chimneys, setChimneys] = useState<ChimneyItem[]>([]);

  const [stationaryVentsQty, setStationaryVentsQty] = useState("");
  const [stationaryVentsPrice, setStationaryVentsPrice] = useState("24");
  const [stationaryVentsMaterialPrice, setStationaryVentsMaterialPrice] = useState("0");

  const [powerVentsQty, setPowerVentsQty] = useState("");
  const [powerVentsPrice, setPowerVentsPrice] = useState("200");
  const [powerVentsMaterialPrice, setPowerVentsMaterialPrice] = useState("0");

  const [solarVentsQty, setSolarVentsQty] = useState("");
  const [solarVentsPrice, setSolarVentsPrice] = useState("650");
  const [solarVentsMaterialPrice, setSolarVentsMaterialPrice] = useState("0");

  // Skylights — dynamic array
  const [skylights, setSkylights] = useState<SkylightItem[]>([]);

  const [ridgeVentQty, setRidgeVentQty] = useState("");
  const [ridgeVentPrice, setRidgeVentPrice] = useState((RV_PIECE_COST / RV_PIECE_LF).toFixed(4));
  const [ridgeVentMaterialPrice, setRidgeVentMaterialPrice] = useState("0");

  // Referral fee
  const [referralFee, setReferralFee] = useState<0 | 100 | 200>(0);
  const [referralName, setReferralName] = useState("");

  // Shop Supplies & Fees — admin-only, formula-driven quantities (see
  // coilNailBoxes/feltNailBuckets above); only the $/unit rates are stored.
  const [coilNailsPrice, setCoilNailsPrice] = useState(String(D.coilNails));
  const [feltNailsPrice, setFeltNailsPrice] = useState(String(D.feltNails));
  const [caulkPrice, setCaulkPrice] = useState(String(D.caulk));
  const [paintPrice, setPaintPrice] = useState(String(D.paint));
  const [deliveryFeePrice, setDeliveryFeePrice] = useState(String(D.deliveryFee));
  // Measurement report cost — which provider's report (if any) was
  // imported, and each provider's editable per-report rate.
  const [reportSource, setReportSource] = useState<ReportSource | null>(null);
  const [gafReportPrice, setGafReportPrice] = useState(String(D.gafReport));
  const [roofrReportPrice, setRoofrReportPrice] = useState(String(D.roofrReport));
  const [eagleviewReportPrice, setEagleviewReportPrice] = useState(String(D.eagleviewReport));
  // City/County — flat fee when the job site is inside city limits. The
  // checkbox is visible to Sales (they know the job site); the $ amount
  // itself stays admin-only like the rest of this section.
  const [isCityJob, setIsCityJob] = useState(false);
  const [cityFeeAmount, setCityFeeAmount] = useState(String(D.cityFee));

  const [deckingQty, setDeckingQty] = useState("");
  const [deckingPrice, setDeckingPrice] = useState(String(D.decking));
  const [deckingMaterialPrice, setDeckingMaterialPrice] = useState("0");
  const [deckingThickness, setDeckingThickness] = useState("7/16\"");
  const [deckingType, setDeckingType] = useState("OSB");

  const [flintlasticQty, setFlintlasticQty] = useState("");
  const [flintlasticPrice, setFlintlasticPrice] = useState("301");
  const [flintlasticMaterialPrice, setFlintlasticMaterialPrice] = useState("0");

  // Landmark PRO and 4-Star Warranty — bottom-of-report add-ons, not editable
  // materials-list line items. Quantity is always derived (never entered):
  // Landmark PRO = total shingle SQ incl. waste; 4-Star Warranty = that same
  // figure plus starter & hip/ridge (i.e. totalSqForPrice, below). Rate is
  // editable, but neither counts toward the total unless explicitly selected.
  const [includePremiumShingle, setIncludePremiumShingle] = useState(false);
  const [premiumShinglePrice, setPremiumShinglePrice] = useState(String(D.premiumShingle));
  const [includeFourStarWarranty, setIncludeFourStarWarranty] = useState(false);
  const [fourStarWarrantyPrice, setFourStarWarrantyPrice] = useState("15");

  // Auto-fill underlayment with total sq + waste, rounded up to the nearest
  // 10 SQ since synthetic underlayment sells in 10 SQ rolls.
  useEffect(() => {
    if (totalWithWaste > 0) setUnderlaymentQty(String(roundUpToTen(totalWithWaste)));
  }, [totalWithWaste]);

  // Auto-fill shingle qty with total sq + waste (only if not yet set)
  useEffect(() => {
    if (totalWithWaste > 0) setShingleQty(String(totalWithWaste));
  }, [totalWithWaste]);

  // ─── Raw line totals (bundle/roll ROUNDUP formulas match spreadsheet) ────

  // Steep pitch adder — weighted by section squares (each increment above 8/12 = +$5/SQ)
  const totalSteepAdderPerSq = (() => {
    const totalSq = sections.reduce((s, sec) => s + num(sec.squares), 0);
    if (totalSq <= 0) return 0;
    const weighted = sections.reduce((s, sec) => {
      const sq = num(sec.squares);
      return s + sq * pitchAdderPerSq(sec.pitch);
    }, 0);
    return weighted / totalSq;
  })();
  const steepPitchAdderTotal = num(shingleQty) * totalSteepAdderPerSq;

  // Cost helper: qty × (material $/unit taxed by materialTaxRate + labor $/unit)
  const costOf = (qty: number, materialPrice: number, laborPrice: number) =>
    qty * (materialPrice * (1 + materialTaxRate) + laborPrice);

  // Price per SQ / add-on quantity basis: total shingle SQ incl. waste, plus
  // starter & hip/ridge converted to SQ (3 bundles = 1 SQ). Computed here
  // (rather than down with the rest of the pricing model) since Landmark
  // PRO and 4-Star Warranty below need it too.
  const starterBundles  = roundUp(num(starterQty) / ST_BUNDLE_LF);
  const hipRidgeBundles = roundUp(num(ridgeCapQty) / HR_BUNDLE_LF);
  const accessorySq     = (starterBundles + hipRidgeBundles) / 3;
  const totalSqForPrice = totalWithWaste + accessorySq;

  const shingleTotal      = costOf(num(shingleQty), num(shingleMaterialPrice), num(shinglePrice));
  // Landmark PRO — bottom-of-report add-on: total shingle SQ incl. waste ×
  // its own $/SQ rate (no material/labor split). Only counts toward the
  // total when explicitly selected below.
  const premiumShingleTotal = includePremiumShingle ? costOf(totalWithWaste, 0, num(premiumShinglePrice)) : 0;
  // 4-Star Warranty — same idea, but based on totalSqForPrice (incl. starter
  // & hip/ridge) since that's how the warranty program measures a square.
  const fourStarWarrantyTotal = includeFourStarWarranty ? costOf(totalSqForPrice, 0, num(fourStarWarrantyPrice)) : 0;
  // New construction shingle labor runs $25/SQ cheaper than a replacement
  // (no tear-off staging/cleanup) — the Labor $/unit field above always
  // holds the replacement rate; this discount is applied on top of it.
  const newConstructionDiscountPerSq = constructionType === "new_construction" ? -25 : 0;
  const newConstructionDiscountTotal = num(shingleQty) * newConstructionDiscountPerSq;
  const underlayTotal     = costOf(num(underlaymentQty), num(underlaymentMaterialPrice), num(underlaymentPrice));
  const starterTotal      = costOf(num(starterQty), num(starterMaterialPrice), num(starterPrice));
  const ridgeCapTotal     = costOf(num(ridgeCapQty), num(ridgeCapMaterialPrice), num(ridgeCapPrice));
  const iceWaterTotal     = costOf(num(iceWaterQty), num(iceWaterMaterialPrice), num(iceWaterPrice));
  // Raw cost always reflects what's entered (shown in the materials table
  // below); rakesTotal/eavesTotal — what actually counts toward the price —
  // are gated on includeRakes/includeEaves, same as Landmark PRO / 4-Star
  // Warranty.
  const rakesRawCost      = costOf(num(rakesQty), num(rakesMaterialPrice), num(rakesPrice));
  const rakesTotal        = includeRakes ? rakesRawCost : 0;
  const eavesRawCost      = costOf(num(eavesQty), num(eavesMaterialPrice), num(eavesPrice));
  const eavesTotal        = includeEaves ? eavesRawCost : 0;
  const stepFlashTotal    = costOf(num(stepFlashingQty), num(stepFlashingMaterialPrice), num(stepFlashingPrice));
  const trimCoilTotal     = costOf(num(trimCoilQty), num(trimCoilMaterialPrice), num(trimCoilPrice));
  const pipeBootsTotal    = costOf(num(pipeBootsQty), num(pipeBootsMaterialPrice), num(pipeBootsPrice));
  // Chimneys: computed live from qty/material/labor rather than the stored
  // lineTotal, so an edit to the global Tax % updates existing chimneys too.
  const chimneysTotal     = chimneys.reduce((s, c) => s + costOf(c.qty, c.materialPricePerUnit ?? 0, c.pricePerUnit), 0);
  const stationaryVentsTotal = costOf(num(stationaryVentsQty), num(stationaryVentsMaterialPrice), num(stationaryVentsPrice));
  const powerVentsTotal   = costOf(num(powerVentsQty), num(powerVentsMaterialPrice), num(powerVentsPrice));
  const solarVentsTotal   = costOf(num(solarVentsQty), num(solarVentsMaterialPrice), num(solarVentsPrice));
  const skylightsTotal    = skylights.reduce((s, sk) => s + sk.lineTotal, 0);
  const ridgeVentTotal    = costOf(num(ridgeVentQty), num(ridgeVentMaterialPrice), num(ridgeVentPrice));
  const deckingTotal      = costOf(num(deckingQty), num(deckingMaterialPrice), num(deckingPrice));
  const flintlasticTotal  = costOf(roundUp(num(flintlasticQty)), num(flintlasticMaterialPrice), num(flintlasticPrice));

  // Layers to Remove — tear-off surcharge: $30/SQ for each layer above the first,
  // applied across the total SQ with waste (all roof sections combined).
  // Doesn't apply to new construction — there's nothing to tear off.
  const layersRate  = constructionType === "reroof" ? 30 * Math.max(0, num(layersToRemove) - 1) : 0;
  const layersTotal = totalWithWaste * layersRate;

  // ─── Shop Supplies & Fees (admin-only, formula-driven) ─────────────────────
  const coilNailsQty   = coilNailBoxes(num(shingleQty));
  const coilNailsTotal = costOf(coilNailsQty, num(coilNailsPrice), 0);
  const feltNailsQty   = feltNailBuckets(num(underlaymentQty));
  const feltNailsTotal = costOf(feltNailsQty, num(feltNailsPrice), 0);
  const caulkQty = 2 + chimneys.reduce((s, c) => s + c.qty * CAULK_TUBES_PER_CHIMNEY[c.size], 0);
  const caulkTotal = costOf(caulkQty, num(caulkPrice), 0);
  const paintQty = 2;
  const paintTotal = costOf(paintQty, num(paintPrice), 0);
  const deliveryFeeTotal = num(deliveryFeePrice);
  const reportCostRate =
    reportSource === "gaf" ? num(gafReportPrice) :
    reportSource === "roofr" ? num(roofrReportPrice) :
    reportSource === "eagleview" ? num(eagleviewReportPrice) : 0;
  const reportCostTotal = reportSource ? reportCostRate : 0;
  const cityFeeTotal = isCityJob ? num(cityFeeAmount) : 0;
  const shopSuppliesTotal = coilNailsTotal + feltNailsTotal + caulkTotal + paintTotal + deliveryFeeTotal + reportCostTotal + cityFeeTotal;

  // ─── Markup model ─────────────────────────────────────────────────────────
  const A = shingleTotal + premiumShingleTotal + newConstructionDiscountTotal + steepPitchAdderTotal + underlayTotal + starterTotal +
    ridgeCapTotal + iceWaterTotal + rakesTotal + eavesTotal + stepFlashTotal +
    trimCoilTotal + pipeBootsTotal + chimneysTotal + stationaryVentsTotal + powerVentsTotal + solarVentsTotal + skylightsTotal +
    ridgeVentTotal + deckingTotal + flintlasticTotal + fourStarWarrantyTotal + layersTotal + referralFee + shopSuppliesTotal;
  const B = A * markupRate;
  const E = A + B;
  // Commission is X% of Total Price: Total = E / (1 - rate), F = Total * rate
  const grandTotal = E / (1 - commissionRate);
  const F = grandTotal * commissionRate;
  // Margin = Total Price − material/overhead costs − commission (this app has
  // no separate labor line, so "cost" here is A, the same raw-costs figure
  // shown above). Algebraically this always equals B, the markup dollar
  // amount — shown as its own line since "% of Total Price" is a more useful
  // read than "% of cost" for a margin check.
  const marginDollar = grandTotal - A - F;
  const marginPercent = grandTotal > 0 ? (marginDollar / grandTotal) * 100 : 0;

  // Proportional sales price: distributes markup + commission across raw cost
  // salesPrice(x) = (x / A) * grandTotal — all line prices sum to grandTotal
  function salesPrice(rawCost: number): number {
    if (!A || A <= 0) return 0;
    return (rawCost / A) * grandTotal;
  }
  // Commission earned specifically on a given raw cost, at the same rate as everything else
  function itemCommission(rawCost: number): number {
    return salesPrice(rawCost) * commissionRate;
  }

  // ─── Optional Add-Ons breakout (Rakes, Eaves, Landmark PRO, 4-Star
  // Warranty, Skylights) — kept out of the base roof's per-square price and
  // shown as their own line items at the bottom of the report, each with
  // its own marked-up + commissioned price. Same markup % and commission %
  // as the base roof — just split into two buckets instead of one, so
  // baseTotal + addOnsTotal === grandTotal exactly.
  const addOnsRaw = rakesTotal + eavesTotal + premiumShingleTotal + fourStarWarrantyTotal + skylightsTotal;
  const baseRaw = A - addOnsRaw;
  const baseSubtotal = baseRaw * (1 + markupRate);
  const baseTotal = baseSubtotal / (1 - commissionRate);
  const baseCommission = baseTotal * commissionRate;
  const addOnsSubtotal = addOnsRaw * (1 + markupRate);
  const addOnsTotal = addOnsSubtotal / (1 - commissionRate);
  const addOnsCommission = addOnsTotal * commissionRate;

  // Add-ons aren't part of the base roof — exclude their (marked-up) price
  // from the per-square figure. (totalSqForPrice is computed earlier, above
  // the raw line totals, since Landmark PRO / 4-Star Warranty need it too.)
  const pricePerSq = totalSqForPrice > 0 ? (grandTotal - salesPrice(addOnsRaw)) / totalSqForPrice : 0;

  const isAdmin = role === "admin" && canSeeAdminView;

  // ─── Section helpers ──────────────────────────────────────────────────────
  const addSection = () => { if (sections.length < 3) setSections([...sections, { squares: "", pitch: "6/12" }]); };
  const removeSection = (i: number) => { if (sections.length > 1) setSections(sections.filter((_, idx) => idx !== i)); };
  const updateSection = (i: number, field: "squares" | "pitch", val: string) =>
    setSections(sections.map((s, idx) => idx === i ? { ...s, [field]: val } : s));

  // ─── Measurement report import (GAF, Roofr, EagleView) ────────────────────
  const reportFileInputRef = useRef<HTMLInputElement>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  // Indices into reportData.buildings the user has marked as separate
  // structures (garage, shed, etc.) to be split into their own estimate
  // instead of folded into this one's totals.
  const [splitBuildings, setSplitBuildings] = useState<Set<number>>(new Set());
  const [reportCreatingSeparate, setReportCreatingSeparate] = useState(false);

  const triggerReportImport = () => reportFileInputRef.current?.click();
  const toggleSplitBuilding = (i: number) => setSplitBuildings(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const handleReportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setReportLoading(true);
    try {
      const formData = new FormData();
      formData.append("report", file);
      const res = await fetch("/api/parse-report", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}) as any);
        throw new Error(err.error || "Failed to parse report");
      }
      const data: ReportData = await res.json();
      setReportData(data);
      setSplitBuildings(new Set());
      setReportDialogOpen(true);
    } catch (err: any) {
      toast({ title: "Import failed", description: err?.message || "Could not read that PDF.", variant: "destructive" });
    } finally {
      setReportLoading(false);
    }
  };

  // Build a full new-estimate payload for a single split-out building,
  // mirroring what a brand-new estimate would look like if its report numbers
  // were applied and saved untouched: current price book, the report's
  // suggested waste % (falling back to the 10% default when none is
  // suggested — same rule as the main estimate), default markup, office
  // commission, and default material tax rate.
  const buildSplitEstimatePayload = (b: BuildingData, label: string) => {
    const squares = b.roofAreaSqFt != null ? b.roofAreaSqFt / 100 : 0;
    const pitch = b.pitch && PITCHES.includes(b.pitch) ? b.pitch : "6/12";
    const wasteV = reportData?.suggestedWastePercent ?? DEFAULT_WASTE_PERCENT;
    const sqWithWaste = roundUpToThird(squares * (1 + wasteV / 100));
    const shingleQtyVal = sqWithWaste;
    const underlaymentQtyVal = roundUpToTen(sqWithWaste);
    // Report footage is always rounded up to the next whole foot — see the
    // matching note in applyReportData.
    const rakesVal = Math.ceil(b.rakesFt ?? 0);
    const eavesVal = Math.ceil(b.eavesFt ?? 0);
    const iceWaterVal = Math.ceil((b.stepFt ?? 0) + (b.valleysFt ?? 0));
    const stepFlashingVal = Math.ceil(b.stepFt ?? 0);
    const ridgeCapVal = Math.ceil(b.ridgeCapFt ?? 0);
    const starterVal = Math.ceil(b.starterFt ?? 0);
    const ridgeVentVal = Math.ceil(b.ridgesFt ?? 0);

    const brandPricesV = priceForBrand(brand, priceDefaults);
    const shinglePriceV = brandPricesV.shingleLabor;
    const shingleMatV = brandPricesV.shingleMaterial;
    const underlaymentPriceV = num(priceDefaults?.underlaymentPricePerSq) || (UL_ROLL_COST / UL_ROLL_SQ);
    const underlaymentMatV = num(priceDefaults?.underlaymentMaterialPricePerSq);
    const starterPriceV = num(priceDefaults?.starterPricePerUnit) || (ST_BUNDLE_COST / ST_BUNDLE_LF);
    const starterMatV = num(priceDefaults?.starterMaterialPricePerUnit);
    const ridgeCapPriceV = num(priceDefaults?.ridgeCapPricePerUnit) || (HR_BUNDLE_COST / HR_BUNDLE_LF);
    const ridgeCapMatV = num(priceDefaults?.ridgeCapMaterialPricePerUnit);
    const iceWaterPriceV = num(priceDefaults?.iceWaterPricePerUnit) || (IW_ROLL_COST / IW_ROLL_LF);
    const iceWaterMatV = num(priceDefaults?.iceWaterMaterialPricePerUnit);
    const stepFlashingPriceV = num(priceDefaults?.stepFlashingPricePerUnit) || D.stepFlashing;
    const stepFlashingMatV = num(priceDefaults?.stepFlashingMaterialPricePerUnit);
    const rakesPriceV = num(priceDefaults?.rakesPricePerUnit) || (DE_PIECE_COST / DE_PIECE_LF);
    const rakesMatV = num(priceDefaults?.rakesMaterialPricePerUnit);
    const eavesPriceV = num(priceDefaults?.eavesPricePerUnit) || (DE_PIECE_COST / DE_PIECE_LF);
    const eavesMatV = num(priceDefaults?.eavesMaterialPricePerUnit);
    const ridgeVentPriceV = num(priceDefaults?.ventilationPricePerUnit) || (RV_PIECE_COST / RV_PIECE_LF);
    const ridgeVentMatV = num(priceDefaults?.ventilationMaterialPricePerUnit);

    // Shop Supplies & Fees — same formulas as the main estimate, using
    // price-book defaults. No chimney data exists for a freshly split-out
    // building, so caulk falls back to the flat 2-tube minimum.
    const coilNailsQtyV = coilNailBoxes(shingleQtyVal);
    const coilNailsPriceV = num(priceDefaults?.coilNailsPricePerUnit) || D.coilNails;
    const feltNailsQtyV = feltNailBuckets(underlaymentQtyVal);
    const feltNailsPriceV = num(priceDefaults?.feltNailsPricePerUnit) || D.feltNails;
    const caulkQtyV = 2;
    const caulkPriceV = num(priceDefaults?.caulkPricePerUnit) || D.caulk;
    const paintQtyV = 2;
    const paintPriceV = num(priceDefaults?.paintPricePerUnit) || D.paint;
    const deliveryFeePriceV = num(priceDefaults?.deliveryFeePricePerUnit) || D.deliveryFee;
    const reportSourceV = reportData?.source ?? null;
    const gafReportPriceV = num(priceDefaults?.gafReportPricePerUnit) || D.gafReport;
    const roofrReportPriceV = num(priceDefaults?.roofrReportPricePerUnit) || D.roofrReport;
    const eagleviewReportPriceV = num(priceDefaults?.eagleviewReportPricePerUnit) || D.eagleviewReport;
    const reportCostV =
      reportSourceV === "gaf" ? gafReportPriceV :
      reportSourceV === "roofr" ? roofrReportPriceV :
      reportSourceV === "eagleview" ? eagleviewReportPriceV : 0;

    const cost = (qty: number, mat: number, labor: number) => qty * (mat * (1 + DEFAULT_MATERIAL_TAX_PERCENT / 100) + labor);
    const Av = cost(shingleQtyVal, shingleMatV, shinglePriceV)
      + cost(underlaymentQtyVal, underlaymentMatV, underlaymentPriceV)
      + cost(starterVal, starterMatV, starterPriceV)
      + cost(ridgeCapVal, ridgeCapMatV, ridgeCapPriceV)
      + cost(iceWaterVal, iceWaterMatV, iceWaterPriceV)
      + cost(stepFlashingVal, stepFlashingMatV, stepFlashingPriceV)
      + cost(rakesVal, rakesMatV, rakesPriceV)
      + cost(eavesVal, eavesMatV, eavesPriceV)
      + cost(ridgeVentVal, ridgeVentMatV, ridgeVentPriceV)
      + cost(coilNailsQtyV, coilNailsPriceV, 0)
      + cost(feltNailsQtyV, feltNailsPriceV, 0)
      + cost(caulkQtyV, caulkPriceV, 0)
      + cost(paintQtyV, paintPriceV, 0)
      + deliveryFeePriceV
      + reportCostV;
    const grandTotalV = (Av + Av * DEFAULT_MARKUP_RATE) / (1 - COMMISSION_OFFICE);

    return {
      customerName,
      customerAddress: customerAddress ? `${customerAddress} (${label})` : label,
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      notes: `Imported from ${reportData ? REPORT_SOURCE_LABELS[reportData.source] : "measurement"} report — ${label}.`,
      createdAt: new Date().toISOString(),
      section1Squares: squares || null,
      section1Pitch: pitch,
      wastePercent: wasteV,
      totalSquares: squares,
      totalSquaresWithWaste: sqWithWaste,
      materialTaxRate: DEFAULT_MATERIAL_TAX_PERCENT,
      layersToRemove: 1,
      brand,
      shingleType: BASE_SHINGLE_BY_BRAND[brand],
      shingleQty: shingleQtyVal || null,
      shinglePricePerSq: shinglePriceV,
      shingleMaterialPricePerSq: shingleMatV,
      underlaymentQty: underlaymentQtyVal || null,
      underlaymentPricePerSq: underlaymentPriceV,
      underlaymentMaterialPricePerSq: underlaymentMatV,
      starterQty: starterVal || null,
      starterPricePerUnit: starterPriceV,
      starterMaterialPricePerUnit: starterMatV,
      ridgeCapQty: ridgeCapVal || null,
      ridgeCapPricePerUnit: ridgeCapPriceV,
      ridgeCapMaterialPricePerUnit: ridgeCapMatV,
      iceWaterQty: iceWaterVal || null,
      iceWaterPricePerUnit: iceWaterPriceV,
      iceWaterMaterialPricePerUnit: iceWaterMatV,
      stepFlashingQty: stepFlashingVal || null,
      stepFlashingPricePerUnit: stepFlashingPriceV,
      stepFlashingMaterialPricePerUnit: stepFlashingMatV,
      rakesQty: rakesVal || null,
      rakesColor: "White",
      rakesPricePerUnit: rakesPriceV,
      rakesMaterialPricePerUnit: rakesMatV,
      eavesQty: eavesVal || null,
      eavesColor: "White",
      eavesPricePerUnit: eavesPriceV,
      eavesMaterialPricePerUnit: eavesMatV,
      ventilationQty: ridgeVentVal || null,
      ventilationPricePerUnit: ridgeVentPriceV,
      ventilationMaterialPricePerUnit: ridgeVentMatV,
      coilNailsPricePerUnit: coilNailsPriceV,
      feltNailsPricePerUnit: feltNailsPriceV,
      caulkPricePerUnit: caulkPriceV,
      paintPricePerUnit: paintPriceV,
      deliveryFeePricePerUnit: deliveryFeePriceV,
      reportSource: reportSourceV,
      gafReportPricePerUnit: gafReportPriceV,
      roofrReportPricePerUnit: roofrReportPriceV,
      eagleviewReportPricePerUnit: eagleviewReportPriceV,
      miscAmount: 0,
      subtotal: Av,
      totalWithMisc: grandTotalV,
      status: "draft",
    };
  };

  const applyReportData = async () => {
    if (!reportData) return;
    const sourceLabel = REPORT_SOURCE_LABELS[reportData.source];
    const summary = summarizeReportBuildings(reportData, splitBuildings);
    setReportSource(reportData.source);
    if (reportData.address) setCustomerAddress(reportData.address);
    if (summary.roofAreaSqFt != null) {
      const squares = (summary.roofAreaSqFt / 100).toFixed(2);
      const pitch = summary.pitch && PITCHES.includes(summary.pitch) ? summary.pitch : sections[0]?.pitch;
      setSections(prev => {
        const next = [...prev];
        next[0] = { ...next[0], squares, pitch: pitch || next[0].pitch };
        return next;
      });
    }
    // Report footage is always rounded up to the next whole foot — reports
    // give fractional feet (e.g. from "Xft Yin" conversions) that don't
    // reflect how these materials are actually ordered/measured on site.
    if (summary.rakesFt != null) setRakesQty(String(Math.ceil(summary.rakesFt)));
    if (summary.eavesFt != null) setEavesQty(String(Math.ceil(summary.eavesFt)));
    // Ice & Water Shield coverage is step flashing + valleys, not the
    // report's generic "Leak Barrier" figure.
    if (summary.stepFt != null || summary.valleysFt != null) {
      setIceWaterQty(String(Math.ceil((summary.stepFt ?? 0) + (summary.valleysFt ?? 0))));
    }
    // Alum. Step Flashing is the physical metal flashing for the same step
    // area Ice & Water Shield's membrane covers — both are needed there.
    if (summary.stepFt != null) setStepFlashingQty(String(Math.ceil(summary.stepFt)));
    if (summary.ridgeCapFt != null) setRidgeCapQty(String(Math.ceil(summary.ridgeCapFt)));
    if (summary.starterFt != null) setStarterQty(String(Math.ceil(summary.starterFt)));
    if (summary.ridgesFt != null) setRidgeVentQty(String(Math.ceil(summary.ridgesFt)));
    setWastePercent(String(reportData.suggestedWastePercent ?? DEFAULT_WASTE_PERCENT));

    const splitEntries = reportData.buildings
      .map((b, i) => ({ b, i }))
      .filter(({ i }) => splitBuildings.has(i));

    if (splitEntries.length === 0) {
      setReportDialogOpen(false);
      toast({ title: `Imported from ${sourceLabel} report`, description: "Roof measurements applied." });
      return;
    }

    setReportCreatingSeparate(true);
    let created = 0;
    for (const { b, i } of splitEntries) {
      try {
        await apiRequest("POST", "/api/estimates", buildSplitEstimatePayload(b, `Building ${i + 1}`));
        created++;
      } catch (err) {
        console.error("Failed to create split estimate:", err);
      }
    }
    setReportCreatingSeparate(false);
    queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
    setReportDialogOpen(false);
    if (created === splitEntries.length) {
      toast({
        title: `Imported from ${sourceLabel} report`,
        description: `Main estimate updated, plus ${created} separate estimate${created === 1 ? "" : "s"} created for the additional structure${created === 1 ? "" : "s"}.`,
      });
    } else {
      toast({
        title: "Partially imported",
        description: `Main estimate updated. Only ${created} of ${splitEntries.length} separate estimates could be created — check the estimates list.`,
        variant: "destructive",
      });
    }
  };

  // ─── Skylight helpers ─────────────────────────────────────────────────────
  const addSkylight = () => setSkylights(prev => [...prev, buildSkylightItem()]);

  const updateSkylight = (id: string, changes: Partial<SkylightItem>) => {
    setSkylights(prev => prev.map(sk => {
      if (sk.id !== id) return sk;
      const updated = { ...sk, ...changes };
      if (changes.model !== undefined) {
        const found = ALL_VELUX_MODELS.find(m => m.code === changes.model);
        if (found) {
          updated.size = found.size;
          updated.type = found.mountType;
          updated.materialPrice = found.materialPrice;
        }
      }
      updated.flashingPrice = updated.type === "deck" ? SKYLIGHT_FLASHING_COST : 0;
      updated.installPrice = SKYLIGHT_INSTALL_COST;
      updated.totalPerUnit = updated.materialPrice + updated.installPrice + updated.flashingPrice;
      updated.lineTotal = updated.totalPerUnit * (updated.qty ?? 1);
      return updated;
    }));
  };

  const removeSkylight = (id: string) => setSkylights(prev => prev.filter(sk => sk.id !== id));

  // ─── Chimney helpers ──────────────────────────────────────────────────────
  // Size defaults come from the shared price book when available, falling
  // back to the hardcoded CHIMNEY_PRICES (labor only; material defaults $0).
  const chimneyDefaultsFor = (size: "small" | "average" | "large") => {
    const cap = size[0].toUpperCase() + size.slice(1);
    const labor = (priceDefaults as any)?.[`chimney${cap}PricePerUnit`];
    const material = (priceDefaults as any)?.[`chimney${cap}MaterialPricePerUnit`];
    return {
      labor: labor ?? CHIMNEY_PRICES[size],
      material: material ?? 0,
    };
  };

  const addChimney = () => {
    const d = chimneyDefaultsFor("small");
    setChimneys(prev => [...prev, buildChimneyItem({ size: "small", pricePerUnit: d.labor, materialPricePerUnit: d.material })]);
  };

  const updateChimney = (id: string, changes: Partial<ChimneyItem>) => {
    setChimneys(prev => prev.map(c => {
      if (c.id !== id) return c;
      const updated = { ...c, ...changes };
      // Changing size resets to that size's default material+labor price;
      // editing price directly (or just changing qty) leaves it alone.
      if (changes.size !== undefined && changes.pricePerUnit === undefined && changes.materialPricePerUnit === undefined) {
        const d = chimneyDefaultsFor(changes.size);
        updated.pricePerUnit = d.labor;
        updated.materialPricePerUnit = d.material;
      }
      const qty = updated.qty ?? 1;
      const materialPricePerUnit = updated.materialPricePerUnit ?? 0;
      updated.lineTotal = qty * (materialPricePerUnit * (1 + materialTaxRate) + updated.pricePerUnit);
      return updated;
    }));
  };

  const removeChimney = (id: string) => setChimneys(prev => prev.filter(c => c.id !== id));

  // ─── Load existing estimate ───────────────────────────────────────────────
  const { data: existingEstimate } = useQuery<Estimate>({
    queryKey: ["/api/estimates", params.id],
    enabled: !isNew && !!params.id,
  });

  // ─── Shared price book — every save updates it, new estimates prefill from it ──
  const { data: priceDefaults } = useQuery<PriceDefaults>({
    queryKey: ["/api/price-defaults"],
  });

  // Switching brands auto-fills the base product name and swaps in that
  // brand's own remembered base/premium prices from the shared price book —
  // switching from CertainTeed to GAF shouldn't carry over Landmark PRO's rate.
  function handleBrandChange(newBrand: ShingleBrand) {
    setBrand(newBrand);
    setShingleType(BASE_SHINGLE_BY_BRAND[newBrand]);
    const prices = priceForBrand(newBrand, priceDefaults);
    setShinglePrice(String(prices.shingleLabor));
    setShingleMaterialPrice(String(prices.shingleMaterial));
    setPremiumShinglePrice(String(prices.premium));
  }

  // Prefill a brand-new estimate's material/labor prices from the shared
  // price book, so the last admin's edits carry forward automatically.
  // Existing estimates keep whatever was saved with them (handled below).
  useEffect(() => {
    if (!isNew || !priceDefaults) return;
    const set = (v: number | null | undefined, setter: (s: string) => void) => {
      if (v !== null && v !== undefined) setter(String(v));
    };
    const brandPrices = priceForBrand(brand, priceDefaults);
    setShinglePrice(String(brandPrices.shingleLabor));
    setShingleMaterialPrice(String(brandPrices.shingleMaterial));
    setPremiumShinglePrice(String(brandPrices.premium));
    set(priceDefaults.underlaymentPricePerSq, setUnderlaymentPrice);
    set(priceDefaults.underlaymentMaterialPricePerSq, setUnderlaymentMaterialPrice);
    set(priceDefaults.starterPricePerUnit, setStarterPrice);
    set(priceDefaults.starterMaterialPricePerUnit, setStarterMaterialPrice);
    set(priceDefaults.ridgeCapPricePerUnit, setRidgeCapPrice);
    set(priceDefaults.ridgeCapMaterialPricePerUnit, setRidgeCapMaterialPrice);
    set(priceDefaults.iceWaterPricePerUnit, setIceWaterPrice);
    set(priceDefaults.iceWaterMaterialPricePerUnit, setIceWaterMaterialPrice);
    set(priceDefaults.rakesPricePerUnit, setRakesPrice);
    set(priceDefaults.rakesMaterialPricePerUnit, setRakesMaterialPrice);
    set(priceDefaults.eavesPricePerUnit, setEavesPrice);
    set(priceDefaults.eavesMaterialPricePerUnit, setEavesMaterialPrice);
    set(priceDefaults.stepFlashingPricePerUnit, setStepFlashingPrice);
    set(priceDefaults.stepFlashingMaterialPricePerUnit, setStepFlashingMaterialPrice);
    set(priceDefaults.trimCoilPricePerUnit, setTrimCoilPrice);
    set(priceDefaults.trimCoilMaterialPricePerUnit, setTrimCoilMaterialPrice);
    set(priceDefaults.pipeBootsPricePerUnit, setPipeBootsPrice);
    set(priceDefaults.pipeBootsMaterialPricePerUnit, setPipeBootsMaterialPrice);
    set(priceDefaults.stationaryVentsPricePerUnit, setStationaryVentsPrice);
    set(priceDefaults.stationaryVentsMaterialPricePerUnit, setStationaryVentsMaterialPrice);
    set(priceDefaults.powerVentsPricePerUnit, setPowerVentsPrice);
    set(priceDefaults.powerVentsMaterialPricePerUnit, setPowerVentsMaterialPrice);
    set(priceDefaults.solarVentsPricePerUnit, setSolarVentsPrice);
    set(priceDefaults.solarVentsMaterialPricePerUnit, setSolarVentsMaterialPrice);
    set(priceDefaults.ventilationPricePerUnit, setRidgeVentPrice);
    set(priceDefaults.ventilationMaterialPricePerUnit, setRidgeVentMaterialPrice);
    set(priceDefaults.deckingPricePerUnit, setDeckingPrice);
    set(priceDefaults.deckingMaterialPricePerUnit, setDeckingMaterialPrice);
    set(priceDefaults.flintlasticPricePerUnit, setFlintlasticPrice);
    set(priceDefaults.flintlasticMaterialPricePerUnit, setFlintlasticMaterialPrice);
    set(priceDefaults.fourStarWarrantyPricePerUnit, setFourStarWarrantyPrice);
    set(priceDefaults.coilNailsPricePerUnit, setCoilNailsPrice);
    set(priceDefaults.feltNailsPricePerUnit, setFeltNailsPrice);
    set(priceDefaults.caulkPricePerUnit, setCaulkPrice);
    set(priceDefaults.paintPricePerUnit, setPaintPrice);
    set(priceDefaults.deliveryFeePricePerUnit, setDeliveryFeePrice);
    set(priceDefaults.gafReportPricePerUnit, setGafReportPrice);
    set(priceDefaults.roofrReportPricePerUnit, setRoofrReportPrice);
    set(priceDefaults.eagleviewReportPricePerUnit, setEagleviewReportPrice);
    set(priceDefaults.cityFeeAmount, setCityFeeAmount);
  }, [isNew, priceDefaults]);

  useEffect(() => {
    if (!existingEstimate) return;
    setCustomerName(existingEstimate.customerName || "");
    setCustomerAddress(existingEstimate.customerAddress || "");
    setCustomerPhone(existingEstimate.customerPhone || "");
    setCustomerEmail(existingEstimate.customerEmail || "");
    setNotes(existingEstimate.notes || "");
    setWastePercent(String(existingEstimate.wastePercent ?? DEFAULT_WASTE_PERCENT));
    setMaterialTaxRateInput(String(existingEstimate.materialTaxRate ?? 0));
    setConstructionType(existingEstimate.constructionType === "new_construction" ? "new_construction" : "reroof");
    setLayersToRemove(String(existingEstimate.layersToRemove ?? 1));
    setBrand((existingEstimate.brand as ShingleBrand) || "certainteed");
    setShingleType(existingEstimate.shingleType || "Landmark");
    setShingleColor(existingEstimate.shingleColor || "");
    setShingleQty(String(existingEstimate.shingleQty ?? ""));
    setShinglePrice(String(existingEstimate.shinglePricePerSq ?? D.shingle));
    setShingleMaterialPrice(String(existingEstimate.shingleMaterialPricePerSq ?? 0));
    setUnderlaymentQty(String(existingEstimate.underlaymentQty ?? ""));
    setUnderlaymentPrice(String(existingEstimate.underlaymentPricePerSq ?? (UL_ROLL_COST / UL_ROLL_SQ).toFixed(4)));
    setUnderlaymentMaterialPrice(String(existingEstimate.underlaymentMaterialPricePerSq ?? 0));
    setStarterQty(String(existingEstimate.starterQty ?? ""));
    setStarterPrice(String(existingEstimate.starterPricePerUnit ?? (ST_BUNDLE_COST / ST_BUNDLE_LF).toFixed(4)));
    setStarterMaterialPrice(String(existingEstimate.starterMaterialPricePerUnit ?? 0));
    setRidgeCapQty(String(existingEstimate.ridgeCapQty ?? ""));
    setRidgeCapPrice(String(existingEstimate.ridgeCapPricePerUnit ?? (HR_BUNDLE_COST / HR_BUNDLE_LF).toFixed(4)));
    setRidgeCapMaterialPrice(String(existingEstimate.ridgeCapMaterialPricePerUnit ?? 0));
    setIceWaterQty(String(existingEstimate.iceWaterQty ?? ""));
    setIceWaterPrice(String(existingEstimate.iceWaterPricePerUnit ?? (IW_ROLL_COST / IW_ROLL_LF).toFixed(4)));
    setIceWaterMaterialPrice(String(existingEstimate.iceWaterMaterialPricePerUnit ?? 0));
    setIncludeRakes(!!existingEstimate.includeRakes);
    setRakesQty(String(existingEstimate.rakesQty ?? ""));
    setRakesColor(existingEstimate.rakesColor || "White");
    setRakesPrice(String(existingEstimate.rakesPricePerUnit ?? (DE_PIECE_COST / DE_PIECE_LF).toFixed(4)));
    setRakesMaterialPrice(String(existingEstimate.rakesMaterialPricePerUnit ?? 0));
    setIncludeEaves(!!existingEstimate.includeEaves);
    setEavesQty(String(existingEstimate.eavesQty ?? ""));
    setEavesColor(existingEstimate.eavesColor || "White");
    setEavesPrice(String(existingEstimate.eavesPricePerUnit ?? (DE_PIECE_COST / DE_PIECE_LF).toFixed(4)));
    setEavesMaterialPrice(String(existingEstimate.eavesMaterialPricePerUnit ?? 0));
    setStepFlashingQty(String(existingEstimate.stepFlashingQty ?? ""));
    setStepFlashingPrice(String(existingEstimate.stepFlashingPricePerUnit ?? D.stepFlashing));
    setStepFlashingMaterialPrice(String(existingEstimate.stepFlashingMaterialPricePerUnit ?? 0));
    setTrimCoilQty(String(existingEstimate.trimCoilQty ?? ""));
    setTrimCoilPrice(String(existingEstimate.trimCoilPricePerUnit ?? D.trimCoil));
    setTrimCoilMaterialPrice(String(existingEstimate.trimCoilMaterialPricePerUnit ?? 0));
    setPipeBootsQty(String(existingEstimate.pipeBootsQty ?? ""));
    setPipeBootsPrice(String(existingEstimate.pipeBootsPricePerUnit ?? D.pipeBoot));
    setPipeBootsMaterialPrice(String(existingEstimate.pipeBootsMaterialPricePerUnit ?? 0));
    if (existingEstimate.chimneysJson) {
      try {
        const parsed = JSON.parse(existingEstimate.chimneysJson) as ChimneyItem[];
        // Normalize chimneys saved before the material/labor split existed
        setChimneys(parsed.map(c => ({ ...c, materialPricePerUnit: c.materialPricePerUnit ?? 0 })));
      } catch {}
    } else if (existingEstimate.chimneyQty) {
      // Migrate old single-item chimney estimates into the new array format
      setChimneys([buildChimneyItem({
        size: (existingEstimate.chimneySize as "small" | "average" | "large") || "small",
        qty: existingEstimate.chimneyQty,
      })]);
    }
    setStationaryVentsQty(String(existingEstimate.stationaryVentsQty ?? ""));
    setStationaryVentsPrice(String(existingEstimate.stationaryVentsPricePerUnit ?? 24));
    setStationaryVentsMaterialPrice(String(existingEstimate.stationaryVentsMaterialPricePerUnit ?? 0));
    setPowerVentsQty(String(existingEstimate.powerVentsQty ?? ""));
    setPowerVentsPrice(String(existingEstimate.powerVentsPricePerUnit ?? 200));
    setPowerVentsMaterialPrice(String(existingEstimate.powerVentsMaterialPricePerUnit ?? 0));
    setSolarVentsQty(String(existingEstimate.solarVentsQty ?? ""));
    setSolarVentsPrice(String(existingEstimate.solarVentsPricePerUnit ?? 650));
    setSolarVentsMaterialPrice(String(existingEstimate.solarVentsMaterialPricePerUnit ?? 0));
    setRidgeVentQty(String(existingEstimate.ventilationQty ?? ""));
    setRidgeVentPrice(String(existingEstimate.ventilationPricePerUnit ?? (RV_PIECE_COST / RV_PIECE_LF).toFixed(4)));
    setRidgeVentMaterialPrice(String(existingEstimate.ventilationMaterialPricePerUnit ?? 0));
    setDeckingQty(String(existingEstimate.deckingQty ?? ""));
    setDeckingPrice(String(existingEstimate.deckingPricePerUnit ?? D.decking));
    setDeckingMaterialPrice(String(existingEstimate.deckingMaterialPricePerUnit ?? 0));
    setFlintlasticQty(String(existingEstimate.flintlasticQty ?? ""));
    setFlintlasticPrice(String(existingEstimate.flintlasticPricePerUnit ?? 301));
    setFlintlasticMaterialPrice(String(existingEstimate.flintlasticMaterialPricePerUnit ?? 0));
    setIncludePremiumShingle(!!existingEstimate.includeLandmarkPro);
    setPremiumShinglePrice(String(existingEstimate.landmarkProPricePerUnit ?? D.premiumShingle));
    setIncludeFourStarWarranty(!!existingEstimate.includeFourStarWarranty);
    setFourStarWarrantyPrice(String(existingEstimate.fourStarWarrantyPricePerUnit ?? 15));
    if (existingEstimate.referralFee === 100 || existingEstimate.referralFee === 200) {
      setReferralFee(existingEstimate.referralFee);
    } else {
      setReferralFee(0);
    }
    setReferralName(existingEstimate.referralName || "");
    setCoilNailsPrice(String(existingEstimate.coilNailsPricePerUnit ?? D.coilNails));
    setFeltNailsPrice(String(existingEstimate.feltNailsPricePerUnit ?? D.feltNails));
    setCaulkPrice(String(existingEstimate.caulkPricePerUnit ?? D.caulk));
    setPaintPrice(String(existingEstimate.paintPricePerUnit ?? D.paint));
    setDeliveryFeePrice(String(existingEstimate.deliveryFeePricePerUnit ?? D.deliveryFee));
    setReportSource((existingEstimate.reportSource as ReportSource | null) ?? null);
    setGafReportPrice(String(existingEstimate.gafReportPricePerUnit ?? D.gafReport));
    setRoofrReportPrice(String(existingEstimate.roofrReportPricePerUnit ?? D.roofrReport));
    setEagleviewReportPrice(String(existingEstimate.eagleviewReportPricePerUnit ?? D.eagleviewReport));
    setIsCityJob(!!existingEstimate.isCityJob);
    setCityFeeAmount(String(existingEstimate.cityFeeAmount ?? D.cityFee));
    if (existingEstimate.skylightsJson) {
      try { setSkylights(JSON.parse(existingEstimate.skylightsJson)); } catch {}
    }
    const s: { squares: string; pitch: string }[] = [];
    if (existingEstimate.section1Squares) s.push({ squares: String(existingEstimate.section1Squares), pitch: existingEstimate.section1Pitch || "6/12" });
    if (existingEstimate.section2Squares) s.push({ squares: String(existingEstimate.section2Squares), pitch: existingEstimate.section2Pitch || "6/12" });
    if (existingEstimate.section3Squares) s.push({ squares: String(existingEstimate.section3Squares), pitch: existingEstimate.section3Pitch || "6/12" });
    if (s.length > 0) setSections(s);
  }, [existingEstimate]);

  const buildPayload = () => ({
    customerName,
    customerAddress,
    customerPhone: customerPhone || null,
    customerEmail: customerEmail || null,
    notes: notes || null,
    createdAt: new Date().toISOString(),
    section1Squares: num(sections[0]?.squares) || null,
    section1Pitch: sections[0]?.pitch || null,
    section2Squares: num(sections[1]?.squares) || null,
    section2Pitch: sections[1]?.pitch || null,
    section3Squares: num(sections[2]?.squares) || null,
    section3Pitch: sections[2]?.pitch || null,
    wastePercent: num(wastePercent),
    totalSquares: totalRawSq,
    totalSquaresWithWaste: totalWithWaste,
    materialTaxRate: num(materialTaxRateInput) || 0,
    constructionType,
    layersToRemove: num(layersToRemove) || 1,
    layersQty: totalWithWaste || null,
    layersPricePerUnit: layersRate,
    brand,
    shingleType, shingleColor: shingleColor || null,
    shingleQty: num(shingleQty) || null,
    shinglePricePerSq: num(shinglePrice),
    shingleMaterialPricePerSq: num(shingleMaterialPrice),
    includeLandmarkPro: includePremiumShingle,
    landmarkProPricePerUnit: num(premiumShinglePrice),
    underlaymentQty: num(underlaymentQty) || null,
    underlaymentPricePerSq: num(underlaymentPrice),
    underlaymentMaterialPricePerSq: num(underlaymentMaterialPrice),
    starterQty: num(starterQty) || null,
    starterPricePerUnit: num(starterPrice),
    starterMaterialPricePerUnit: num(starterMaterialPrice),
    ridgeCapQty: num(ridgeCapQty) || null,
    ridgeCapPricePerUnit: num(ridgeCapPrice),
    ridgeCapMaterialPricePerUnit: num(ridgeCapMaterialPrice),
    iceWaterQty: num(iceWaterQty) || null,
    iceWaterPricePerUnit: num(iceWaterPrice),
    iceWaterMaterialPricePerUnit: num(iceWaterMaterialPrice),
    includeRakes,
    rakesQty: num(rakesQty) || null,
    rakesColor,
    rakesPricePerUnit: num(rakesPrice),
    rakesMaterialPricePerUnit: num(rakesMaterialPrice),
    includeEaves,
    eavesQty: num(eavesQty) || null,
    eavesColor,
    eavesPricePerUnit: num(eavesPrice),
    eavesMaterialPricePerUnit: num(eavesMaterialPrice),
    stepFlashingQty: num(stepFlashingQty) || null,
    stepFlashingPricePerUnit: num(stepFlashingPrice),
    stepFlashingMaterialPricePerUnit: num(stepFlashingMaterialPrice),
    trimCoilQty: num(trimCoilQty) || null,
    trimCoilPricePerUnit: num(trimCoilPrice),
    trimCoilMaterialPricePerUnit: num(trimCoilMaterialPrice),
    pipeBootsQty: num(pipeBootsQty) || null,
    pipeBootsPricePerUnit: num(pipeBootsPrice),
    pipeBootsMaterialPricePerUnit: num(pipeBootsMaterialPrice),
    chimneysJson: chimneys.length ? JSON.stringify(chimneys) : null,
    stationaryVentsQty: num(stationaryVentsQty) || null,
    stationaryVentsPricePerUnit: num(stationaryVentsPrice),
    stationaryVentsMaterialPricePerUnit: num(stationaryVentsMaterialPrice),
    powerVentsQty: num(powerVentsQty) || null,
    powerVentsPricePerUnit: num(powerVentsPrice),
    powerVentsMaterialPricePerUnit: num(powerVentsMaterialPrice),
    solarVentsQty: num(solarVentsQty) || null,
    solarVentsPricePerUnit: num(solarVentsPrice),
    solarVentsMaterialPricePerUnit: num(solarVentsMaterialPrice),
    skylightsJson: skylights.length ? JSON.stringify(skylights) : null,
    ventilationQty: num(ridgeVentQty) || null,
    ventilationPricePerUnit: num(ridgeVentPrice),
    ventilationMaterialPricePerUnit: num(ridgeVentMaterialPrice),
    deckingQty: num(deckingQty) || null,
    deckingPricePerUnit: num(deckingPrice),
    deckingMaterialPricePerUnit: num(deckingMaterialPrice),
    flintlasticQty: num(flintlasticQty) || null,
    flintlasticPricePerUnit: num(flintlasticPrice),
    flintlasticMaterialPricePerUnit: num(flintlasticMaterialPrice),
    includeFourStarWarranty,
    fourStarWarrantyPricePerUnit: num(fourStarWarrantyPrice),
    referralFee: referralFee || null,
    referralName: referralName || null,
    coilNailsPricePerUnit: num(coilNailsPrice),
    feltNailsPricePerUnit: num(feltNailsPrice),
    caulkPricePerUnit: num(caulkPrice),
    paintPricePerUnit: num(paintPrice),
    deliveryFeePricePerUnit: num(deliveryFeePrice),
    reportSource,
    gafReportPricePerUnit: num(gafReportPrice),
    roofrReportPricePerUnit: num(roofrReportPrice),
    eagleviewReportPricePerUnit: num(eagleviewReportPrice),
    isCityJob,
    cityFeeAmount: num(cityFeeAmount),
    miscAmount: 0,
    subtotal: A,
    totalWithMisc: grandTotal,
    status: "draft",
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = isNew ? "/api/estimates" : `/api/estimates/${params.id}`;
      const method = isNew ? "POST" : "PUT";
      return await apiRequest(method, url, data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/price-defaults"] });
      toast({ title: "Estimate saved", description: fmtBig(grandTotal) });
      if (isNew && data?.id) setLocation(`/estimate/${data.id}`);
    },
    onError: (err: any) => {
      console.error("Save error:", err);
      toast({ title: "Save failed", description: "Check console for details.", variant: "destructive" });
    },
  });

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <input ref={reportFileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleReportFileChange} />
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import from {reportData ? REPORT_SOURCE_LABELS[reportData.source] : "Measurement"} Report</DialogTitle>
            <DialogDescription>Review the values found before applying them to this estimate.</DialogDescription>
          </DialogHeader>
          {reportData && (() => {
            const summary = summarizeReportBuildings(reportData, splitBuildings);
            return (
              <div className="text-sm">
                <ReportReviewRow label="Job Address" value={reportData.address} />
                <ReportReviewRow label="Squares (Roof Area)" value={summary.roofAreaSqFt != null ? `${(summary.roofAreaSqFt / 100).toFixed(2)} SQ (${summary.roofAreaSqFt.toLocaleString()} sq ft)` : null} />
                <ReportReviewRow label="Pitch" value={summary.pitch} />
                <ReportReviewRow label="Eaves" value={summary.eavesFt != null ? `${summary.eavesFt.toLocaleString()} FT` : null} />
                <ReportReviewRow label="Rakes" value={summary.rakesFt != null ? `${summary.rakesFt.toLocaleString()} FT` : null} />
                <ReportReviewRow label="Ice & Water Shield (step + valleys)" value={(summary.stepFt != null || summary.valleysFt != null) ? `${((summary.stepFt ?? 0) + (summary.valleysFt ?? 0)).toLocaleString()} FT` : null} />
                <ReportReviewRow label="Alum. Step Flashing" value={summary.stepFt != null ? `${summary.stepFt.toLocaleString()} FT` : null} />
                <ReportReviewRow label="Hip & Ridge (ridge cap)" value={summary.ridgeCapFt != null ? `${summary.ridgeCapFt.toLocaleString()} FT` : null} />
                <ReportReviewRow label="Starter Strip" value={summary.starterFt != null ? `${summary.starterFt.toLocaleString()} FT` : null} />
                <ReportReviewRow label="Ridge Vent (ridges only, excl. hips)" value={summary.ridgesFt != null ? `${summary.ridgesFt.toLocaleString()} FT` : null} />
                <ReportReviewRow label="Waste %" value={reportData.suggestedWastePercent != null ? `${reportData.suggestedWastePercent}% (suggested)` : `${DEFAULT_WASTE_PERCENT}% (default — none suggested)`} />
                <p className="text-xs text-muted-foreground pt-3">
                  This will overwrite the Address field, Waste %, Section 1's squares/pitch, and the Eaves, Rakes, Ice & Water, Alum. Step Flashing, Hip & Ridge, Starter Strip, and Ridge Vent quantities above — all still editable afterward.
                </p>
                {reportData.buildings.length > 1 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="font-medium mb-1">This report covers {reportData.buildings.length} roof structures</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      If any of these are separate buildings — a detached garage, shed, etc. — rather than part of the main roof, check them below. Checked structures are left out of the totals above and get their own new estimate instead.
                    </p>
                    <div className="space-y-1.5">
                      {reportData.buildings.map((b, i) => (
                        <label key={i} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox checked={splitBuildings.has(i)} onCheckedChange={() => toggleSplitBuilding(i)} />
                          <span>
                            Building {i + 1} — {b.roofAreaSqFt != null ? `${b.roofAreaSqFt.toLocaleString()} sq ft` : "? sq ft"}
                            {b.pitch ? `, ${b.pitch} pitch` : ""}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)} disabled={reportCreatingSeparate}>Cancel</Button>
            <Button onClick={applyReportData} disabled={reportCreatingSeparate}>
              {reportCreatingSeparate ? "Creating estimates…" : "Apply to Estimate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-card border-b border-border shadow-sm print:hidden">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="gap-1">
              <ChevronLeft size={16} /> Back
            </Button>
            <div>
              <h1 className="text-base font-bold">{customerName || "New Estimate"}</h1>
              <p className="text-xs text-muted-foreground">{customerAddress || "Roofing Estimate"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canSeeAdminView && (
            <Button variant="outline" size="sm" onClick={() => setRole(r => r === "admin" ? "sales" : "admin")} className="gap-1 text-xs" data-testid="toggle-role">
              {isAdmin ? <><EyeOff size={14} /> Admin</> : <><Eye size={14} /> Sales</>}
            </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1" data-testid="print-estimate">
              <Printer size={14} /> Print
            </Button>
            <Button size="sm" onClick={() => saveMutation.mutate(buildPayload())} disabled={saveMutation.isPending} className="gap-1" data-testid="save-estimate">
              <Save size={14} /> {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-4 space-y-4">
        <Badge variant={isAdmin ? "default" : "secondary"}>
          {isAdmin ? "Admin / Estimator View" : "Sales View"}
        </Badge>

        {/* ══════════════════════════════════════════════════════════════════
            SALES VIEW — quantities in, commission/total/price-per-sq out
        ══════════════════════════════════════════════════════════════════ */}
        {!isAdmin && (
          <div className="space-y-4">
            {/* Customer */}
            <div className="section-card">
              <div className="section-header">Customer</div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs mb-1 block">Name</Label>
                  <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="John Smith" /></div>
                <div><Label className="text-xs mb-1 block">Address</Label>
                  <Input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder="123 Main St" /></div>
                <div><Label className="text-xs mb-1 block">Phone</Label>
                  <Input value={customerPhone} onChange={e => handlePhoneChange(e.target.value)} placeholder="(864) 555-0100" /></div>
                <div><Label className="text-xs mb-1 block">Email</Label>
                  <Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="customer@email.com" /></div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Checkbox checked={isCityJob} onCheckedChange={v => setIsCityJob(!!v)} />
                <span className="text-sm">In City Limits</span>
              </div>
            </div>

            {/* Roof Measurements */}
            <div className="section-card">
              <div className="section-header flex items-center justify-between">
                <span>Roof Measurements</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={triggerReportImport} disabled={reportLoading} className="gap-1 text-xs h-7 print:hidden">
                    <Upload size={12} /> {reportLoading ? "Importing..." : "Import Report"}
                  </Button>
                  {sections.length < 3 && (
                    <Button variant="outline" size="sm" onClick={addSection} className="gap-1 text-xs h-7 print:hidden"><Plus size={12} /> Add Section</Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-12 gap-2 mb-1 text-xs font-semibold text-muted-foreground">
                <div className="col-span-3">Section</div>
                <div className="col-span-5">Squares</div>
                <div className="col-span-3">Pitch</div>
                <div className="col-span-1"></div>
              </div>
              {sections.map((sec, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center mb-2">
                  <div className="col-span-3 text-sm font-medium">Section {i + 1}</div>
                  <div className="col-span-5">
                    <Input type="number" min="0" step="0.1" value={sec.squares} onChange={e => updateSection(i, "squares", e.target.value)} placeholder="0.0" className="text-sm" />
                  </div>
                  <div className="col-span-3">
                    <Select value={sec.pitch} onValueChange={v => updateSection(i, "pitch", v)}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{PITCHES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {sections.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removeSection(i)} className="h-7 w-7 p-0 text-destructive print:hidden"><Trash2 size={13} /></Button>
                    )}
                  </div>
                </div>
              ))}
              <Separator className="my-3" />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Waste %</Label>
                    <Input type="number" min="0" max="50" value={wastePercent} onChange={e => setWastePercent(e.target.value)} className="text-sm w-16" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Construction</Label>
                    <Select value={constructionType} onValueChange={v => setConstructionType(v as "reroof" | "new_construction")}>
                      <SelectTrigger className="text-sm w-40 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>{CONSTRUCTION_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {constructionType === "reroof" && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs whitespace-nowrap">Number of Layers</Label>
                      <Input type="number" min="1" step="1" value={layersToRemove} onChange={e => setLayersToRemove(e.target.value)} className="text-sm w-16" />
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Raw SQ:</span><span className="font-semibold">{totalRawSq.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">With waste:</span><span className="font-bold text-primary">{totalWithWaste.toFixed(2)} SQ</span></div>
                </div>
              </div>
            </div>

            {/* Materials — quantities only, no prices */}
            <div className="section-card">
              <div className="section-header">Materials</div>

              <SalesGroupLabel>Shingles</SalesGroupLabel>
              {/* Brand / shingle type */}
              <div className="grid grid-cols-12 gap-2 items-center mb-2">
                <div className="col-span-7 text-sm font-medium">Brand</div>
                <div className="col-span-5">
                  <Select value={brand} onValueChange={v => handleBrandChange(v as ShingleBrand)}>
                    <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{SHINGLE_BRANDS.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-12 gap-2 items-center mb-2">
                <div className="col-span-7 text-sm font-medium">Shingle Type</div>
                <div className="col-span-5">
                  <Input value={shingleType} onChange={e => setShingleType(e.target.value)} placeholder="Shingle type..." className="text-sm h-8" />
                </div>
              </div>

              <SalesGroupLabel>Quantities</SalesGroupLabel>
              <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-semibold text-muted-foreground border-b border-border pb-2">
                <div className="col-span-7">Item</div>
                <div className="col-span-3 text-center">Qty</div>
                <div className="col-span-2 text-center">Unit</div>
              </div>
              <SalesQtyRow label={shingleType} qty={shingleQty} setQty={setShingleQty} unit="SQ" />

              <Separator className="my-2" />
              <SalesGroupLabel>Underlayment & Accessories</SalesGroupLabel>
              <SalesQtyRow label="Synthetic Underlayment" qty={underlaymentQty} setQty={setUnderlaymentQty} unit="SQ" />
              <SalesQtyRow label="Starter Strip" qty={starterQty} setQty={setStarterQty} unit="FT" />
              <SalesQtyRow label="Hip & Ridge" qty={ridgeCapQty} setQty={setRidgeCapQty} unit="FT" />
              <SalesQtyRow label="Ice & Water Shield" qty={iceWaterQty} setQty={setIceWaterQty} unit="FT" />

              <Separator className="my-2" />
              <SalesGroupLabel>Flashing & Metal</SalesGroupLabel>
              {/* Rakes and Eaves, each with their own color selector */}
              <div className="grid grid-cols-12 gap-2 items-center mb-1">
                <div className="col-span-7 text-sm font-medium flex items-center gap-1 flex-wrap">
                  <span>Rakes</span>
                  <Select value={rakesColor} onValueChange={setRakesColor}>
                    <SelectTrigger className="text-xs h-6 px-2 w-28 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DRIP_EDGE_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input type="number" min="0" value={rakesQty} onChange={e => setRakesQty(e.target.value)} placeholder="0" className="text-sm h-8" />
                </div>
                <div className="col-span-2 text-xs text-center text-muted-foreground">FT</div>
              </div>
              <div className="grid grid-cols-12 gap-2 items-center mb-1">
                <div className="col-span-7 text-sm font-medium flex items-center gap-1 flex-wrap">
                  <span>Eaves</span>
                  <Select value={eavesColor} onValueChange={setEavesColor}>
                    <SelectTrigger className="text-xs h-6 px-2 w-28 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DRIP_EDGE_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input type="number" min="0" value={eavesQty} onChange={e => setEavesQty(e.target.value)} placeholder="0" className="text-sm h-8" />
                </div>
                <div className="col-span-2 text-xs text-center text-muted-foreground">FT</div>
              </div>
              <SalesQtyRow label="Alum. Step Flashing" qty={stepFlashingQty} setQty={setStepFlashingQty} unit="FT" />
              <SalesQtyRow label="Trim Coil" qty={trimCoilQty} setQty={setTrimCoilQty} unit="FT" />

              <Separator className="my-2" />
              <SalesGroupLabel>Openings & Penetrations</SalesGroupLabel>
              <SalesQtyRow label="Pipe Boots (incl Rain Collars)" qty={pipeBootsQty} setQty={setPipeBootsQty} unit="EA" />
              <div className="flex items-center justify-between mb-1 mt-1">
                <span className="text-xs font-semibold text-muted-foreground">Chimneys</span>
                <Button variant="outline" size="sm" onClick={addChimney} className="gap-1 text-xs h-7 print:hidden">
                  <Plus size={12} /> Add Chimney
                </Button>
              </div>
              {chimneys.length === 0 && (
                <p className="text-xs text-muted-foreground mb-2 italic">No chimneys added.</p>
              )}
              {chimneys.map((c) => (
                <div key={c.id} className="grid grid-cols-12 gap-2 items-center mb-1">
                  <div className="col-span-7">
                    <Select value={c.size} onValueChange={v => updateChimney(c.id, { size: v as "small" | "average" | "large" })}>
                      <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>{CHIMNEY_SIZES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Input type="number" min="1" value={c.qty} onChange={e => updateChimney(c.id, { qty: num(e.target.value) })} placeholder="Qty" className="text-sm h-8" />
                  </div>
                  <div className="col-span-1 text-xs text-center text-muted-foreground">EA</div>
                  <div className="col-span-1 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => removeChimney(c.id)} className="h-7 w-7 p-0 text-destructive print:hidden"><Trash2 size={13} /></Button>
                  </div>
                </div>
              ))}

              <Separator className="my-2" />
              <SalesGroupLabel>Ventilation</SalesGroupLabel>
              <SalesQtyRow label="Ridge Vent" qty={ridgeVentQty} setQty={setRidgeVentQty} unit="LF" />
              <SalesQtyRow label="750 Vents" qty={stationaryVentsQty} setQty={setStationaryVentsQty} unit="EA" />
              <SalesQtyRow label="Power Vents" qty={powerVentsQty} setQty={setPowerVentsQty} unit="EA" />
              <SalesQtyRow label="Solar Vents" qty={solarVentsQty} setQty={setSolarVentsQty} unit="EA" />

              {/* Skylights */}
              <Separator className="my-2" />
              <div className="flex items-center justify-between mb-2">
                <SalesGroupLabel noMargin>Velux Skylights</SalesGroupLabel>
                <Button variant="outline" size="sm" onClick={addSkylight} className="gap-1 text-xs h-7 print:hidden">
                  <Plus size={12} /> Add Skylight
                </Button>
              </div>
              {skylights.length === 0 && (
                <p className="text-xs text-muted-foreground mb-2 italic">No skylights added.</p>
              )}
              {skylights.map((sk) => (
                <div key={sk.id} className="border border-border rounded-md p-2 mb-2 bg-muted/20">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-7">
                      <Select value={sk.model} onValueChange={v => updateSkylight(sk.id, { model: v })}>
                        <SelectTrigger className="text-xs h-8"><SelectValue placeholder="Select model..." /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          <SelectItem value="__deck_header__" disabled className="text-xs font-bold text-muted-foreground uppercase">── Deck Mount Fixed (FS) ──</SelectItem>
                          {ALL_VELUX_MODELS.filter(m => m.mountType === "deck").map(m => (
                            <SelectItem key={m.code} value={m.code}>{m.code} — {m.size}</SelectItem>
                          ))}
                          <SelectItem value="__curb_header__" disabled className="text-xs font-bold text-muted-foreground uppercase">── Curb Mount Fixed (FCM) ──</SelectItem>
                          {ALL_VELUX_MODELS.filter(m => m.mountType === "curb").map(m => (
                            <SelectItem key={m.code} value={m.code}>{m.code} — {m.size}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Input type="number" min="1" value={sk.qty} onChange={e => updateSkylight(sk.id, { qty: num(e.target.value) })} placeholder="Qty" className="text-sm h-8" />
                    </div>
                    <div className="col-span-1 text-xs text-center text-muted-foreground">EA</div>
                    <div className="col-span-1 flex justify-end">
                      <Button variant="ghost" size="sm" onClick={() => removeSkylight(sk.id)} className="h-7 w-7 p-0 text-destructive print:hidden"><Trash2 size={13} /></Button>
                    </div>
                  </div>
                </div>
              ))}

              <Separator className="my-2" />
              <SalesGroupLabel>Other</SalesGroupLabel>
              <SalesQtyRow label="Flintlastic" qty={flintlasticQty} setQty={setFlintlasticQty} unit="SQ" />
              {/* Decking: thickness + type selectors */}
              <div className="grid grid-cols-12 gap-2 items-center mb-1">
                <div className="col-span-7 text-sm font-medium flex items-center gap-1 flex-wrap">
                  <span>Decking</span>
                  <Select value={deckingThickness} onValueChange={setDeckingThickness}>
                    <SelectTrigger className="text-xs h-6 px-2 w-20 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DECKING_THICKNESSES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={deckingType} onValueChange={setDeckingType}>
                    <SelectTrigger className="text-xs h-6 px-2 w-20 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DECKING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input type="number" min="0" value={deckingQty} onChange={e => setDeckingQty(e.target.value)} placeholder="0" className="text-sm h-8" />
                </div>
                <div className="col-span-2 text-xs text-center text-muted-foreground">Sheet</div>
              </div>
            </div>

            {/* Referral Fee — sales view */}
            <div className="section-card">
              <div className="section-header">Referral</div>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs mb-1 block">Referral Fee</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {([0, 100, 200] as const).map(amt => (
                      <button key={amt} type="button" onClick={() => setReferralFee(amt)}
                        className={`rounded-md py-2 px-3 text-sm font-medium border transition-colors ${
                          referralFee === amt
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border text-foreground hover:bg-muted"
                        }`}>
                        {amt === 0 ? "None" : `$${amt}`}
                      </button>
                    ))}
                  </div>
                </div>
                {referralFee > 0 && (
                  <div>
                    <Label className="text-xs mb-1 block">Referral Name</Label>
                    <Input value={referralName} onChange={e => setReferralName(e.target.value)} placeholder="Referral's name..." className="text-sm" />
                  </div>
                )}
              </div>
            </div>

            {/* Lead type + Estimate results */}
            <div className="section-card">
              <div className="section-header">Estimate</div>
              <div className="space-y-4 py-2">

                {/* Lead Type selector */}
                <div className="border border-border rounded-lg px-4 py-3">
                  <div className="text-sm font-semibold text-foreground mb-2">Lead Type</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setLeadType("office")}
                      className={`rounded-md py-2 px-3 text-sm font-medium border transition-colors ${
                        leadType === "office"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-foreground hover:bg-muted"
                      }`}
                    >
                      Office Lead<br /><span className="text-xs font-normal opacity-80">10% commission</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeadType("self")}
                      className={`rounded-md py-2 px-3 text-sm font-medium border transition-colors ${
                        leadType === "self"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-foreground hover:bg-muted"
                      }`}
                    >
                      Self-Generated<br /><span className="text-xs font-normal opacity-80">14% commission</span>
                    </button>
                  </div>
                </div>

                {/* Base Roof subtotal */}
                <div className="flex items-center justify-between px-4 py-2 border border-border rounded-lg">
                  <span className="text-sm font-semibold text-foreground">Base Roof Subtotal</span>
                  <span className="text-lg font-bold text-foreground">{fmtBig(baseTotal)}</span>
                </div>

                {/* Price per SQ */}
                <div className="flex items-center justify-between px-4 py-2 border border-border rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Price per Square</div>
                    <div className="text-xs text-muted-foreground">{totalSqForPrice.toFixed(2)} SQ (incl. starter & hip/ridge)</div>
                  </div>
                  <span className="text-lg font-bold text-foreground" data-testid="sales-price-per-sq">
                    {pricePerSq > 0 ? fmtBig(pricePerSq) + "/SQ" : "—"}
                  </span>
                </div>

                {/* Optional Add-Ons — Rakes, Eaves, Landmark PRO, 4-Star Warranty & Skylights, same markup/commission rates as the base roof */}
                {(num(rakesQty) > 0 || num(eavesQty) > 0 || totalWithWaste > 0 || skylights.length > 0) && (
                  <div className="border border-primary/30 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-bold text-primary uppercase tracking-wide">Optional Add-Ons</div>
                    {num(rakesQty) > 0 && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Checkbox checked={includeRakes} onCheckedChange={v => setIncludeRakes(!!v)} />
                            Rakes
                          </div>
                          <div className="text-xs text-muted-foreground pl-6">{num(rakesQty)} FT — {rakesColor} · commission {fmtBig(itemCommission(rakesTotal))}</div>
                        </div>
                        <span className="text-lg font-bold text-foreground">{fmtBig(salesPrice(rakesTotal))}</span>
                      </div>
                    )}
                    {num(eavesQty) > 0 && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Checkbox checked={includeEaves} onCheckedChange={v => setIncludeEaves(!!v)} />
                            Eaves
                          </div>
                          <div className="text-xs text-muted-foreground pl-6">{num(eavesQty)} FT — {eavesColor} · commission {fmtBig(itemCommission(eavesTotal))}</div>
                        </div>
                        <span className="text-lg font-bold text-foreground">{fmtBig(salesPrice(eavesTotal))}</span>
                      </div>
                    )}
                    {totalWithWaste > 0 && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Checkbox checked={includePremiumShingle} onCheckedChange={v => setIncludePremiumShingle(!!v)} />
                            {PREMIUM_SHINGLE_BY_BRAND[brand]}
                          </div>
                          <div className="text-xs text-muted-foreground pl-6">{totalWithWaste.toFixed(2)} SQ · commission {fmtBig(itemCommission(premiumShingleTotal))}</div>
                        </div>
                        <span className="text-lg font-bold text-foreground">{fmtBig(salesPrice(premiumShingleTotal))}</span>
                      </div>
                    )}
                    {totalWithWaste > 0 && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Checkbox checked={includeFourStarWarranty} onCheckedChange={v => setIncludeFourStarWarranty(!!v)} />
                            4-Star Warranty
                          </div>
                          <div className="text-xs text-muted-foreground pl-6">{totalSqForPrice.toFixed(2)} SQ · commission {fmtBig(itemCommission(fourStarWarrantyTotal))}</div>
                        </div>
                        <span className="text-lg font-bold text-foreground">{fmtBig(salesPrice(fourStarWarrantyTotal))}</span>
                      </div>
                    )}
                    {skylights.length > 0 && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-foreground">Skylights</div>
                          <div className="text-xs text-muted-foreground">{skylights.reduce((s, sk) => s + sk.qty, 0)} EA total · commission {fmtBig(itemCommission(skylightsTotal))}</div>
                        </div>
                        <span className="text-lg font-bold text-foreground">{fmtBig(salesPrice(skylightsTotal))}</span>
                      </div>
                    )}
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">Add-Ons Subtotal</span>
                      <span className="text-base font-bold text-foreground">{fmtBig(addOnsTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between text-green-700 dark:text-green-400">
                      <span className="text-xs font-medium">Commission on Add-Ons</span>
                      <span className="text-sm font-semibold">{fmtBig(addOnsCommission)}</span>
                    </div>
                  </div>
                )}

                {/* Total Price */}
                <div className="flex items-center justify-between py-3 bg-primary/5 rounded-lg px-4">
                  <span className="text-base font-bold text-foreground">Total Price</span>
                  <span className="text-3xl font-bold text-primary" data-testid="sales-total">{fmtBig(grandTotal)}</span>
                </div>

                {/* Commission */}
                <div className="flex items-center justify-between px-4 py-3 border border-green-200 dark:border-green-900 rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Your Commission</div>
                    <div className="text-xs text-muted-foreground">
                      {leadType === "office" ? "10% — Office Lead" : "14% — Self-Generated"}
                      {(num(rakesQty) > 0 || num(eavesQty) > 0 || totalWithWaste > 0 || skylights.length > 0) && ` (Base ${fmtBig(baseCommission)} + Add-Ons ${fmtBig(addOnsCommission)})`}
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="sales-commission">{fmtBig(F)}</span>
                </div>
              </div>
            </div>

            <div className="section-card">
              <div className="section-header">Notes</div>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes..." rows={3} />
            </div>

            <div className="flex justify-end pb-8">
              <Button onClick={() => saveMutation.mutate(buildPayload())} disabled={saveMutation.isPending} size="lg" className="gap-2">
                <Save size={16} /> {saveMutation.isPending ? "Saving..." : "Save Estimate"}
              </Button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            ADMIN VIEW — full detail
        ══════════════════════════════════════════════════════════════════ */}
        {isAdmin && (
          <>
            {/* Customer */}
            <div className="section-card">
              <div className="section-header">Customer Information</div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs mb-1 block">Customer Name</Label>
                  <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="John Smith" /></div>
                <div><Label className="text-xs mb-1 block">Address</Label>
                  <Input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder="123 Main St, City, SC" /></div>
                <div><Label className="text-xs mb-1 block">Phone</Label>
                  <Input value={customerPhone} onChange={e => handlePhoneChange(e.target.value)} placeholder="(864) 555-0100" /></div>
                <div><Label className="text-xs mb-1 block">Email</Label>
                  <Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="customer@email.com" /></div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Checkbox checked={isCityJob} onCheckedChange={v => setIsCityJob(!!v)} />
                <span className="text-sm">In City Limits (+{fmt(num(cityFeeAmount))})</span>
              </div>
            </div>

            {/* Roof Measurements */}
            <div className="section-card">
              <div className="section-header flex items-center justify-between">
                <span>Roof Measurements</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={triggerReportImport} disabled={reportLoading} className="gap-1 text-xs h-7 print:hidden">
                    <Upload size={12} /> {reportLoading ? "Importing..." : "Import Report"}
                  </Button>
                  {sections.length < 3 && (
                    <Button variant="outline" size="sm" onClick={addSection} className="gap-1 text-xs h-7 print:hidden" data-testid="add-section"><Plus size={12} /> Add Section</Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-12 gap-2 mb-1 text-xs font-semibold text-muted-foreground">
                <div className="col-span-3">Section</div><div className="col-span-4">Squares</div><div className="col-span-4">Pitch</div><div className="col-span-1"></div>
              </div>
              {sections.map((sec, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center mb-2">
                  <div className="col-span-3 text-sm font-medium">Section {i + 1}</div>
                  <div className="col-span-4"><Input type="number" min="0" step="0.1" value={sec.squares} onChange={e => updateSection(i, "squares", e.target.value)} placeholder="0.0" className="text-sm" /></div>
                  <div className="col-span-4">
                    <Select value={sec.pitch} onValueChange={v => updateSection(i, "pitch", v)}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{PITCHES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {sections.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeSection(i)} className="h-7 w-7 p-0 text-destructive print:hidden"><Trash2 size={13} /></Button>}
                  </div>
                </div>
              ))}
              <Separator className="my-3" />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Waste %</Label>
                    <Input type="number" min="0" max="50" value={wastePercent} onChange={e => setWastePercent(e.target.value)} className="text-sm w-16" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Construction</Label>
                    <Select value={constructionType} onValueChange={v => setConstructionType(v as "reroof" | "new_construction")}>
                      <SelectTrigger className="text-sm w-40 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>{CONSTRUCTION_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {constructionType === "reroof" && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs whitespace-nowrap">Number of Layers</Label>
                      <Input type="number" min="1" step="1" value={layersToRemove} onChange={e => setLayersToRemove(e.target.value)} className="text-sm w-16" />
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Raw SQ:</span><span className="font-semibold">{totalRawSq.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">With waste ({wastePercent}%):</span><span className="font-bold text-primary">{totalWithWaste.toFixed(2)} SQ</span></div>
                </div>
              </div>
            </div>

            {/* Materials Table */}
            <div className="section-card">
              <div className="section-header">Materials</div>

              {/* Shingles */}
              <GroupLabel>Shingles</GroupLabel>
              <div className="grid grid-cols-12 gap-2 items-center mb-2">
                <div className="col-span-4 text-sm font-medium">Brand</div>
                <div className="col-span-8">
                  <Select value={brand} onValueChange={v => handleBrandChange(v as ShingleBrand)}>
                    <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{SHINGLE_BRANDS.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-12 gap-2 items-center mb-2">
                <div className="col-span-4 text-sm font-medium">Shingle Type</div>
                <div className="col-span-8">
                  <Input value={shingleType} onChange={e => setShingleType(e.target.value)} placeholder="Shingle type..." className="text-sm h-8" />
                </div>
              </div>

              <GroupLabel>Quantities</GroupLabel>
              <ColHeaders />
              <MLRow label={shingleType} qty={shingleQty} setQty={setShingleQty} unit="SQ" materialPrice={shingleMaterialPrice} setMaterialPrice={setShingleMaterialPrice} laborPrice={shinglePrice} setLaborPrice={setShinglePrice} total={shingleTotal} />
              {steepPitchAdderTotal > 0 && (
                <ARow label={`Steep Pitch (+$${totalSteepAdderPerSq.toFixed(0)}/SQ)`} qty={shingleQty} setQty={() => {}} unit="SQ" price={totalSteepAdderPerSq.toFixed(2)} setPrice={() => {}} total={steepPitchAdderTotal} readonlyQty readonlyPrice highlight />
              )}
              {constructionType === "new_construction" && (
                <ARow label="New Construction Labor (-$25/SQ)" qty={shingleQty} setQty={() => {}} unit="SQ" price={newConstructionDiscountPerSq.toFixed(2)} setPrice={() => {}} total={newConstructionDiscountTotal} readonlyQty readonlyPrice highlight />
              )}
              {layersTotal > 0 && (
                <ARow label={`Layers to Remove (${layersToRemove}) +$${layersRate.toFixed(0)}/SQ`} qty={String(totalWithWaste)} setQty={() => {}} unit="SQ" price={layersRate.toFixed(2)} setPrice={() => {}} total={layersTotal} readonlyQty readonlyPrice highlight />
              )}

              <Separator className="my-2" />
              <GroupLabel>Underlayment & Accessories</GroupLabel>
              <MLRow label="Synthetic Underlayment" qty={underlaymentQty} setQty={setUnderlaymentQty} unit="SQ" materialPrice={underlaymentMaterialPrice} setMaterialPrice={setUnderlaymentMaterialPrice} laborPrice={underlaymentPrice} setLaborPrice={setUnderlaymentPrice} total={underlayTotal} prefilled />
              <MLRow label="Starter Strip" qty={starterQty} setQty={setStarterQty} unit="FT" materialPrice={starterMaterialPrice} setMaterialPrice={setStarterMaterialPrice} laborPrice={starterPrice} setLaborPrice={setStarterPrice} total={starterTotal} />
              <MLRow label="Hip & Ridge" qty={ridgeCapQty} setQty={setRidgeCapQty} unit="FT" materialPrice={ridgeCapMaterialPrice} setMaterialPrice={setRidgeCapMaterialPrice} laborPrice={ridgeCapPrice} setLaborPrice={setRidgeCapPrice} total={ridgeCapTotal} />
              <MLRow label="Ice & Water Shield" qty={iceWaterQty} setQty={setIceWaterQty} unit="FT" materialPrice={iceWaterMaterialPrice} setMaterialPrice={setIceWaterMaterialPrice} laborPrice={iceWaterPrice} setLaborPrice={setIceWaterPrice} total={iceWaterTotal} />

              <Separator className="my-2" />
              <GroupLabel>Flashing & Metal</GroupLabel>
              <MLRow
                label={<>
                  <span>Rakes</span>
                  <Select value={rakesColor} onValueChange={setRakesColor}>
                    <SelectTrigger className="text-xs h-6 px-2 w-28 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DRIP_EDGE_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </>}
                qty={rakesQty} setQty={setRakesQty} unit="FT"
                materialPrice={rakesMaterialPrice} setMaterialPrice={setRakesMaterialPrice}
                laborPrice={rakesPrice} setLaborPrice={setRakesPrice} total={rakesRawCost}
              />
              <MLRow
                label={<>
                  <span>Eaves</span>
                  <Select value={eavesColor} onValueChange={setEavesColor}>
                    <SelectTrigger className="text-xs h-6 px-2 w-28 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DRIP_EDGE_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </>}
                qty={eavesQty} setQty={setEavesQty} unit="FT"
                materialPrice={eavesMaterialPrice} setMaterialPrice={setEavesMaterialPrice}
                laborPrice={eavesPrice} setLaborPrice={setEavesPrice} total={eavesRawCost}
              />
              <MLRow label="Alum. Step Flashing" qty={stepFlashingQty} setQty={setStepFlashingQty} unit="FT" materialPrice={stepFlashingMaterialPrice} setMaterialPrice={setStepFlashingMaterialPrice} laborPrice={stepFlashingPrice} setLaborPrice={setStepFlashingPrice} total={stepFlashTotal} />
              <MLRow label="Trim Coil" qty={trimCoilQty} setQty={setTrimCoilQty} unit="FT" materialPrice={trimCoilMaterialPrice} setMaterialPrice={setTrimCoilMaterialPrice} laborPrice={trimCoilPrice} setLaborPrice={setTrimCoilPrice} total={trimCoilTotal} />

              <Separator className="my-2" />
              <GroupLabel>Openings & Penetrations</GroupLabel>
              <MLRow label="Pipe Boots (incl Rain Collars)" qty={pipeBootsQty} setQty={setPipeBootsQty} unit="EA" materialPrice={pipeBootsMaterialPrice} setMaterialPrice={setPipeBootsMaterialPrice} laborPrice={pipeBootsPrice} setLaborPrice={setPipeBootsPrice} total={pipeBootsTotal} />
              <div className="flex items-center justify-between mb-1 mt-1">
                <span className="text-xs font-semibold text-muted-foreground">Chimneys</span>
                <Button variant="outline" size="sm" onClick={addChimney} className="gap-1 text-xs h-7 print:hidden">
                  <Plus size={12} /> Add Chimney
                </Button>
              </div>
              {chimneys.length === 0 && (
                <p className="text-xs text-muted-foreground mb-2 italic">No chimneys added.</p>
              )}
              {chimneys.map((c) => (
                <div key={c.id} className="mb-2 pb-2 border-b border-dashed border-border/60 last:border-0 last:mb-1 last:pb-0">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-4">
                      <Select value={c.size} onValueChange={v => updateChimney(c.id, { size: v as "small" | "average" | "large" })}>
                        <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{CHIMNEY_SIZES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2"><Input type="number" min="1" value={c.qty} onChange={e => updateChimney(c.id, { qty: num(e.target.value) })} placeholder="Qty" className="text-sm h-8" /></div>
                    <div className="col-span-1 text-xs text-center text-muted-foreground">EA</div>
                    <div className="col-span-2 text-right text-sm font-semibold">{fmt(c.lineTotal)}</div>
                    <div className="col-span-3 flex justify-end">
                      <Button variant="ghost" size="sm" onClick={() => removeChimney(c.id)} className="h-7 w-7 p-0 text-destructive print:hidden"><Trash2 size={13} /></Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span className="text-xs text-muted-foreground shrink-0">Material</span>
                      <Input type="number" min="0" step="0.01" value={c.materialPricePerUnit ?? 0} onChange={e => updateChimney(c.id, { materialPricePerUnit: num(e.target.value) })} placeholder="0.00" className="text-sm h-7" />
                    </div>
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span className="text-xs text-muted-foreground shrink-0">Labor</span>
                      <Input type="number" min="0" step="0.01" value={c.pricePerUnit} onChange={e => updateChimney(c.id, { pricePerUnit: num(e.target.value) })} className="text-sm h-7" />
                    </div>
                  </div>
                </div>
              ))}

              <Separator className="my-2" />
              <GroupLabel>Ventilation</GroupLabel>
              <MLRow label="Ridge Vent" qty={ridgeVentQty} setQty={setRidgeVentQty} unit="LF" materialPrice={ridgeVentMaterialPrice} setMaterialPrice={setRidgeVentMaterialPrice} laborPrice={ridgeVentPrice} setLaborPrice={setRidgeVentPrice} total={ridgeVentTotal} />
              <MLRow label="750 Vents" qty={stationaryVentsQty} setQty={setStationaryVentsQty} unit="EA" materialPrice={stationaryVentsMaterialPrice} setMaterialPrice={setStationaryVentsMaterialPrice} laborPrice={stationaryVentsPrice} setLaborPrice={setStationaryVentsPrice} total={stationaryVentsTotal} />
              <MLRow label="Power Vents" qty={powerVentsQty} setQty={setPowerVentsQty} unit="EA" materialPrice={powerVentsMaterialPrice} setMaterialPrice={setPowerVentsMaterialPrice} laborPrice={powerVentsPrice} setLaborPrice={setPowerVentsPrice} total={powerVentsTotal} />
              <MLRow label="Solar Vents" qty={solarVentsQty} setQty={setSolarVentsQty} unit="EA" materialPrice={solarVentsMaterialPrice} setMaterialPrice={setSolarVentsMaterialPrice} laborPrice={solarVentsPrice} setLaborPrice={setSolarVentsPrice} total={solarVentsTotal} />

              {/* Skylights */}
              <Separator className="my-2" />
              <div className="flex items-center justify-between mb-2">
                <GroupLabel noMargin>Velux Skylights</GroupLabel>
                <Button variant="outline" size="sm" onClick={addSkylight} className="gap-1 text-xs h-7 print:hidden">
                  <Plus size={12} /> Add Skylight
                </Button>
              </div>
              {skylights.length === 0 && (
                <p className="text-xs text-muted-foreground mb-2 italic">No skylights added. Click + Add Skylight to add one.</p>
              )}
              {skylights.map((sk) => (
                <div key={sk.id} className="border border-border rounded-md p-3 mb-2 bg-muted/30">
                  <div className="grid grid-cols-12 gap-2 items-center mb-2">
                    <div className="col-span-7">
                      <Select value={sk.model} onValueChange={v => updateSkylight(sk.id, { model: v })}>
                        <SelectTrigger className="text-xs h-8"><SelectValue placeholder="Select Velux model..." /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          <SelectItem value="__deck_header__" disabled className="text-xs font-bold text-muted-foreground uppercase">── Deck Mount Fixed (FS) ──</SelectItem>
                          {ALL_VELUX_MODELS.filter(m => m.mountType === "deck").map(m => (
                            <SelectItem key={m.code} value={m.code}>{m.code} — {m.size} — ${m.materialPrice}</SelectItem>
                          ))}
                          <SelectItem value="__curb_header__" disabled className="text-xs font-bold text-muted-foreground uppercase">── Curb Mount Fixed (FCM) ──</SelectItem>
                          {ALL_VELUX_MODELS.filter(m => m.mountType === "curb").map(m => (
                            <SelectItem key={m.code} value={m.code}>{m.code} — {m.size} — ${m.materialPrice}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Input type="number" min="1" value={sk.qty} onChange={e => updateSkylight(sk.id, { qty: num(e.target.value) })} placeholder="Qty" className="text-sm h-8" />
                    </div>
                    <div className="col-span-1 text-xs text-center text-muted-foreground">EA</div>
                    <div className="col-span-2 flex justify-end">
                      <Button variant="ghost" size="sm" onClick={() => removeSkylight(sk.id)} className="h-7 w-7 p-0 text-destructive print:hidden"><Trash2 size={13} /></Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground bg-background rounded px-2 py-1.5">
                    <div><span className="block font-medium text-foreground">Material</span><span>{fmtBig(sk.materialPrice)}</span></div>
                    <div><span className="block font-medium text-foreground">Install</span><span>${SKYLIGHT_INSTALL_COST} (all types)</span></div>
                    <div><span className="block font-medium text-foreground">Flashing {sk.type === "deck" ? "(deck)" : "(curb — none)"}</span><span>{sk.type === "deck" ? `$${SKYLIGHT_FLASHING_COST}` : "—"}</span></div>
                  </div>
                  <div className="flex justify-between items-center mt-2 px-1">
                    <span className="text-xs text-muted-foreground">{fmtBig(sk.totalPerUnit)}/ea × {sk.qty}</span>
                    <span className="text-sm font-bold">{fmtBig(sk.lineTotal)}</span>
                  </div>
                </div>
              ))}

              <Separator className="my-2" />
              <GroupLabel>Other</GroupLabel>
              <MLRow label="Flintlastic" qty={String(roundUp(num(flintlasticQty)))} setQty={setFlintlasticQty} unit="SQ" materialPrice={flintlasticMaterialPrice} setMaterialPrice={setFlintlasticMaterialPrice} laborPrice={flintlasticPrice} setLaborPrice={setFlintlasticPrice} total={flintlasticTotal} />
              {/* Decking with thickness + type selectors */}
              <MLRow
                label={<>
                  <span>Decking</span>
                  <Select value={deckingThickness} onValueChange={setDeckingThickness}>
                    <SelectTrigger className="text-xs h-6 px-2 w-20 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DECKING_THICKNESSES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={deckingType} onValueChange={setDeckingType}>
                    <SelectTrigger className="text-xs h-6 px-2 w-20 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DECKING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </>}
                qty={deckingQty} setQty={setDeckingQty} unit="Sheet"
                materialPrice={deckingMaterialPrice} setMaterialPrice={setDeckingMaterialPrice}
                laborPrice={deckingPrice} setLaborPrice={setDeckingPrice} total={deckingTotal}
              />

              {/* Shop Supplies & Fees — admin-only, hidden from Sales entirely.
                  Quantities are all formula-derived (read-only); only the
                  $/unit rates are editable. Replaces the old flat misc amount. */}
              <Separator className="my-2" />
              <GroupLabel>Shop Supplies & Fees</GroupLabel>
              {coilNailsQty > 0 && (
                <ARow label="Coil Nails" qty={String(coilNailsQty)} setQty={() => {}} unit="Box"
                  price={coilNailsPrice} setPrice={setCoilNailsPrice} total={coilNailsTotal} readonlyQty />
              )}
              {feltNailsQty > 0 && (
                <ARow label="Felt Nails (button caps)" qty={String(feltNailsQty)} setQty={() => {}} unit="Bucket"
                  price={feltNailsPrice} setPrice={setFeltNailsPrice} total={feltNailsTotal} readonlyQty />
              )}
              <ARow label="Caulk" qty={String(caulkQty)} setQty={() => {}} unit="Tube"
                price={caulkPrice} setPrice={setCaulkPrice} total={caulkTotal} readonlyQty />
              <ARow label="Paint" qty={String(paintQty)} setQty={() => {}} unit="Can"
                price={paintPrice} setPrice={setPaintPrice} total={paintTotal} readonlyQty />
              <ARow label="Delivery Fee" qty="1" setQty={() => {}} unit="Order"
                price={deliveryFeePrice} setPrice={setDeliveryFeePrice} total={deliveryFeeTotal} readonlyQty />
              {reportSource && (
                <ARow label={`Measurement Report (${REPORT_SOURCE_LABELS[reportSource]})`} qty="1" setQty={() => {}} unit="Report"
                  price={reportSource === "gaf" ? gafReportPrice : reportSource === "roofr" ? roofrReportPrice : eagleviewReportPrice}
                  setPrice={reportSource === "gaf" ? setGafReportPrice : reportSource === "roofr" ? setRoofrReportPrice : setEagleviewReportPrice}
                  total={reportCostTotal} readonlyQty />
              )}
              {isCityJob && (
                <ARow label="City Permit Fee" qty="1" setQty={() => {}} unit="Job"
                  price={cityFeeAmount} setPrice={setCityFeeAmount} total={cityFeeTotal} readonlyQty />
              )}

              {/* Referral Fee — admin view */}
              <Separator className="my-2" />
              <GroupLabel>Referral</GroupLabel>
              <div className="grid grid-cols-12 gap-2 items-center mb-1">
                <div className="col-span-4 text-sm font-medium">Referral Fee</div>
                <div className="col-span-5">
                  <div className="flex gap-1">
                    {([0, 100, 200] as const).map(amt => (
                      <button key={amt} type="button" onClick={() => setReferralFee(amt)}
                        className={`flex-1 rounded py-1 text-xs font-medium border transition-colors ${
                          referralFee === amt
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border text-foreground hover:bg-muted"
                        }`}>
                        {amt === 0 ? "None" : `$${amt}`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-3 text-right text-sm font-semibold">{referralFee > 0 ? fmt(referralFee) : "—"}</div>
              </div>
              {referralFee > 0 && (
                <div className="grid grid-cols-12 gap-2 items-center mb-2">
                  <div className="col-span-4 text-sm text-muted-foreground">Referral Name</div>
                  <div className="col-span-8">
                    <Input value={referralName} onChange={e => setReferralName(e.target.value)} placeholder="Referral's name..." className="text-sm h-8" />
                  </div>
                </div>
              )}

              {/* Hidden misc — truly invisible in DOM, just used in calculation */}
            </div>

            {/* Pricing Breakdown */}
            <div className="section-card">
              <div className="section-header">Pricing Breakdown</div>

              {/* Markup rate input */}
              <div className="mb-3">
                <Label className="text-xs mb-1 block">Markup %</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={markupRateInput}
                    onChange={e => setMarkupRateInput(e.target.value)}
                    className="text-sm w-24 h-8"
                  />
                  <span className="text-sm text-muted-foreground">% &nbsp;(default {DEFAULT_MARKUP_RATE * 100}%)</span>
                </div>
              </div>

              {/* Material Tax rate input — applied to every Material $/unit above */}
              <div className="mb-3">
                <Label className="text-xs mb-1 block">Material Tax %</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={materialTaxRateInput}
                    onChange={e => setMaterialTaxRateInput(e.target.value)}
                    className="text-sm w-24 h-8"
                  />
                  <span className="text-sm text-muted-foreground">% &nbsp;(applied to Material $/unit only, not Labor)</span>
                </div>
              </div>

              {/* Lead type selector also available in admin */}
              <div className="mb-3">
                <Label className="text-xs mb-1 block">Commission Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setLeadType("office")}
                    className={`rounded-md py-1.5 px-3 text-sm font-medium border transition-colors ${leadType === "office" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground hover:bg-muted"}`}>
                    Office Lead (10%)
                  </button>
                  <button type="button" onClick={() => setLeadType("self")}
                    className={`rounded-md py-1.5 px-3 text-sm font-medium border transition-colors ${leadType === "self" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground hover:bg-muted"}`}>
                    Self-Generated (14%)
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">A — Total Raw Costs (incl. overhead)</span><span className="font-semibold">{fmtBig(A)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">B — Markup (A × {(markupRate * 100).toFixed(0)}%)</span><span className="font-semibold">{fmtBig(B)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Margin (Total − Costs − Commission)</span><span className="font-semibold">{fmtBig(marginDollar)} <span className="text-muted-foreground font-normal">({marginPercent.toFixed(1)}% of Total)</span></span></div>
                <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">E — Subtotal Before Commission (A + B)</span><span className="font-semibold">{fmtBig(E)}</span></div>
                <Separator />
                <div className="flex justify-between text-lg font-bold"><span>Total Price</span><span className="text-primary">{fmtBig(grandTotal)}</span></div>
                <div className="flex justify-between text-green-700 dark:text-green-400">
                  <span>F — Commission ({leadType === "office" ? "10%" : "14%"} of Total)</span>
                  <span className="font-semibold">{fmtBig(F)}</span>
                </div>
              </div>

              {(num(rakesQty) > 0 || num(eavesQty) > 0 || totalWithWaste > 0 || skylights.length > 0) && (
                <>
                  <Separator className="my-3" />
                  <div className="text-xs font-bold text-primary uppercase tracking-wide mb-2">Base Roof vs. Optional Add-Ons</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Base Roof — Total Price</span><span className="font-semibold">{fmtBig(baseTotal)}</span></div>
                    <div className="flex justify-between text-muted-foreground text-xs"><span>Price per Square ({totalSqForPrice.toFixed(2)} SQ)</span><span className="font-semibold">{pricePerSq > 0 ? fmtBig(pricePerSq) + "/SQ" : "—"}</span></div>
                    <div className="flex justify-between text-green-700 dark:text-green-400"><span className="text-xs">Base Roof — Commission</span><span className="font-semibold">{fmtBig(baseCommission)}</span></div>
                    <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">Add-Ons (Rakes, Eaves, {PREMIUM_SHINGLE_BY_BRAND[brand]}, 4-Star Warranty, Skylights) — Total Price</span><span className="font-semibold">{fmtBig(addOnsTotal)}</span></div>
                    {num(rakesQty) > 0 && (
                      <div className="flex justify-between items-center text-xs text-muted-foreground pl-3 gap-2">
                        <span className="flex items-center gap-1">
                          <Checkbox checked={includeRakes} onCheckedChange={v => setIncludeRakes(!!v)} className="mr-1" />
                          — Rakes
                        </span>
                        <span className="whitespace-nowrap">{fmtBig(salesPrice(rakesTotal))} (commission {fmtBig(itemCommission(rakesTotal))})</span>
                      </div>
                    )}
                    {num(eavesQty) > 0 && (
                      <div className="flex justify-between items-center text-xs text-muted-foreground pl-3 gap-2">
                        <span className="flex items-center gap-1">
                          <Checkbox checked={includeEaves} onCheckedChange={v => setIncludeEaves(!!v)} className="mr-1" />
                          — Eaves
                        </span>
                        <span className="whitespace-nowrap">{fmtBig(salesPrice(eavesTotal))} (commission {fmtBig(itemCommission(eavesTotal))})</span>
                      </div>
                    )}
                    {totalWithWaste > 0 && (
                      <div className="flex justify-between items-center text-xs text-muted-foreground pl-3 gap-2">
                        <span className="flex items-center gap-1 flex-wrap">
                          <Checkbox checked={includePremiumShingle} onCheckedChange={v => setIncludePremiumShingle(!!v)} className="mr-1" />
                          {PREMIUM_SHINGLE_BY_BRAND[brand]} ({totalWithWaste.toFixed(2)} SQ × $
                          <Input type="number" min="0" step="0.01" value={premiumShinglePrice} onChange={e => setPremiumShinglePrice(e.target.value)} className="h-5 w-14 text-xs px-1 inline-block" />
                          /SQ)
                        </span>
                        <span className="whitespace-nowrap">{fmtBig(salesPrice(premiumShingleTotal))} (commission {fmtBig(itemCommission(premiumShingleTotal))})</span>
                      </div>
                    )}
                    {totalWithWaste > 0 && (
                      <div className="flex justify-between items-center text-xs text-muted-foreground pl-3 gap-2">
                        <span className="flex items-center gap-1 flex-wrap">
                          <Checkbox checked={includeFourStarWarranty} onCheckedChange={v => setIncludeFourStarWarranty(!!v)} className="mr-1" />
                          4-Star Warranty ({totalSqForPrice.toFixed(2)} SQ × $
                          <Input type="number" min="0" step="0.01" value={fourStarWarrantyPrice} onChange={e => setFourStarWarrantyPrice(e.target.value)} className="h-5 w-14 text-xs px-1 inline-block" />
                          /SQ)
                        </span>
                        <span className="whitespace-nowrap">{fmtBig(salesPrice(fourStarWarrantyTotal))} (commission {fmtBig(itemCommission(fourStarWarrantyTotal))})</span>
                      </div>
                    )}
                    {skylights.length > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground pl-3">
                        <span>— Skylights ({skylights.reduce((s, sk) => s + sk.qty, 0)} EA)</span>
                        <span>{fmtBig(salesPrice(skylightsTotal))} (commission {fmtBig(itemCommission(skylightsTotal))})</span>
                      </div>
                    )}
                    <div className="flex justify-between text-green-700 dark:text-green-400"><span className="text-xs">Add-Ons — Commission</span><span className="font-semibold">{fmtBig(addOnsCommission)}</span></div>
                  </div>
                </>
              )}
            </div>

            <div className="section-card">
              <div className="section-header">Notes</div>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." rows={3} />
            </div>

            <div className="flex justify-end pb-8">
              <Button onClick={() => saveMutation.mutate(buildPayload())} disabled={saveMutation.isPending} size="lg" className="gap-2">
                <Save size={16} /> {saveMutation.isPending ? "Saving..." : "Save Estimate"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function ReportReviewRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={value ? "font-medium" : "text-muted-foreground italic"}>{value ?? "not found"}</span>
    </div>
  );
}

function ColHeaders() {
  return (
    <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-semibold text-muted-foreground border-b border-border pb-2">
      <div className="col-span-6">Item</div>
      <div className="col-span-3 text-center">Qty</div>
      <div className="col-span-1 text-center">Unit</div>
      <div className="col-span-2 text-right">Raw Cost</div>
    </div>
  );
}

function GroupLabel({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <div className={`text-xs font-bold text-muted-foreground uppercase tracking-wide ${noMargin ? "" : "mb-2 mt-1"}`}>
      {children}
    </div>
  );
}

function SalesGroupLabel({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <div className={`text-xs font-bold text-muted-foreground uppercase tracking-wide ${noMargin ? "" : "mb-2 mt-1"}`}>
      {children}
    </div>
  );
}

interface SalesQtyRowProps {
  label: string;
  qty: string;
  setQty: (v: string) => void;
  unit: string;
}

function SalesQtyRow({ label, qty, setQty, unit }: SalesQtyRowProps) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center mb-1">
      <div className="col-span-7 text-sm font-medium">{label}</div>
      <div className="col-span-3">
        <Input type="number" min="0" step="0.1" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" className="text-sm h-8" />
      </div>
      <div className="col-span-2 text-xs text-center text-muted-foreground">{unit}</div>
    </div>
  );
}

interface ARowProps {
  label: string;
  qty: string;
  setQty: (v: string) => void;
  unit: string;
  price: string;
  setPrice: (v: string) => void;
  total: number;
  readonlyQty?: boolean;
  readonlyPrice?: boolean;
  highlight?: boolean;
  prefilled?: boolean;
}

function ARow({ label, qty, setQty, unit, price, setPrice, total, readonlyQty, readonlyPrice, highlight, prefilled }: ARowProps) {
  const hasVal = num(qty) > 0;
  return (
    <div className={`grid grid-cols-12 gap-2 items-center mb-1 ${highlight ? "bg-blue-50 dark:bg-blue-950/20 rounded px-1" : ""}`}>
      <div className="col-span-4 text-sm font-medium flex items-center gap-1">
        {label}
        {prefilled && hasVal && <span className="text-xs text-muted-foreground">(auto)</span>}
      </div>
      <div className="col-span-2">
        <Input type="number" min="0" step="0.1" value={qty} onChange={e => !readonlyQty && setQty(e.target.value)}
          placeholder="0" className={`text-sm h-8 ${readonlyQty ? "bg-muted" : ""}`} readOnly={readonlyQty} />
      </div>
      <div className="col-span-1 text-xs text-center text-muted-foreground">{unit}</div>
      <div className="col-span-2">
        <Input type="number" min="0" step="0.01" value={price} onChange={e => !readonlyPrice && setPrice(e.target.value)}
          placeholder="0.00" className={`text-sm h-8 ${readonlyPrice ? "bg-muted" : ""}`} readOnly={readonlyPrice} />
      </div>
      <div className="col-span-3 text-right text-sm font-semibold">{fmt(total)}</div>
    </div>
  );
}

interface MLRowProps {
  label: React.ReactNode;
  qty: string;
  setQty: (v: string) => void;
  unit: string;
  materialPrice: string;
  setMaterialPrice: (v: string) => void;
  laborPrice: string;
  setLaborPrice: (v: string) => void;
  total: number;
  readonlyQty?: boolean;
  readonlyPrice?: boolean;
  prefilled?: boolean;
}

// Material/Labor row — same as ARow but splits $/Unit into an editable
// Material price (taxed by the estimate's Material Tax %) and Labor price.
function MLRow({ label, qty, setQty, unit, materialPrice, setMaterialPrice, laborPrice, setLaborPrice, total, readonlyQty, readonlyPrice, prefilled }: MLRowProps) {
  const hasVal = num(qty) > 0;
  return (
    <div className="mb-2 pb-2 border-b border-dashed border-border/60 last:border-0 last:mb-1 last:pb-0">
      <div className="grid grid-cols-12 gap-2 items-center">
        <div className="col-span-6 text-sm font-medium flex items-center gap-1 flex-wrap">
          {label}
          {prefilled && hasVal && <span className="text-xs text-muted-foreground">(auto)</span>}
        </div>
        <div className="col-span-3">
          <Input type="number" min="0" step="0.1" value={qty} onChange={e => !readonlyQty && setQty(e.target.value)}
            placeholder="0" className={`text-sm h-8 ${readonlyQty ? "bg-muted" : ""}`} readOnly={readonlyQty} />
        </div>
        <div className="col-span-1 text-xs text-center text-muted-foreground">{unit}</div>
        <div className="col-span-2 text-right text-sm font-semibold">{fmt(total)}</div>
      </div>
      <div className="flex items-center gap-3 mt-1">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="text-xs text-muted-foreground shrink-0">Material</span>
          <Input type="number" min="0" step="0.01" value={materialPrice} onChange={e => !readonlyPrice && setMaterialPrice(e.target.value)}
            placeholder="0.00" className={`text-sm h-7 ${readonlyPrice ? "bg-muted" : ""}`} readOnly={readonlyPrice} />
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="text-xs text-muted-foreground shrink-0">Labor</span>
          <Input type="number" min="0" step="0.01" value={laborPrice} onChange={e => !readonlyPrice && setLaborPrice(e.target.value)}
            placeholder="0.00" className={`text-sm h-7 ${readonlyPrice ? "bg-muted" : ""}`} readOnly={readonlyPrice} />
        </div>
      </div>
    </div>
  );
}
