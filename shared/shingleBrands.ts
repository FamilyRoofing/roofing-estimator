// Shared shingle-brand metadata — used by both the Estimator page (to auto-fill
// product names and swap in a brand's remembered price) and the Shingle
// Pricing settings page (to list every brand's editable rate in one place).
// Single source of truth so the two pages can't drift out of sync.

export type ShingleBrand = "certainteed" | "owensCorning" | "gaf" | "atlas" | "iko" | "tamko";

export const SHINGLE_BRANDS: { value: ShingleBrand; label: string }[] = [
  { value: "certainteed", label: "CertainTeed" },
  { value: "owensCorning", label: "Owens Corning" },
  { value: "gaf", label: "GAF" },
  { value: "atlas", label: "Atlas" },
  { value: "iko", label: "IKO" },
  { value: "tamko", label: "Tamko" },
];

export const BASE_SHINGLE_BY_BRAND: Record<ShingleBrand, string> = {
  certainteed: "Landmark",
  owensCorning: "Oakridge",
  gaf: "Natural Shadow",
  atlas: "ProLam",
  iko: "Cambridge",
  tamko: "Heritage",
};

export const PREMIUM_SHINGLE_BY_BRAND: Record<ShingleBrand, string> = {
  certainteed: "Landmark PRO",
  owensCorning: "Duration",
  gaf: "Timberline HDZ",
  atlas: "Pinnacle Pristine",
  iko: "Dynasty",
  tamko: "Titan XT",
};

// Fallback defaults for a brand that's never had a price saved — matches the
// D.shingle / D.premiumShingle constants on the Estimator page.
export const DEFAULT_SHINGLE_LABOR_RATE = 193.56;
export const DEFAULT_PREMIUM_RATE = 15;

// price_defaults field names per brand — kept in one place since both the
// server (validating a settings update) and the client (reading/writing the
// settings form) need the exact same mapping.
export const BRAND_PRICE_FIELDS: Record<ShingleBrand, { labor: string; material: string; premium: string }> = {
  certainteed: { labor: "certainteedShinglePricePerSq", material: "certainteedShingleMaterialPricePerSq", premium: "certainteedPremiumPricePerUnit" },
  owensCorning: { labor: "owensCorningShinglePricePerSq", material: "owensCorningShingleMaterialPricePerSq", premium: "owensCorningPremiumPricePerUnit" },
  gaf: { labor: "gafShinglePricePerSq", material: "gafShingleMaterialPricePerSq", premium: "gafPremiumPricePerUnit" },
  atlas: { labor: "atlasShinglePricePerSq", material: "atlasShingleMaterialPricePerSq", premium: "atlasPremiumPricePerUnit" },
  iko: { labor: "ikoShinglePricePerSq", material: "ikoShingleMaterialPricePerSq", premium: "ikoPremiumPricePerUnit" },
  tamko: { labor: "tamkoShinglePricePerSq", material: "tamkoShingleMaterialPricePerSq", premium: "tamkoPremiumPricePerUnit" },
};
