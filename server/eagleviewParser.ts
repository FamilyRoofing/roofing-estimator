// Parses an EagleView "Extended Coverage 2D Report" (as extracted by
// pdf-parse) into the roof measurement fields the estimator can prefill.
//
// The most complete, canonical figures are in the "Lengths, Areas and
// Pitches" block near the end of the report (labels use "Field = Value"
// rather than GAF's "Field\nValue" or Roofr's "Total Field Xft Yin"), e.g.:
//   Ridges = 48 ft (4 Ridges)
//   Rakes* = 94 ft (12 Rakes)
//   Eaves/Starter** = 93 ft (10 Eaves)
//   Drip Edge (Eaves + Rakes) = 187 ft (26 Lengths)
// EagleView reports Eaves and Starter as a single combined figure (there's
// no separate pure-Eaves measurement, unlike GAF/Roofr). Since it also
// gives Drip Edge pre-computed as Eaves + Rakes, a pure eaves figure can be
// recovered as dripEdgeCombined - rakesFt — that's what's used for eavesFt
// here, distinct from the Eaves/Starter figure (which still feeds starterFt,
// the only place the combined figure is actually correct to use).
//
// This parser handles the single-structure report layout only — no sample
// of a multi-structure EagleView report has been checked yet, so buildings
// is always empty here.

import type { ReportData } from "@shared/reportTypes";

// Isolate the "Lengths, Areas and Pitches" section, the last major block in
// the report and the one with the fullest set of fields.
function extractLengthsSection(text: string): string {
  const m = text.match(/^Lengths, Areas and Pitches\s*$/im);
  if (!m || m.index === undefined) return text;
  return text.slice(m.index);
}

// "Ridges = 48 ft" / "Rakes* = 94 ft" / "Eaves/Starter** = 93 ft" — label
// may carry a trailing "*"/"**" footnote marker and a "(N Whatever)" or
// similar trailing annotation we don't care about.
function extractNumber(text: string, label: string, unit: string): number | null {
  const re = new RegExp(`${label}\\s*\\*{0,2}\\s*=\\s*([\\d,]+(?:\\.\\d+)?)\\s*${unit}`, "i");
  const m = text.match(re);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

// The address repeats identically on nearly every page (e.g. "70 Three M
// Ln, Abbeville, SC 29620"). Match a line starting with a house number so
// we don't pick up the roofing company's own "Address:" block instead.
function extractAddress(text: string): string | null {
  const m = text.match(/^\d[\w\s.#-]*,\s*[\w\s]+,\s*[A-Z]{2}\s+\d{5}/m);
  return m ? m[0].trim() : null;
}

// The Waste Calculation table explicitly labels its columns "Measured"
// (always the 0% column) and "Suggested" on its own line below the table —
// but plain text extraction loses which column "Suggested" sits under.
// Confirmed against a real sample (rendered to an image) that the boxed
// "Suggested" value is the exact middle entry, same convention as GAF's
// waste table, so we rely on that position here too.
function extractSuggestedWastePercent(text: string): number | null {
  const m = text.match(/^Waste %\s+(.+)$/im);
  if (!m) return null;
  const values: number[] = [];
  const re = /(\d+(?:\.\d+)?)\s*%/g;
  let vm: RegExpExecArray | null;
  while ((vm = re.exec(m[1])) !== null) values.push(parseFloat(vm[1]));
  if (values.length === 0) return null;
  return values[Math.floor(values.length / 2)];
}

export function parseEagleviewReport(text: string): ReportData {
  const section = extractLengthsSection(text);
  const ridgesFt = extractNumber(section, "Ridges", "ft");
  const hipsFt = extractNumber(section, "Hips", "ft");
  const rakesFt = extractNumber(section, "Rakes", "ft");
  const eavesStarterFt = extractNumber(section, "Eaves/Starter", "ft");
  const dripEdgeCombinedFt = extractNumber(section, "Drip Edge \\(Eaves \\+ Rakes\\)", "ft");
  const eavesFt = (dripEdgeCombinedFt != null && rakesFt != null) ? dripEdgeCombinedFt - rakesFt : null;
  const pitchMatch = section.match(/Predominant Pitch\s*=\s*(\d+)\s*\/\s*(\d+)/i);
  return {
    source: "eagleview",
    address: extractAddress(text),
    roofAreaSqFt: extractNumber(section, "Total Area", "sq\\s*ft"),
    roofFacets: extractNumber(text, "Total Roof Facets", ""),
    pitch: pitchMatch ? `${pitchMatch[1]}/${pitchMatch[2]}` : null,
    eavesFt,
    hipsFt,
    rakesFt,
    ridgesFt,
    valleysFt: extractNumber(section, "Valleys", "ft"),
    leakBarrierFt: null, // no EagleView equivalent — Ice & Water is derived from step+valleys instead
    // Not printed directly — Hip & Ridge cap covers both hips and ridges.
    ridgeCapFt: ridgesFt != null && hipsFt != null ? ridgesFt + hipsFt : null,
    // EagleView reports eaves and starter as one combined figure — no way
    // to recover a pure Starter-only figure, so this stays the combined one.
    starterFt: eavesStarterFt,
    stepFt: extractNumber(section, "Step flashing", "ft"),
    suggestedWastePercent: extractSuggestedWastePercent(text),
    buildings: [],
  };
}
