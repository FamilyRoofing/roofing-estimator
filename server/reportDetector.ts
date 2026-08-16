// Identifies which measurement-report provider a PDF's extracted text came
// from, by sniffing for boilerplate text that's specific to that provider
// and present on every page (so it survives regardless of which page pdf-
// parse happens to extract first). Verified against real sample reports
// from all three providers — none of these markers cross-contaminate.
import type { ReportSource } from "@shared/reportTypes";

export function detectReportSource(text: string): ReportSource | null {
  if (text.includes("GAF recommends")) return "gaf";
  if (text.includes("Roofr.com")) return "roofr";
  if (text.includes("Eagle View Technologies")) return "eagleview";
  return null;
}
