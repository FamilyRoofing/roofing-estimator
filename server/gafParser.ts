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
  address: string | null; // property/job address — the report's title line
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
  // Per-structure breakdown from the report's "Buildings" page — only
  // populated (length >= 2) when the report covers more than one roof
  // structure (e.g. a house plus a detached garage). Empty otherwise.
  buildings: GafBuildingData[];
}

// The measurement subset the estimator can actually use, broken out per
// building instead of summed across the whole report.
export interface GafBuildingData {
  roofAreaSqFt: number | null;
  pitch: string | null;
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

// The report's very first line is the property address (e.g. "311
// Greenville Street, Pendleton, South Carolina 29670"), repeated in every
// page footer alongside "Prepared For: <company>". Require a comma so we
// don't accidentally grab a stray blank/garbage first line.
function extractAddress(text: string): string | null {
  const firstLine = text.split("\n").map(l => l.trim()).find(l => l.length > 0);
  if (!firstLine || !firstLine.includes(",")) return null;
  return firstLine;
}

// The "Buildings" page repeats each Summary-page label on its own line, but
// with one "value unit" pair per building instead of a single aggregate
// value, e.g. "Roof Area 3,250 sq ft 164 sq ft" for a 2-building report.
// Isolate that page's text (from the "Buildings" heading up to the next
// page-break marker) so per-building regexes can't accidentally match the
// Summary page's single aggregate values.
function extractBuildingsSection(text: string): string | null {
  const headingMatch = text.match(/^Buildings\s*$/im);
  if (!headingMatch || headingMatch.index === undefined) return null;
  const rest = text.slice(headingMatch.index);
  const nextPageBreak = rest.slice(1).search(/\n--\s*\d+\s*of\s*\d+\s*--/);
  return nextPageBreak === -1 ? rest : rest.slice(0, nextPageBreak + 1);
}

// Extract every "value unit" pair (in order) from a labeled line within the
// Buildings section, e.g. label="Drip Edge" unit="ft" on
// "Drip Edge 167 ft 219 ft 60 ft 44 ft" → [167, 219, 60, 44].
function extractBuildingValues(section: string, label: string, unit: string): number[] {
  const lineMatch = section.match(new RegExp(`^${label}\\s+(.+)$`, "im"));
  if (!lineMatch) return [];
  const valueRe = new RegExp(`([\\d,]+(?:\\.\\d+)?)\\s*${unit}`, "g");
  const values: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = valueRe.exec(lineMatch[1])) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (!isNaN(n)) values.push(n);
  }
  return values;
}

// Pitch pairs don't fit the "value unit" shape ("Pitch 6 / 12 7 / 12"), so
// they get their own extractor.
function extractBuildingPitches(section: string): string[] {
  const lineMatch = section.match(/^Pitch\s+(.+)$/im);
  if (!lineMatch) return [];
  const pitches: string[] = [];
  const pitchRe = /(\d+)\s*\/\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = pitchRe.exec(lineMatch[1])) !== null) pitches.push(`${m[1]}/${m[2]}`);
  return pitches;
}

function extractBuildings(text: string): GafBuildingData[] {
  const section = extractBuildingsSection(text);
  if (!section) return [];
  const roofAreas = extractBuildingValues(section, "Roof Area", "sq\\s*ft");
  // A single column means the report only covers one structure — nothing
  // extra to offer beyond the Summary page's aggregate figures.
  if (roofAreas.length < 2) return [];
  const pitches = extractBuildingPitches(section);
  const dripEdges = extractBuildingValues(section, "Drip Edge", "ft");
  const leakBarriers = extractBuildingValues(section, "Leak Barrier", "ft");
  const ridgeCaps = extractBuildingValues(section, "Ridge Cap", "ft");
  const starters = extractBuildingValues(section, "Starter", "ft");
  return roofAreas.map((roofAreaSqFt, i) => ({
    roofAreaSqFt,
    pitch: pitches[i] ?? null,
    dripEdgeFt: dripEdges[i] ?? null,
    leakBarrierFt: leakBarriers[i] ?? null,
    ridgeCapFt: ridgeCaps[i] ?? null,
    starterFt: starters[i] ?? null,
  }));
}

export function parseGafReport(text: string): GafReportData {
  const pitchMatch = text.match(/^Pitch\s+(\d+)\s*\/\s*(\d+)\s*$/im);
  return {
    address: extractAddress(text),
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
    buildings: extractBuildings(text),
  };
}
