import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign } from "lucide-react";
import type { PriceDefaults } from "@shared/schema";
import {
  SHINGLE_BRANDS, BASE_SHINGLE_BY_BRAND, PREMIUM_SHINGLE_BY_BRAND, BRAND_PRICE_FIELDS,
  DEFAULT_SHINGLE_LABOR_RATE, DEFAULT_PREMIUM_RATE,
} from "@shared/shingleBrands";
import type { ShingleBrand } from "@shared/shingleBrands";

function num(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return isNaN(n) ? 0 : n;
}

type BrandRates = { material: string; labor: string; premium: string };

// CertainTeed falls back to the legacy generic fields (pricing saved before
// multi-brand support existed) when its own slot is unset — same rule as
// priceForBrand on the Estimator page. Every other brand just falls back to
// the flat defaults.
function initialRates(brand: ShingleBrand, pd: PriceDefaults | undefined): BrandRates {
  const fields = BRAND_PRICE_FIELDS[brand];
  const legacyLabor = brand === "certainteed" ? num((pd as any)?.shinglePricePerSq) : 0;
  const legacyMaterial = brand === "certainteed" ? num((pd as any)?.shingleMaterialPricePerSq) : 0;
  const legacyPremium = brand === "certainteed" ? num((pd as any)?.landmarkProPricePerUnit) : 0;
  const labor = num((pd as any)?.[fields.labor]) || legacyLabor || DEFAULT_SHINGLE_LABOR_RATE;
  const material = num((pd as any)?.[fields.material]) || legacyMaterial;
  const premium = num((pd as any)?.[fields.premium]) || legacyPremium || DEFAULT_PREMIUM_RATE;
  return { material: String(material), labor: String(labor), premium: String(premium) };
}

export default function ShinglePricingPage() {
  const { toast } = useToast();
  const { data: priceDefaults, isLoading } = useQuery<PriceDefaults>({ queryKey: ["/api/price-defaults"] });

  const [rates, setRates] = useState<Record<ShingleBrand, BrandRates> | null>(null);

  // Prefill once price defaults load — an admin's later edits shouldn't get
  // clobbered by a background refetch, so this only runs when rates is unset.
  useEffect(() => {
    if (!priceDefaults || rates) return;
    const next = {} as Record<ShingleBrand, BrandRates>;
    for (const b of SHINGLE_BRANDS) next[b.value] = initialRates(b.value, priceDefaults);
    setRates(next);
  }, [priceDefaults, rates]);

  const setField = (brand: ShingleBrand, field: keyof BrandRates, value: string) => {
    setRates(prev => prev ? { ...prev, [brand]: { ...prev[brand], [field]: value } } : prev);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, number> = {};
      for (const b of SHINGLE_BRANDS) {
        const fields = BRAND_PRICE_FIELDS[b.value];
        const r = rates![b.value];
        body[fields.labor] = num(r.labor);
        body[fields.material] = num(r.material);
        body[fields.premium] = num(r.premium);
      }
      return apiRequest("/api/price-defaults/shingle-brands", { method: "PUT", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-defaults"] });
      toast({ title: "Shingle pricing saved", description: "New estimates will use these rates." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <DollarSign size={20} className="text-primary" />
          <h2 className="text-lg font-bold text-foreground">Shingle Pricing</h2>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!rates || saveMutation.isPending}
          data-testid="button-save-shingle-pricing"
        >
          {saveMutation.isPending ? "Saving…" : "Save All"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-6">
        Each brand remembers its own base and premium-upgrade pricing. Picking a brand on an estimate pulls its rates from here automatically.
      </p>

      <div className="space-y-3">
        {isLoading || !rates
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)
          : SHINGLE_BRANDS.map(b => {
            const r = rates[b.value];
            return (
              <div key={b.value} className="bg-card border border-border rounded-lg p-4" data-testid={`brand-row-${b.value}`}>
                <div className="font-semibold text-sm text-foreground mb-3">{b.label}</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">{BASE_SHINGLE_BY_BRAND[b.value]} — Material $/SQ</Label>
                    <Input
                      type="number" min="0" step="0.01" className="mt-1 h-8 text-sm"
                      value={r.material} onChange={e => setField(b.value, "material", e.target.value)}
                      data-testid={`input-${b.value}-material`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{BASE_SHINGLE_BY_BRAND[b.value]} — Labor $/SQ</Label>
                    <Input
                      type="number" min="0" step="0.01" className="mt-1 h-8 text-sm"
                      value={r.labor} onChange={e => setField(b.value, "labor", e.target.value)}
                      data-testid={`input-${b.value}-labor`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{PREMIUM_SHINGLE_BY_BRAND[b.value]} — $/SQ</Label>
                    <Input
                      type="number" min="0" step="0.01" className="mt-1 h-8 text-sm"
                      value={r.premium} onChange={e => setField(b.value, "premium", e.target.value)}
                      data-testid={`input-${b.value}-premium`}
                    />
                  </div>
                </div>
              </div>
            );
          })
        }
      </div>
    </div>
  );
}
