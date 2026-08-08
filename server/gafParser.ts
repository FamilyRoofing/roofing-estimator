// Parses the "Summary" page of a GAF QuickMeasure report (as extracted by
// pdf-parse) into the roof measurement fields the estimator can prefill.
//
// The Summary page renders as consecutive "Label\nValue" lines, e.g.:
//   Roof Area 9,069 sq ft
//   Roof Facets 21
//   Pitch 6 / 12
//   Eaves 615 ft
//   ...
//   Starter 820 ft
// Reports also include a "Buildings" page that repeats these same labels
// with one value per building on a single line (e.g. "Eaves 344 ft 184 ft
// 87 ft"). Anchoring each regex to a single value at end-of-line targets
// only the Summary page's aggregate figures and skips the Buildings page.

export interface GafReportData {
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
}

function extractNumber(text: string, label: string, unit: string): number | null {
  const re = new RegExp(`^${label}\\s+([\\d,]+(?:\\.\\d+)?)\\s*${unit}\\s*$`, "im");
  const m = text.match(re);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

export function parseGafReport(text: string): GafReportData {
  const pitchMatch = text.match(/^Pitch\s+(\d+)\s*\/\s*(\d+)\s*$/im);
  return {
    roofAreaSqFt: extractNumber(text, "Roof Area", "sq\\s*ft"),
    roofFacets: extractNumber(text, "Roof Facets", ""),
    pitch: pitchMatch ? `${pitchMatch[1]}/${pitchMatch[2]}` : null,
    eavesFt: extractNumber(text, "Eaves", "ft"),
    hipsFt: extractNumber(text, "Hips", "ft"),
    rakesFt: extractNumber(text, "Rakes", "ft"),
    ridgesFt: extractNumber(text, "Ridges", "ft"),
    valleysFt: extractNumber(text, "Valleys", "ft"),
    dripEdgeFt: extractNumber(text, "Drip Edge", "ft"),
    leakBarrierFt: extractNumber(text, "Leak Barrier", "ft"),
    ridgeCapFt: extractNumber(text, "Ridge Cap", "ft"),
    starterFt: extractNumber(text, "Starter", "ft"),
  };
}
