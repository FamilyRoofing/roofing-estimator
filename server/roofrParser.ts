// Parses a Roofr "Report summary" page (as extracted by pdf-parse) into the
// roof measurement fields the estimator can prefill.
//
// Roofr reports (unlike GAF's) already give combined figures directly —
// "Eaves + rakes" (= Drip Edge) and "Hips + ridges" (= Hip & Ridge cap) are
// printed as their own lines, so no summing is needed. Lengths are given as
// "Xft Yin" rather than plain feet.
//
// Multi-structure properties get one "Structure #N summary" page per
// structure (identical field layout to "Report summary", just scoped to
// that structure) plus a final aggregate "Report summary" page — this maps
// directly onto the estimator's per-building split feature.
//
// Roofr does not print a suggested waste factor anywhere in the report
// (confirmed against a real sample: the Waste % table has no highlighted
// column at all, unlike GAF/EagleView), so suggestedWastePercent is always
// null here rather than guessed.

import type { ReportData, BuildingData } from "@shared/reportTypes";

// Isolate one page's text: from a heading match up to the next page-break
// marker (or a second, later boundary heading — see extractStructureSections).
function extractSection(text: string, headingPattern: RegExp, hardEnd?: number): string | null {
  const m = text.match(headingPattern);
  if (!m || m.index === undefined) return null;
  const rest = text.slice(m.index, hardEnd);
  const nextPageBreak = rest.slice(1).search(/\n--\s*\d+\s*of\s*\d+\s*--/);
  return nextPageBreak === -1 ? rest : rest.slice(0, nextPageBreak + 1);
}

// "Total eaves 117ft 9in" -> 117.75
function extractFeetInches(section: string, label: string): number | null {
  const re = new RegExp(`${label}\\s+(\\d+)\\s*ft\\s*(\\d+)\\s*in`, "i");
  const m = section.match(re);
  if (!m) return null;
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 12;
}

function extractPlainNumber(section: string, label: string, unit: string): number | null {
  const re = new RegExp(`${label}\\s+([\\d,]+(?:\\.\\d+)?)\\s*${unit}`, "i");
  const m = section.match(re);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function extractPitch(section: string): string | null {
  const m = section.match(/Predominant pitch\s+(\d+)\s*\/\s*(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// The address repeats identically on nearly every page (e.g. "104
// Bertharee Court, Anderson, SC 29625"). Match a line starting with a house
// number so we don't pick up anything else.
function extractAddress(text: string): string | null {
  const m = text.match(/^\d[\w\s.#-]*,\s*[\w\s]+,\s*[A-Z]{2}\s+\d{5}/m);
  return m ? m[0].trim() : null;
}

// Pulls the measurement fields the estimator uses out of a single "...
// summary" section (either "Report summary" or one "Structure #N summary").
function extractMeasurements(section: string): Omit<BuildingData, never> & { roofFacets?: number } {
  const eavesPlusRakes = extractFeetInches(section, "Eaves \\+ rakes");
  return {
    roofAreaSqFt: extractPlainNumber(section, "Total roof area", "sqft"),
    pitch: extractPitch(section),
    dripEdgeFt: eavesPlusRakes,
    leakBarrierFt: null, // no Roofr equivalent — Ice & Water is derived from step+valleys instead
    ridgeCapFt: extractFeetInches(section, "Hips \\+ ridges"),
    // Roofr doesn't report a separate Starter figure — it runs along the
    // same eaves (and often rakes) as the drip edge, so default to that.
    starterFt: eavesPlusRakes,
    ridgesFt: extractFeetInches(section, "Total ridges"),
    valleysFt: extractFeetInches(section, "Total valleys"),
    stepFt: extractFeetInches(section, "Total step flashing"),
  };
}

// One page per structure ("Structure #1 summary", "Structure #2 summary",
// ...), each bounded by the next structure heading or by the final "Report
// summary" heading — whichever comes first.
function extractBuildings(text: string): BuildingData[] {
  const headingRe = /^Structure #\d+ summary\s*$/img;
  const structureMatches = Array.from(text.matchAll(headingRe));
  // A single (or absent) structure page means the report only covers one
  // roof — nothing extra to offer beyond the Report summary aggregate.
  if (structureMatches.length < 2) return [];
  const reportSummaryMatch = text.match(/^Report summary\s*$/im);
  const overallEnd = reportSummaryMatch?.index ?? text.length;
  return structureMatches.map((m, i) => {
    const start = m.index!;
    const end = i + 1 < structureMatches.length ? structureMatches[i + 1].index! : overallEnd;
    return extractMeasurements(text.slice(start, end));
  });
}

export function parseRoofrReport(text: string): ReportData {
  const summarySection = extractSection(text, /^Report summary\s*$/im) ?? text;
  const measurements = extractMeasurements(summarySection);
  return {
    source: "roofr",
    address: extractAddress(text),
    roofAreaSqFt: measurements.roofAreaSqFt,
    roofFacets: extractPlainNumber(summarySection, "Total roof facets", "facets"),
    pitch: measurements.pitch,
    eavesFt: extractFeetInches(summarySection, "Total eaves"),
    hipsFt: extractFeetInches(summarySection, "Total hips"),
    rakesFt: extractFeetInches(summarySection, "Total rakes"),
    ridgesFt: measurements.ridgesFt,
    valleysFt: measurements.valleysFt,
    dripEdgeFt: measurements.dripEdgeFt,
    leakBarrierFt: null,
    ridgeCapFt: measurements.ridgeCapFt,
    starterFt: measurements.starterFt,
    stepFt: measurements.stepFt,
    suggestedWastePercent: null, // Roofr doesn't provide one — see file header
    buildings: extractBuildings(text),
  };
}
