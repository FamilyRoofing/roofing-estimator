import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChevronLeft, Save, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { Estimate, SkylightItem } from "@shared/schema";
import { ALL_VELUX_MODELS, SKYLIGHT_INSTALL_COST, SKYLIGHT_FLASHING_COST } from "@/lib/velux";

// ─── Pricing model ────────────────────────────────────────────────────────────
// A     = raw material costs + hidden misc $220
// B     = A × 0.40  (markup)
// E     = A + B     (subtotal before commission)
// Total = E / (1 - commission rate)   → commission is X% of Total
// F     = Total × commission rate

const DEFAULT_MARKUP_RATE = 0.40;
const COMMISSION_OFFICE = 0.10;
const COMMISSION_SELF   = 0.12;
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

// Hip & Ridge: 25 lf/bundle, bundle cost = 68*1.07+25
const HR_BUNDLE_LF   = 25;
const HR_BUNDLE_COST = 68 * 1.07 + 25;   // $97.76
function hipRidgeTotal(ft: number) {
  if (ft <= 0) return 0;
  return roundUp(ft / HR_BUNDLE_LF) * HR_BUNDLE_COST;
}

// Starter Strip: 116 lf/bundle, bundle cost = 58*1.07+25
const ST_BUNDLE_LF   = 116;
const ST_BUNDLE_COST = 58 * 1.07 + 25;   // $87.06
function starterTotal2(ft: number) {
  if (ft <= 0) return 0;
  return roundUp(ft / ST_BUNDLE_LF) * ST_BUNDLE_COST;
}

// Synthetic Underlayment: 10 SQ/roll, roll cost = 70*1.07+10
const UL_ROLL_SQ   = 10;
const UL_ROLL_COST = 70 * 1.07 + 10;     // $84.90
function underlayTotal2(sq: number) {
  if (sq <= 0) return 0;
  return roundUp(sq / UL_ROLL_SQ) * UL_ROLL_COST;
}

// Ice & Water Shield: 66 lf/roll (= 2 SQ), roll cost = 70*1.07+10
const IW_ROLL_LF   = 66;
const IW_ROLL_COST = 70 * 1.07 + 10;     // $84.90
function iceWaterTotal2(ft: number) {
  if (ft <= 0) return 0;
  return roundUp(ft / IW_ROLL_LF) * IW_ROLL_COST;
}

// Drip Edge: 10 lf/piece, piece cost = 10*1.07+10
const DE_PIECE_LF   = 10;
const DE_PIECE_COST = 10 * 1.07 + 10;    // $20.70
function dripEdgeTotal2(ft: number) {
  if (ft <= 0) return 0;
  return roundUp(ft / DE_PIECE_LF) * DE_PIECE_COST;
}

// Ridge Vent: 4 lf/piece, piece cost = 9.25*1.07+4
const RV_PIECE_LF   = 4;
const RV_PIECE_COST = 9.25 * 1.07 + 4;   // $13.8975
function ridgeVentTotal2(ft: number) {
  if (ft <= 0) return 0;
  return roundUp(ft / RV_PIECE_LF) * RV_PIECE_COST;
}

// Fixed per-unit items (no bundling logic needed)
const D = {
  shingle:      193.56,  // up to 8/12: 70+108*1.07+8
  proUpcharge:  20,
  stepFlashing: 4.82,    // 1.75+1.07+2
  trimCoil:     3.14,    // 2*1.07+1  (note: spreadsheet has 3.14, not 5.21)
  pipeBoot:     12.84,   // 12*1.07
  bayWindow:    50.00,
  decking:      40.00,   // 25+15
};

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

export default function EstimatorPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = !params.id;

  const [role, setRole] = useState<"admin" | "sales">("admin");

  // Lead type for commission calculation
  const [leadType, setLeadType] = useState<"office" | "self">("office");
  const commissionRate = leadType === "office" ? COMMISSION_OFFICE : COMMISSION_SELF;

  // Markup rate — editable by admin
  const [markupRateInput, setMarkupRateInput] = useState(String(DEFAULT_MARKUP_RATE * 100));
  const markupRate = Math.max(0, Math.min(100, num(markupRateInput))) / 100;

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

  const totalRawSq = sections.reduce((s, sec) => s + num(sec.squares), 0);
  const wasteMultiplier = 1 + num(wastePercent) / 100;
  const totalWithWaste = parseFloat((totalRawSq * wasteMultiplier).toFixed(2));

  // Materials
  const [shingleType, setShingleType] = useState("Landmark");
  const [shingleColor, setShingleColor] = useState("");
  const [shingleQty, setShingleQty] = useState("");
  const [shinglePrice, setShinglePrice] = useState(String(D.shingle));

  const [underlaymentQty, setUnderlaymentQty] = useState("");

  const [starterQty, setStarterQty] = useState("");

  const [ridgeCapQty, setRidgeCapQty] = useState("");

  const [iceWaterQty, setIceWaterQty] = useState("");

  const [dripEdgeQty, setDripEdgeQty] = useState("");
  const [dripEdgeColor, setDripEdgeColor] = useState("White");

  const [stepFlashingQty, setStepFlashingQty] = useState("");
  const [stepFlashingPrice, setStepFlashingPrice] = useState(String(D.stepFlashing));

  const [trimCoilQty, setTrimCoilQty] = useState("");
  const [trimCoilPrice, setTrimCoilPrice] = useState(String(D.trimCoil));

  const [pipeBootsQty, setPipeBootsQty] = useState("");
  const [pipeBootsPrice, setPipeBootsPrice] = useState(String(D.pipeBoot));

  const [bayWindowsQty, setBayWindowsQty] = useState("");
  const [bayWindowsPrice, setBayWindowsPrice] = useState(String(D.bayWindow));

  // Skylights — dynamic array
  const [skylights, setSkylights] = useState<SkylightItem[]>([]);

  const [ridgeVentQty, setRidgeVentQty] = useState("");

  // Referral fee
  const [referralFee, setReferralFee] = useState<0 | 100 | 200>(0);
  const [referralName, setReferralName] = useState("");

  const [deckingQty, setDeckingQty] = useState("");
  const [deckingPrice, setDeckingPrice] = useState(String(D.decking));
  const [deckingThickness, setDeckingThickness] = useState("7/16\"");
  const [deckingType, setDeckingType] = useState("OSB");

  const [flintlasticQty, setFlintlasticQty] = useState("");
  const FLINTLASTIC_PRICE = 301;

  // Auto-fill underlayment with total sq + waste
  useEffect(() => {
    if (totalWithWaste > 0) setUnderlaymentQty(String(totalWithWaste));
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

  const shingleTotal      = num(shingleQty) * num(shinglePrice);
  const landmarkProTotal  = num(shingleQty) * landmarkProUpcharge;
  const underlayTotal     = underlayTotal2(num(underlaymentQty));
  const starterTotal      = starterTotal2(num(starterQty));
  const ridgeCapTotal     = hipRidgeTotal(num(ridgeCapQty));
  const iceWaterTotal     = iceWaterTotal2(num(iceWaterQty));
  const dripEdgeTotal     = dripEdgeTotal2(num(dripEdgeQty));
  const stepFlashTotal    = num(stepFlashingQty) * num(stepFlashingPrice);
  const trimCoilTotal     = num(trimCoilQty) * num(trimCoilPrice);
  const pipeBootsTotal    = num(pipeBootsQty) * num(pipeBootsPrice);
  const bayWindowsTotal   = num(bayWindowsQty) * num(bayWindowsPrice);
  const skylightsTotal    = skylights.reduce((s, sk) => s + sk.lineTotal, 0);
  const ridgeVentTotal    = ridgeVentTotal2(num(ridgeVentQty));
  const deckingTotal      = num(deckingQty) * num(deckingPrice);
  const flintlasticTotal  = roundUp(num(flintlasticQty)) * FLINTLASTIC_PRICE;

  // Effective per-unit display rates (for admin view $/Unit column)
  const qUL = num(underlaymentQty);  const rateUL = qUL > 0 ? underlayTotal / qUL : UL_ROLL_COST / UL_ROLL_SQ;
  const qST = num(starterQty);       const rateST = qST > 0 ? starterTotal / qST : ST_BUNDLE_COST / ST_BUNDLE_LF;
  const qHR = num(ridgeCapQty);      const rateHR = qHR > 0 ? ridgeCapTotal / qHR : HR_BUNDLE_COST / HR_BUNDLE_LF;
  const qIW = num(iceWaterQty);      const rateIW = qIW > 0 ? iceWaterTotal / qIW : IW_ROLL_COST / IW_ROLL_LF;
  const qDE = num(dripEdgeQty);      const rateDE = qDE > 0 ? dripEdgeTotal / qDE : DE_PIECE_COST / DE_PIECE_LF;
  const qRV = num(ridgeVentQty);     const rateRV = qRV > 0 ? ridgeVentTotal / qRV : RV_PIECE_COST / RV_PIECE_LF;

  // ─── Markup model ─────────────────────────────────────────────────────────
  const A = shingleTotal + landmarkProTotal + steepPitchAdderTotal + underlayTotal + starterTotal +
    ridgeCapTotal + iceWaterTotal + dripEdgeTotal + stepFlashTotal +
    trimCoilTotal + pipeBootsTotal + bayWindowsTotal + skylightsTotal +
    ridgeVentTotal + deckingTotal + flintlasticTotal + referralFee + MISC_AMOUNT;
  const B = A * markupRate;
  const E = A + B;
  // Commission is X% of Total Price: Total = E / (1 - rate), F = Total * rate
  const grandTotal = E / (1 - commissionRate);
  const F = grandTotal * commissionRate;
  // Price per SQ denominator includes starter & hip & ridge bundles (3 bundles = 1 SQ)
  const starterBundles  = roundUp(num(starterQty) / ST_BUNDLE_LF);
  const hipRidgeBundles = roundUp(num(ridgeCapQty) / HR_BUNDLE_LF);
  const accessorySq     = (starterBundles + hipRidgeBundles) / 3;
  const totalSqForPrice = totalWithWaste + accessorySq;
  const pricePerSq = totalSqForPrice > 0 ? grandTotal / totalSqForPrice : 0;

  // Proportional sales price: distributes markup + commission across raw cost
  // salesPrice(x) = (x / A) * grandTotal — all line prices sum to grandTotal
  function salesPrice(rawCost: number): number {
    if (!A || A <= 0) return 0;
    return (rawCost / A) * grandTotal;
  }

  const isAdmin = role === "admin";

  // ─── Section helpers ──────────────────────────────────────────────────────
  const addSection = () => { if (sections.length < 3) setSections([...sections, { squares: "", pitch: "6/12" }]); };
  const removeSection = (i: number) => { if (sections.length > 1) setSections(sections.filter((_, idx) => idx !== i)); };
  const updateSection = (i: number, field: "squares" | "pitch", val: string) =>
    setSections(sections.map((s, idx) => idx === i ? { ...s, [field]: val } : s));

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

  // ─── Load existing estimate ───────────────────────────────────────────────
  const { data: existingEstimate } = useQuery<Estimate>({
    queryKey: ["/api/estimates", params.id],
    enabled: !isNew && !!params.id,
  });

  useEffect(() => {
    if (!existingEstimate) return;
    setCustomerName(existingEstimate.customerName || "");
    setCustomerAddress(existingEstimate.customerAddress || "");
    setCustomerPhone(existingEstimate.customerPhone || "");
    setCustomerEmail(existingEstimate.customerEmail || "");
    setNotes(existingEstimate.notes || "");
    setWastePercent(String(existingEstimate.wastePercent ?? 15));
    setShingleType(existingEstimate.shingleType || "Landmark");
    setShingleColor(existingEstimate.shingleColor || "");
    setShingleQty(String(existingEstimate.shingleQty ?? ""));
    setShinglePrice(String(existingEstimate.shinglePricePerSq ?? D.shingle));
    setUnderlaymentQty(String(existingEstimate.underlaymentQty ?? ""));
    setStarterQty(String(existingEstimate.starterQty ?? ""));
    setRidgeCapQty(String(existingEstimate.ridgeCapQty ?? ""));
    setIceWaterQty(String(existingEstimate.iceWaterQty ?? ""));
    setDripEdgeQty(String(existingEstimate.dripEdgeQty ?? ""));
    setDripEdgeColor(existingEstimate.dripEdgeColor || "White");
    setStepFlashingQty(String(existingEstimate.stepFlashingQty ?? ""));
    setStepFlashingPrice(String(existingEstimate.stepFlashingPricePerUnit ?? D.stepFlashing));
    setTrimCoilQty(String(existingEstimate.trimCoilQty ?? ""));
    setTrimCoilPrice(String(existingEstimate.trimCoilPricePerUnit ?? D.trimCoil));
    setPipeBootsQty(String(existingEstimate.pipeBootsQty ?? ""));
    setPipeBootsPrice(String(existingEstimate.pipeBootsPricePerUnit ?? D.pipeBoot));
    setBayWindowsQty(String(existingEstimate.bayWindowsQty ?? ""));
    setBayWindowsPrice(String(existingEstimate.bayWindowsPricePerUnit ?? D.bayWindow));
    setRidgeVentQty(String(existingEstimate.ventilationQty ?? ""));
    setDeckingQty(String(existingEstimate.deckingQty ?? ""));
    setDeckingPrice(String(existingEstimate.deckingPricePerUnit ?? D.decking));
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
    shingleType, shingleColor: shingleColor || null,
    shingleQty: num(shingleQty) || null,
    shinglePricePerSq: num(shinglePrice),
    landmarkProUpcharge,
    underlaymentQty: num(underlaymentQty) || null,
    underlaymentPricePerSq: rateUL,
    starterQty: num(starterQty) || null,
    starterPricePerUnit: rateST,
    ridgeCapQty: num(ridgeCapQty) || null,
    ridgeCapPricePerUnit: rateHR,
    iceWaterQty: num(iceWaterQty) || null,
    iceWaterPricePerUnit: rateIW,
    dripEdgeQty: num(dripEdgeQty) || null,
    dripEdgeColor,
    dripEdgePricePerUnit: rateDE,
    stepFlashingQty: num(stepFlashingQty) || null,
    stepFlashingPricePerUnit: num(stepFlashingPrice),
    trimCoilQty: num(trimCoilQty) || null,
    trimCoilPricePerUnit: num(trimCoilPrice),
    pipeBootsQty: num(pipeBootsQty) || null,
    pipeBootsPricePerUnit: num(pipeBootsPrice),
    bayWindowsQty: num(bayWindowsQty) || null,
    bayWindowsPricePerUnit: num(bayWindowsPrice),
    skylightsJson: skylights.length ? JSON.stringify(skylights) : null,
    ventilationQty: num(ridgeVentQty) || null,
    ventilationPricePerUnit: rateRV,
    deckingQty: num(deckingQty) || null,
    deckingPricePerUnit: num(deckingPrice),
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
      const res = await apiRequest(method, url, data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
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
      {/* Header */}
      <div className="sticky top-0 z-10 bg-card border-b border-border shadow-sm">
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
            <Button variant="outline" size="sm" onClick={() => setRole(r => r === "admin" ? "sales" : "admin")} className="gap-1 text-xs" data-testid="toggle-role">
              {isAdmin ? <><EyeOff size={14} /> Admin</> : <><Eye size={14} /> Sales</>}
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
                {sections.length < 3 && (
                  <Button variant="outline" size="sm" onClick={addSection} className="gap-1 text-xs h-7"><Plus size={12} /> Add Section</Button>
                )}
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
                      <Button variant="ghost" size="sm" onClick={() => removeSection(i)} className="h-7 w-7 p-0 text-destructive"><Trash2 size={13} /></Button>
                    )}
                  </div>
                </div>
              ))}
              <Separator className="my-3" />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Waste %</Label>
                  <Input type="number" min="0" max="50" value={wastePercent} onChange={e => setWastePercent(e.target.value)} className="text-sm w-16" />
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
              <SalesQtyRow label="Pipe Boots" qty={pipeBootsQty} setQty={setPipeBootsQty} unit="EA" />
              <SalesQtyRow label="Bay Windows / Dormers" qty={bayWindowsQty} setQty={setBayWindowsQty} unit="EA" />

              {/* Skylights */}
              <Separator className="my-2" />
              <div className="flex items-center justify-between mb-2">
                <SalesGroupLabel noMargin>Velux Skylights</SalesGroupLabel>
                <Button variant="outline" size="sm" onClick={addSkylight} className="gap-1 text-xs h-7">
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
                      <Button variant="ghost" size="sm" onClick={() => removeSkylight(sk.id)} className="h-7 w-7 p-0 text-destructive"><Trash2 size={13} /></Button>
                    </div>
                  </div>
                </div>
              ))}

              <Separator className="my-2" />
              <SalesGroupLabel>Other</SalesGroupLabel>
              <SalesQtyRow label="Flintlastic" qty={flintlasticQty} setQty={setFlintlasticQty} unit="SQ" />
              <SalesQtyRow label="Ridge Vent" qty={ridgeVentQty} setQty={setRidgeVentQty} unit="LF" />
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
                      Self-Generated<br /><span className="text-xs font-normal opacity-80">12% commission</span>
                    </button>
                  </div>
                </div>

                {/* Drip Edge & Skylight line prices */}
                {dripEdgeTotal > 0 && (
                  <div className="flex items-center justify-between px-4 py-2 border border-border rounded-lg">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Drip Edge</div>
                      <div className="text-xs text-muted-foreground">{num(dripEdgeQty)} FT — {dripEdgeColor}</div>
                    </div>
                    <span className="text-lg font-bold text-foreground">{fmtBig(salesPrice(dripEdgeTotal))}</span>
                  </div>
                )}
                {skylights.map(sk => (
                  <div key={sk.id} className="flex items-center justify-between px-4 py-2 border border-border rounded-lg">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Skylight — {sk.model}</div>
                      <div className="text-xs text-muted-foreground">{sk.qty} EA — {sk.size}</div>
                    </div>
                    <span className="text-lg font-bold text-foreground">{fmtBig(salesPrice(sk.lineTotal))}</span>
                  </div>
                ))}

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
                      {leadType === "office" ? "10% — Office Lead" : "12% — Self-Generated"}
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
                {sections.length < 3 && (
                  <Button variant="outline" size="sm" onClick={addSection} className="gap-1 text-xs h-7" data-testid="add-section"><Plus size={12} /> Add Section</Button>
                )}
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
                    {sections.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeSection(i)} className="h-7 w-7 p-0 text-destructive"><Trash2 size={13} /></Button>}
                  </div>
                </div>
              ))}
              <Separator className="my-3" />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Waste %</Label>
                  <Input type="number" min="0" max="50" value={wastePercent} onChange={e => setWastePercent(e.target.value)} className="text-sm w-16" />
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
              <ARow label={shingleType} qty={shingleQty} setQty={setShingleQty} unit="SQ" price={shinglePrice} setPrice={setShinglePrice} total={shingleTotal} />
              {shingleType === "Landmark PRO" && (
                <ARow label="Landmark PRO (+$20/SQ)" qty={shingleQty} setQty={() => {}} unit="SQ" price={String(D.proUpcharge)} setPrice={() => {}} total={landmarkProTotal} readonlyQty readonlyPrice highlight />
              )}
              {steepPitchAdderTotal > 0 && (
                <ARow label={`Steep Pitch (+$${totalSteepAdderPerSq.toFixed(0)}/SQ)`} qty={shingleQty} setQty={() => {}} unit="SQ" price={totalSteepAdderPerSq.toFixed(2)} setPrice={() => {}} total={steepPitchAdderTotal} readonlyQty readonlyPrice highlight />
              )}

              <Separator className="my-2" />
              <GroupLabel>Underlayment & Accessories</GroupLabel>
              <ARow label="Synthetic Underlayment" qty={underlaymentQty} setQty={setUnderlaymentQty} unit="SQ" price={rateUL.toFixed(4)} setPrice={() => {}} total={underlayTotal} prefilled readonlyPrice />
              <ARow label="Starter Strip" qty={starterQty} setQty={setStarterQty} unit="FT" price={rateST.toFixed(4)} setPrice={() => {}} total={starterTotal} readonlyPrice />
              <ARow label="Hip & Ridge" qty={ridgeCapQty} setQty={setRidgeCapQty} unit="FT" price={rateHR.toFixed(4)} setPrice={() => {}} total={ridgeCapTotal} readonlyPrice />
              <ARow label="Ice & Water Shield" qty={iceWaterQty} setQty={setIceWaterQty} unit="FT" price={rateIW.toFixed(4)} setPrice={() => {}} total={iceWaterTotal} readonlyPrice />

              <Separator className="my-2" />
              <GroupLabel>Flashing & Metal</GroupLabel>
              <div className="grid grid-cols-12 gap-2 items-center mb-1">
                <div className="col-span-4 text-sm font-medium flex items-center gap-1 flex-wrap">
                  <span>Drip Edge</span>
                  <Select value={dripEdgeColor} onValueChange={setDripEdgeColor}>
                    <SelectTrigger className="text-xs h-6 px-2 w-28 border-dashed"><SelectValue /></SelectTrigger>
                    <SelectContent>{DRIP_EDGE_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Input type="number" min="0" value={dripEdgeQty} onChange={e => setDripEdgeQty(e.target.value)} placeholder="0" className="text-sm h-8" /></div>
                <div className="col-span-1 text-xs text-center text-muted-foreground">FT</div>
                <div className="col-span-2"><Input type="number" min="0" step="0.01" value={rateDE.toFixed(4)} readOnly placeholder="0.00" className="text-sm h-8 bg-muted" /></div>
                <div className="col-span-3 text-right text-sm font-semibold">{fmt(dripEdgeTotal)}</div>
              </div>
              <ARow label="Alum. Step Flashing" qty={stepFlashingQty} setQty={setStepFlashingQty} unit="FT" price={stepFlashingPrice} setPrice={setStepFlashingPrice} total={stepFlashTotal} />
              <ARow label="Trim Coil" qty={trimCoilQty} setQty={setTrimCoilQty} unit="FT" price={trimCoilPrice} setPrice={setTrimCoilPrice} total={trimCoilTotal} />

              <Separator className="my-2" />
              <GroupLabel>Openings & Penetrations</GroupLabel>
              <ARow label="Pipe Boots" qty={pipeBootsQty} setQty={setPipeBootsQty} unit="EA" price={pipeBootsPrice} setPrice={setPipeBootsPrice} total={pipeBootsTotal} />
              <ARow label="Bay Windows / Dormers" qty={bayWindowsQty} setQty={setBayWindowsQty} unit="EA" price={bayWindowsPrice} setPrice={setBayWindowsPrice} total={bayWindowsTotal} />

              {/* Skylights */}
              <Separator className="my-2" />
              <div className="flex items-center justify-between mb-2">
                <GroupLabel noMargin>Velux Skylights</GroupLabel>
                <Button variant="outline" size="sm" onClick={addSkylight} className="gap-1 text-xs h-7">
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
                      <Button variant="ghost" size="sm" onClick={() => removeSkylight(sk.id)} className="h-7 w-7 p-0 text-destructive"><Trash2 size={13} /></Button>
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
              <ARow label="Flintlastic" qty={String(roundUp(num(flintlasticQty)))} setQty={setFlintlasticQty} unit="SQ" price={String(FLINTLASTIC_PRICE)} setPrice={() => {}} total={flintlasticTotal} readonlyPrice />
              <ARow label="Ridge Vent" qty={ridgeVentQty} setQty={setRidgeVentQty} unit="LF" price={rateRV.toFixed(4)} setPrice={() => {}} total={ridgeVentTotal} readonlyPrice />
              {/* Decking with thickness + type selectors */}
              <div className="grid grid-cols-12 gap-2 items-center mb-1">
                <div className="col-span-4 text-sm font-medium flex items-center gap-1 flex-wrap">
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
                <div className="col-span-2"><Input type="number" min="0" value={deckingQty} onChange={e => setDeckingQty(e.target.value)} placeholder="0" className="text-sm h-8" /></div>
                <div className="col-span-1 text-xs text-center text-muted-foreground">Sheet</div>
                <div className="col-span-2"><Input type="number" min="0" step="0.01" value={deckingPrice} onChange={e => setDeckingPrice(e.target.value)} placeholder="0.00" className="text-sm h-8" /></div>
                <div className="col-span-3 text-right text-sm font-semibold">{fmt(deckingTotal)}</div>
              </div>

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
                    Self-Generated (12%)
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">A — Total Raw Costs (incl. overhead)</span><span className="font-semibold">{fmtBig(A)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">B — Markup (A × {(markupRate * 100).toFixed(0)}%)</span><span className="font-semibold">{fmtBig(B)}</span></div>
                <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">E — Subtotal Before Commission (A + B)</span><span className="font-semibold">{fmtBig(E)}</span></div>
                <Separator />
                <div className="flex justify-between text-lg font-bold"><span>Total Price</span><span className="text-primary">{fmtBig(grandTotal)}</span></div>
                <div className="flex justify-between text-green-700 dark:text-green-400">
                  <span>F — Commission ({leadType === "office" ? "10%" : "12%"} of Total)</span>
                  <span className="font-semibold">{fmtBig(F)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-xs"><span>Price per Square ({totalSqForPrice.toFixed(2)} SQ)</span><span className="font-semibold">{pricePerSq > 0 ? fmtBig(pricePerSq) + "/SQ" : "—"}</span></div>
              </div>
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

function ColHeaders() {
  return (
    <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-semibold text-muted-foreground border-b border-border pb-2">
      <div className="col-span-4">Item</div>
      <div className="col-span-2 text-center">Qty</div>
      <div className="col-span-1 text-center">Unit</div>
      <div className="col-span-2 text-center">$/Unit</div>
      <div className="col-span-3 text-right">Raw Cost</div>
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
