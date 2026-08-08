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
import { ChevronLeft, Save, Eye, EyeOff, Plus, Trash2, Printer, Upload } from "lucide-react";
import type { Estimate, SkylightItem, ChimneyItem, PriceDefaults } from "@shared/schema";
import { ALL_VELUX_MODELS, SKYLIGHT_INSTALL_COST, SKYLIGHT_FLASHING_COST } from "@/lib/velux";

// GAF QuickMeasure "Full Report" PDF import — matches server/gafParser.ts's output
interface GafReportData {
  address: string | null;
  roofAreaSqFt: number | null;
  roofFacets: number | null;
  pitch: string | null;
  eavesFt: number | null;
  hipsFt: number | null;
  rakesFt: number | null;
  ridgesFt: number | null;
  valleysFt: number | null;
  dripEdgeFt: number | null;
  leakBarrierFt: number | null;
  ridgeCapFt: number | null;
  starterFt: number | null;
}

// ─── Pricing model ────────────────────────────────────────────────────────────
// A     = raw material costs + hidden misc $220
// B     = A × 0.40  (markup)
// E     = A + B     (subtotal before commission)
// Total = E / (1 - commission rate)   → commission is X% of Total
// F     = Total × commission rate

const DEFAULT_MARKUP_RATE = 0.40;
const COMMISSION_OFFICE = 0.10;
const COMMISSION_SELF   = 0.14;
const MISC_AMOUNT       = 220; // $200 overhead + $20 EagleView — always hidden

const PITCHES = ["3/12","4/12","5/12","6/12","7/12","8/12","9/12","10/12","11/12","12/12","13/12","14/12"];

// Steep pitch adder: $5/SQ for each increment above 8/12
// e.g. 9/12 → +$5, 10/12 → +$10, 12/12 → +$20, etc.
function pitchAdderPerSq(pitch: string): number {
  const n = parseInt(pitch.split("/")[0], 10);
  return n > 8 ? (n - 8) * 5 : 0;
}
const DRIP_EDGE_COLORS = ["White","Black","Brown","Almond","Mill Finish"];
const SHINGLE_TYPES = ["Landmark","Landmark PRO"];
const DECKING_THICKNESSES = ["7/16\"","15/32\"","19/32\"","23/32\""];
const DECKING_TYPES = ["Plywood","OSB"];

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
  proUpcharge:  20,
  stepFlashing: 4.82,    // 1.75+1.07+2
  trimCoil:     3.14,    // 2*1.07+1  (note: spreadsheet has 3.14, not 5.21)
  pipeBoot:     12.84,   // 12*1.07
  decking:      40.00,   // 25+15
};

const CHIMNEY_SIZES: { value: "small" | "average" | "large"; label: string }[] = [
  { value: "small",   label: "Small (up to 24\"x24\")" },
  { value: "average", label: "Average (up to 24\"x48\")" },
  { value: "large",   label: "Large (bigger than 24\"x48\")" },
];
const CHIMNEY_PRICES: Record<"small" | "average" | "large", number> = { small: 200, average: 300, large: 400 };

function fmt(v: number) {
  if (!v || v === 0) return "—";
  return "$" + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
  const [materialTaxRateInput, setMaterialTaxRateInput] = useState("0");
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
  const [wastePercent, setWastePercent] = useState("15");
  const [layersToRemove, setLayersToRemove] = useState("1");

  const totalRawSq = sections.reduce((s, sec) => s + num(sec.squares), 0);
  const wasteMultiplier = 1 + num(wastePercent) / 100;
  const totalWithWaste = roundUpToThird(totalRawSq * wasteMultiplier);

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

  const [dripEdgeQty, setDripEdgeQty] = useState("");
  const [dripEdgeColor, setDripEdgeColor] = useState("White");
  const [dripEdgePrice, setDripEdgePrice] = useState((DE_PIECE_COST / DE_PIECE_LF).toFixed(4));
  const [dripEdgeMaterialPrice, setDripEdgeMaterialPrice] = useState("0");

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

  const [deckingQty, setDeckingQty] = useState("");
  const [deckingPrice, setDeckingPrice] = useState(String(D.decking));
  const [deckingMaterialPrice, setDeckingMaterialPrice] = useState("0");
  const [deckingThickness, setDeckingThickness] = useState("7/16\"");
  const [deckingType, setDeckingType] = useState("OSB");

  const [flintlasticQty, setFlintlasticQty] = useState("");
  const [flintlasticPrice, setFlintlasticPrice] = useState("301");
  const [flintlasticMaterialPrice, setFlintlasticMaterialPrice] = useState("0");

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
  const landmarkProUpcharge = shingleType === "Landmark PRO" ? D.proUpcharge : 0;

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

  const shingleTotal      = costOf(num(shingleQty), num(shingleMaterialPrice), num(shinglePrice));
  const landmarkProTotal  = num(shingleQty) * landmarkProUpcharge;
  const underlayTotal     = costOf(num(underlaymentQty), num(underlaymentMaterialPrice), num(underlaymentPrice));
  const starterTotal      = costOf(num(starterQty), num(starterMaterialPrice), num(starterPrice));
  const ridgeCapTotal     = costOf(num(ridgeCapQty), num(ridgeCapMaterialPrice), num(ridgeCapPrice));
  const iceWaterTotal     = costOf(num(iceWaterQty), num(iceWaterMaterialPrice), num(iceWaterPrice));
  const dripEdgeTotal     = costOf(num(dripEdgeQty), num(dripEdgeMaterialPrice), num(dripEdgePrice));
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
  const layersRate  = 30 * Math.max(0, num(layersToRemove) - 1);
  const layersTotal = totalWithWaste * layersRate;

  // ─── Markup model ─────────────────────────────────────────────────────────
  const A = shingleTotal + landmarkProTotal + steepPitchAdderTotal + underlayTotal + starterTotal +
    ridgeCapTotal + iceWaterTotal + dripEdgeTotal + stepFlashTotal +
    trimCoilTotal + pipeBootsTotal + chimneysTotal + stationaryVentsTotal + powerVentsTotal + solarVentsTotal + skylightsTotal +
    ridgeVentTotal + deckingTotal + flintlasticTotal + layersTotal + referralFee + MISC_AMOUNT;
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
  // Price per SQ denominator includes starter & hip & ridge bundles (3 bundles = 1 SQ)
  const starterBundles  = roundUp(num(starterQty) / ST_BUNDLE_LF);
  const hipRidgeBundles = roundUp(num(ridgeCapQty) / HR_BUNDLE_LF);
  const accessorySq     = (starterBundles + hipRidgeBundles) / 3;
  const totalSqForPrice = totalWithWaste + accessorySq;
  // Skylights are a one-off add-on, not part of the roof itself — exclude
  // their (marked-up) price from the per-square figure.
  const pricePerSq = totalSqForPrice > 0 ? (grandTotal - salesPrice(skylightsTotal)) / totalSqForPrice : 0;

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

  // ─── Optional Add-Ons breakout (Drip Edge + Skylights) ───────────────────
  // Same markup % and commission % as the base roof — just split into two
  // buckets instead of one, so baseTotal + addOnsTotal === grandTotal exactly.
  const addOnsRaw = dripEdgeTotal + skylightsTotal;
  const baseRaw = A - addOnsRaw;
  const baseSubtotal = baseRaw * (1 + markupRate);
  const baseTotal = baseSubtotal / (1 - commissionRate);
  const baseCommission = baseTotal * commissionRate;
  const addOnsSubtotal = addOnsRaw * (1 + markupRate);
  const addOnsTotal = addOnsSubtotal / (1 - commissionRate);
  const addOnsCommission = addOnsTotal * commissionRate;

  const isAdmin = role === "admin" && canSeeAdminView;

  // ─── Section helpers ──────────────────────────────────────────────────────
  const addSection = () => { if (sections.length < 3) setSections([...sections, { squares: "", pitch: "6/12" }]); };
  const removeSection = (i: number) => { if (sections.length > 1) setSections(sections.filter((_, idx) => idx !== i)); };
  const updateSection = (i: number, field: "squares" | "pitch", val: string) =>
    setSections(sections.map((s, idx) => idx === i ? { ...s, [field]: val } : s));

  // ─── GAF QuickMeasure report import ───────────────────────────────────────
  const gafFileInputRef = useRef<HTMLInputElement>(null);
  const [gafDialogOpen, setGafDialogOpen] = useState(false);
  const [gafData, setGafData] = useState<GafReportData | null>(null);
  const [gafLoading, setGafLoading] = useState(false);

  const triggerGafImport = () => gafFileInputRef.current?.click();

  const handleGafFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setGafLoading(true);
    try {
      const formData = new FormData();
      formData.append("report", file);
      const res = await fetch("/api/parse-gaf-report", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}) as any);
        throw new Error(err.error || "Failed to parse report");
      }
      const data: GafReportData = await res.json();
      setGafData(data);
      setGafDialogOpen(true);
    } catch (err: any) {
      toast({ title: "Import failed", description: err?.message || "Could not read that PDF.", variant: "destructive" });
    } finally {
      setGafLoading(false);
    }
  };

  const applyGafData = () => {
    if (!gafData) return;
    if (gafData.address) setCustomerAddress(gafData.address);
    if (gafData.roofAreaSqFt != null) {
      const squares = (gafData.roofAreaSqFt / 100).toFixed(2);
      const pitch = gafData.pitch && PITCHES.includes(gafData.pitch) ? gafData.pitch : sections[0]?.pitch;
      setSections(prev => {
        const next = [...prev];
        next[0] = { ...next[0], squares, pitch: pitch || next[0].pitch };
        return next;
      });
    }
    if (gafData.dripEdgeFt != null) setDripEdgeQty(String(gafData.dripEdgeFt));
    if (gafData.leakBarrierFt != null) setIceWaterQty(String(gafData.leakBarrierFt));
    if (gafData.ridgeCapFt != null) setRidgeCapQty(String(gafData.ridgeCapFt));
    if (gafData.starterFt != null) setStarterQty(String(gafData.starterFt));
    setGafDialogOpen(false);
    toast({ title: "Imported from GAF report", description: "Roof measurements applied." });
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

  // Prefill a brand-new estimate's material/labor prices from the shared
  // price book, so the last admin's edits carry forward automatically.
  // Existing estimates keep whatever was saved with them (handled below).
  useEffect(() => {
    if (!isNew || !priceDefaults) return;
    const set = (v: number | null | undefined, setter: (s: string) => void) => {
      if (v !== null && v !== undefined) setter(String(v));
    };
    set(priceDefaults.shinglePricePerSq, setShinglePrice);
    set(priceDefaults.shingleMaterialPricePerSq, setShingleMaterialPrice);
    set(priceDefaults.underlaymentPricePerSq, setUnderlaymentPrice);
    set(priceDefaults.underlaymentMaterialPricePerSq, setUnderlaymentMaterialPrice);
    set(priceDefaults.starterPricePerUnit, setStarterPrice);
    set(priceDefaults.starterMaterialPricePerUnit, setStarterMaterialPrice);
    set(priceDefaults.ridgeCapPricePerUnit, setRidgeCapPrice);
    set(priceDefaults.ridgeCapMaterialPricePerUnit, setRidgeCapMaterialPrice);
    set(priceDefaults.iceWaterPricePerUnit, setIceWaterPrice);
    set(priceDefaults.iceWaterMaterialPricePerUnit, setIceWaterMaterialPrice);
    set(priceDefaults.dripEdgePricePerUnit, setDripEdgePrice);
    set(priceDefaults.dripEdgeMaterialPricePerUnit, setDripEdgeMaterialPrice);
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
  }, [isNew, priceDefaults]);

  useEffect(() => {
    if (!existingEstimate) return;
    setCustomerName(existingEstimate.customerName || "");
    setCustomerAddress(existingEstimate.customerAddress || "");
    setCustomerPhone(existingEstimate.customerPhone || "");
    setCustomerEmail(existingEstimate.customerEmail || "");
    setNotes(existingEstimate.notes || "");
    setWastePercent(String(existingEstimate.wastePercent ?? 15));
    setMaterialTaxRateInput(String(existingEstimate.materialTaxRate ?? 0));
    setLayersToRemove(String(existingEstimate.layersToRemove ?? 1));
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
    setDripEdgeQty(String(existingEstimate.dripEdgeQty ?? ""));
    setDripEdgeColor(existingEstimate.dripEdgeColor || "White");
    setDripEdgePrice(String(existingEstimate.dripEdgePricePerUnit ?? (DE_PIECE_COST / DE_PIECE_LF).toFixed(4)));
    setDripEdgeMaterialPrice(String(existingEstimate.dripEdgeMaterialPricePerUnit ?? 0));
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
    if (existingEstimate.referralFee === 100 || existingEstimate.referralFee === 200) {
      setReferralFee(existingEstimate.referralFee);
    } else {
      setReferralFee(0);
    }
    setReferralName(existingEstimate.referralName || "");
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
    layersToRemove: num(layersToRemove) || 1,
    layersQty: totalWithWaste || null,
    layersPricePerUnit: layersRate,
    shingleType, shingleColor: shingleColor || null,
    shingleQty: num(shingleQty) || null,
    shinglePricePerSq: num(shinglePrice),
    shingleMaterialPricePerSq: num(shingleMaterialPrice),
    landmarkProUpcharge,
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
    dripEdgeQty: num(dripEdgeQty) || null,
    dripEdgeColor,
    dripEdgePricePerUnit: num(dripEdgePrice),
    dripEdgeMaterialPricePerUnit: num(dripEdgeMaterialPrice),
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
    referralFee: referralFee || null,
    referralName: referralName || null,
    miscAmount: MISC_AMOUNT,
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
      <input ref={gafFileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleGafFileChange} />
      <Dialog open={gafDialogOpen} onOpenChange={setGafDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import from GAF Report</DialogTitle>
            <DialogDescription>Review the values found before applying them to this estimate.</DialogDescription>
          </DialogHeader>
          {gafData && (
            <div className="text-sm">
              <GafReviewRow label="Job Address" value={gafData.address} />
              <GafReviewRow label="Squares (Roof Area)" value={gafData.roofAreaSqFt != null ? `${(gafData.roofAreaSqFt / 100).toFixed(2)} SQ (${gafData.roofAreaSqFt.toLocaleString()} sq ft)` : null} />
              <GafReviewRow label="Pitch" value={gafData.pitch} />
              <GafReviewRow label="Drip Edge (eaves + rakes)" value={gafData.dripEdgeFt != null ? `${gafData.dripEdgeFt.toLocaleString()} FT` : null} />
              <GafReviewRow label="Ice & Water Shield (leak barrier)" value={gafData.leakBarrierFt != null ? `${gafData.leakBarrierFt.toLocaleString()} FT` : null} />
              <GafReviewRow label="Hip & Ridge (ridge cap)" value={gafData.ridgeCapFt != null ? `${gafData.ridgeCapFt.toLocaleString()} FT` : null} />
              <GafReviewRow label="Starter Strip" value={gafData.starterFt != null ? `${gafData.starterFt.toLocaleString()} FT` : null} />
              <p className="text-xs text-muted-foreground pt-3">
                Waste % isn't set automatically — the report's suggested waste factor can't be read reliably from the PDF, so double-check it manually. This will overwrite the Address field, Section 1's squares/pitch, and the Drip Edge, Ice & Water, Hip & Ridge, and Starter Strip quantities above.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGafDialogOpen(false)}>Cancel</Button>
            <Button onClick={applyGafData}>Apply to Estimate</Button>
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
            </div>

            {/* Roof Measurements */}
            <div className="section-card">
              <div className="section-header flex items-center justify-between">
                <span>Roof Measurements</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={triggerGafImport} disabled={gafLoading} className="gap-1 text-xs h-7 print:hidden">
                    <Upload size={12} /> {gafLoading ? "Importing..." : "Import GAF Report"}
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
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Waste %</Label>
                    <Input type="number" min="0" max="50" value={wastePercent} onChange={e => setWastePercent(e.target.value)} className="text-sm w-16" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Layers to Remove</Label>
                    <Input type="number" min="1" step="1" value={layersToRemove} onChange={e => setLayersToRemove(e.target.value)} className="text-sm w-16" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Raw SQ:</span><span className="font-semibold">{totalRawSq.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">With waste:</span><span className="font-bold text-primary">{totalWithWaste.toFixed(2)} SQ</span></div>
                </div>
              </div>
            </div>

            {/* Materials — quantities only, no prices */}
            <div className="section-card">
              <div className="section-header">Materials — Quantities</div>
              <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-semibold text-muted-foreground border-b border-border pb-2">
                <div className="col-span-7">Item</div>
                <div className="col-span-3 text-center">Qty</div>
                <div className="col-span-2 text-center">Unit</div>
              </div>

              <SalesGroupLabel>Shingles</SalesGroupLabel>
              {/* Shingle type / color */}
              <div className="grid grid-cols-12 gap-2 items-center mb-2">
                <div className="col-span-7 text-sm font-medium">Shingle Type</div>
                <div className="col-span-5">
                  <Select value={shingleType} onValueChange={setShingleType}>
                    <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{SHINGLE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-12 gap-2 items-center mb-2">
                <div className="col-span-7 text-sm font-medium">Color</div>
                <div className="col-span-5">
                  <Input value={shingleColor} onChange={e => setShingleColor(e.target.value)} placeholder="Color..." className="text-sm h-8" />
                </div>
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
              {/* Drip Edge with color selector */}
              <div className="grid grid-cols-12 gap-2 items-center mb-1">
                <div className="col-span-7 text-sm font-medium flex items-center gap-1 flex-wrap">
                  <span>Drip Edge</span>
                  <Select value={dripEdgeColor} onValueChange={setDripEdgeColor}>
                    <SelectTrigger className="text-xs h-6 px-2 w-28 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DRIP_EDGE_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input type="number" min="0" value={dripEdgeQty} onChange={e => setDripEdgeQty(e.target.value)} placeholder="0" className="text-sm h-8" />
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

                {/* Optional Add-Ons — Drip Edge & Skylights, same markup/commission rates as the base roof */}
                {(dripEdgeTotal > 0 || skylights.length > 0) && (
                  <div className="border border-primary/30 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-bold text-primary uppercase tracking-wide">Optional Add-Ons</div>
                    {dripEdgeTotal > 0 && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-foreground">Drip Edge</div>
                          <div className="text-xs text-muted-foreground">{num(dripEdgeQty)} FT — {dripEdgeColor} · commission {fmtBig(itemCommission(dripEdgeTotal))}</div>
                        </div>
                        <span className="text-lg font-bold text-foreground">{fmtBig(salesPrice(dripEdgeTotal))}</span>
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
                      {(dripEdgeTotal > 0 || skylights.length > 0) && ` (Base ${fmtBig(baseCommission)} + Add-Ons ${fmtBig(addOnsCommission)})`}
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="sales-commission">{fmtBig(F)}</span>
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
            </div>

            {/* Roof Measurements */}
            <div className="section-card">
              <div className="section-header flex items-center justify-between">
                <span>Roof Measurements</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={triggerGafImport} disabled={gafLoading} className="gap-1 text-xs h-7 print:hidden">
                    <Upload size={12} /> {gafLoading ? "Importing..." : "Import GAF Report"}
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
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Waste %</Label>
                    <Input type="number" min="0" max="50" value={wastePercent} onChange={e => setWastePercent(e.target.value)} className="text-sm w-16" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Layers to Remove</Label>
                    <Input type="number" min="1" step="1" value={layersToRemove} onChange={e => setLayersToRemove(e.target.value)} className="text-sm w-16" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Raw SQ:</span><span className="font-semibold">{totalRawSq.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">With waste ({wastePercent}%):</span><span className="font-bold text-primary">{totalWithWaste.toFixed(2)} SQ</span></div>
                </div>
              </div>
            </div>

            {/* Materials Table */}
            <div className="section-card">
              <div className="section-header">Materials & Costs</div>
              <ColHeaders />

              {/* Shingles */}
              <GroupLabel>Shingles</GroupLabel>
              <div className="grid grid-cols-12 gap-2 items-center mb-2">
                <div className="col-span-4 text-sm font-medium">Shingle Type</div>
                <div className="col-span-4">
                  <Select value={shingleType} onValueChange={setShingleType}>
                    <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{SHINGLE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-4">
                  <Input value={shingleColor} onChange={e => setShingleColor(e.target.value)} placeholder="Color..." className="text-sm h-8" />
                </div>
              </div>
              <MLRow label={shingleType} qty={shingleQty} setQty={setShingleQty} unit="SQ" materialPrice={shingleMaterialPrice} setMaterialPrice={setShingleMaterialPrice} laborPrice={shinglePrice} setLaborPrice={setShinglePrice} total={shingleTotal} />
              {shingleType === "Landmark PRO" && (
                <ARow label="Landmark PRO (+$20/SQ)" qty={shingleQty} setQty={() => {}} unit="SQ" price={String(D.proUpcharge)} setPrice={() => {}} total={landmarkProTotal} readonlyQty readonlyPrice highlight />
              )}
              {steepPitchAdderTotal > 0 && (
                <ARow label={`Steep Pitch (+$${totalSteepAdderPerSq.toFixed(0)}/SQ)`} qty={shingleQty} setQty={() => {}} unit="SQ" price={totalSteepAdderPerSq.toFixed(2)} setPrice={() => {}} total={steepPitchAdderTotal} readonlyQty readonlyPrice highlight />
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
                  <span>Drip Edge</span>
                  <Select value={dripEdgeColor} onValueChange={setDripEdgeColor}>
                    <SelectTrigger className="text-xs h-6 px-2 w-28 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DRIP_EDGE_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </>}
                qty={dripEdgeQty} setQty={setDripEdgeQty} unit="FT"
                materialPrice={dripEdgeMaterialPrice} setMaterialPrice={setDripEdgeMaterialPrice}
                laborPrice={dripEdgePrice} setLaborPrice={setDripEdgePrice} total={dripEdgeTotal}
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
                  <span className="text-sm text-muted-foreground">% &nbsp;(default 40%)</span>
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
                <div className="flex justify-between text-muted-foreground text-xs"><span>Price per Square ({totalSqForPrice.toFixed(2)} SQ)</span><span className="font-semibold">{pricePerSq > 0 ? fmtBig(pricePerSq) + "/SQ" : "—"}</span></div>
              </div>

              {(dripEdgeTotal > 0 || skylights.length > 0) && (
                <>
                  <Separator className="my-3" />
                  <div className="text-xs font-bold text-primary uppercase tracking-wide mb-2">Base Roof vs. Optional Add-Ons</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Base Roof — Total Price</span><span className="font-semibold">{fmtBig(baseTotal)}</span></div>
                    <div className="flex justify-between text-green-700 dark:text-green-400"><span className="text-xs">Base Roof — Commission</span><span className="font-semibold">{fmtBig(baseCommission)}</span></div>
                    <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">Add-Ons (Drip Edge + Skylights) — Total Price</span><span className="font-semibold">{fmtBig(addOnsTotal)}</span></div>
                    {dripEdgeTotal > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground pl-3">
                        <span>— Drip Edge</span>
                        <span>{fmtBig(salesPrice(dripEdgeTotal))} (commission {fmtBig(itemCommission(dripEdgeTotal))})</span>
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

function GafReviewRow({ label, value }: { label: string; value: string | null }) {
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
  prefilled?: boolean;
}

// Material/Labor row — same as ARow but splits $/Unit into an editable
// Material price (taxed by the estimate's Material Tax %) and Labor price.
function MLRow({ label, qty, setQty, unit, materialPrice, setMaterialPrice, laborPrice, setLaborPrice, total, readonlyQty, prefilled }: MLRowProps) {
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
          <Input type="number" min="0" step="0.01" value={materialPrice} onChange={e => setMaterialPrice(e.target.value)} placeholder="0.00" className="text-sm h-7" />
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="text-xs text-muted-foreground shrink-0">Labor</span>
          <Input type="number" min="0" step="0.01" value={laborPrice} onChange={e => setLaborPrice(e.target.value)} placeholder="0.00" className="text-sm h-7" />
        </div>
      </div>
    </div>
  );
}
