// Normalized shape every measurement-report parser (GAF, Roofr, EagleView,
// ...) produces, so the estimator's import UI, review dialog, and
// multi-building split logic work identically regardless of source.

export type ReportSource = "gaf" | "roofr" | "eagleview";

export interface ReportData {
  source: ReportSource;
  address: string | null; // property/job address
  roofAreaSqFt: number | null;
  roofFacets: number | null;
  pitch: string | null; // e.g. "6/12" — matches the estimator's PITCHES options
  eavesFt: number | null;
  hipsFt: number | null;
  rakesFt: number | null;
  ridgesFt: number | null;
  valleysFt: number | null;
  dripEdgeFt: number | null;
  leakBarrierFt: number | null;
  ridgeCapFt: number | null;
  starterFt: number | null;
  stepFt: number | null;
  // null when the provider doesn't offer a suggested waste factor at all
  // (e.g. Roofr) rather than one we failed to find.
  suggestedWastePercent: number | null;
  // Per-structure breakdown — only populated (length >= 2) when the report
  // covers more than one roof structure (e.g. a house plus a detached
  // garage). Empty otherwise.
  buildings: BuildingData[];
}

// The measurement subset the estimator can actually use, broken out per
// building instead of summed across the whole report.
export interface BuildingData {
  roofAreaSqFt: number | null;
  pitch: string | null;
  dripEdgeFt: number | null;
  leakBarrierFt: number | null;
  ridgeCapFt: number | null;
  starterFt: number | null;
  // Ridges only, excluding hips — Ridge Cap combines both (hip & ridge cap
  // shingles cover the same run), but ridge vent only sits along ridges.
  ridgesFt: number | null;
  valleysFt: number | null;
  stepFt: number | null;
}
