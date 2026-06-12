// Velux skylight catalog — sizes and material prices (from Velux USA price list)
// All prices are material cost only (before markup). Installation and flashing added separately.

export type SkylightMountType = "deck" | "curb" | "custom";

export interface VeluxModel {
  code: string;          // e.g. "FS C06"
  series: string;        // e.g. "FS Fixed Deck Mount"
  size: string;          // display e.g. '21" x 46"'
  roughOpening: string;  // e.g. '21 x 45-3/4'
  mountType: SkylightMountType;
  materialPrice: number;
}

// ── Deck Mount Fixed (FS) ────────────────────────────────────────────────────
export const VELUX_DECK_FIXED: VeluxModel[] = [
  { code: "FS C01", series: "FS Fixed Deck", size: '21" x 27"', roughOpening: '21 x 26-7/8', mountType: "deck", materialPrice: 309 },
  { code: "FS C04", series: "FS Fixed Deck", size: '21" x 38"', roughOpening: '21 x 37-7/8', mountType: "deck", materialPrice: 356 },
  { code: "FS C06", series: "FS Fixed Deck", size: '21" x 46"', roughOpening: '21 x 45-3/4', mountType: "deck", materialPrice: 397 },
  { code: "FS C08", series: "FS Fixed Deck", size: '21" x 55"', roughOpening: '21 x 54-7/16', mountType: "deck", materialPrice: 428 },
  { code: "FS C12", series: "FS Fixed Deck", size: '21" x 71"', roughOpening: '21 x 70-1/4', mountType: "deck", materialPrice: 548 },
  { code: "FS D26", series: "FS Fixed Deck", size: '23" x 23"', roughOpening: '22-1/2 x 22-15/16', mountType: "deck", materialPrice: 335 },
  { code: "FS D06", series: "FS Fixed Deck", size: '23" x 46"', roughOpening: '22-1/2 x 45-3/4', mountType: "deck", materialPrice: 409 },
  { code: "FS M02", series: "FS Fixed Deck", size: '30" x 30"', roughOpening: '30-1/16 x 30', mountType: "deck", materialPrice: 386 },
  { code: "FS M04", series: "FS Fixed Deck", size: '30" x 38"', roughOpening: '30-1/16 x 37-7/8', mountType: "deck", materialPrice: 419 },
  { code: "FS M06", series: "FS Fixed Deck", size: '30" x 46"', roughOpening: '30-1/16 x 45-3/4', mountType: "deck", materialPrice: 474 },
  { code: "FS M08", series: "FS Fixed Deck", size: '30" x 55"', roughOpening: '30-1/16 x 54-7/16', mountType: "deck", materialPrice: 518 },
  { code: "FS S01", series: "FS Fixed Deck", size: '44" x 27"', roughOpening: '44-1/4 x 26-7/8', mountType: "deck", materialPrice: 478 },
  { code: "FS S06", series: "FS Fixed Deck", size: '44" x 46"', roughOpening: '44-1/4 x 45-3/4', mountType: "deck", materialPrice: 604 },
  { code: "FS A06", series: "FS Fixed Deck", size: '14" x 46"', roughOpening: '14-1/2 x 45-3/4', mountType: "deck", materialPrice: 348 },
];

// ── Curb Mount Fixed (FCM) ───────────────────────────────────────────────────
export const VELUX_CURB_FIXED: VeluxModel[] = [
  { code: "FCM 1430", series: "FCM Fixed Curb", size: '14" x 30"', roughOpening: '14-1/2 x 30-1/2', mountType: "curb", materialPrice: 285 },
  { code: "FCM 1446", series: "FCM Fixed Curb", size: '14" x 46"', roughOpening: '14-1/2 x 46-1/2', mountType: "curb", materialPrice: 313 },
  { code: "FCM 2222", series: "FCM Fixed Curb", size: '22" x 22"', roughOpening: '22-1/2 x 22-1/2', mountType: "curb", materialPrice: 230 },
  { code: "FCM 2230", series: "FCM Fixed Curb", size: '22" x 30"', roughOpening: '22-1/2 x 30-1/2', mountType: "curb", materialPrice: 268 },
  { code: "FCM 2234", series: "FCM Fixed Curb", size: '22" x 34"', roughOpening: '22-1/2 x 34-1/2', mountType: "curb", materialPrice: 285 },
  { code: "FCM 2246", series: "FCM Fixed Curb", size: '22" x 46"', roughOpening: '22-1/2 x 46-1/2', mountType: "curb", materialPrice: 302 },
  { code: "FCM 2270", series: "FCM Fixed Curb", size: '22" x 70"', roughOpening: '22-1/2 x 70-1/2', mountType: "curb", materialPrice: 505 },
  { code: "FCM 3030", series: "FCM Fixed Curb", size: '30" x 30"', roughOpening: '30-1/2 x 30-1/2', mountType: "curb", materialPrice: 324 },
  { code: "FCM 3046", series: "FCM Fixed Curb", size: '30" x 46"', roughOpening: '30-1/2 x 46-1/2', mountType: "curb", materialPrice: 432 },
  { code: "FCM 3055", series: "FCM Fixed Curb", size: '30" x 55"', roughOpening: '30-1/2 x 55-1/2', mountType: "curb", materialPrice: 478 },
  { code: "FCM 3434", series: "FCM Fixed Curb", size: '34" x 34"', roughOpening: '34-1/2 x 34-1/2', mountType: "curb", materialPrice: 402 },
  { code: "FCM 3446", series: "FCM Fixed Curb", size: '34" x 46"', roughOpening: '34-1/2 x 46-1/2', mountType: "curb", materialPrice: 453 },
  { code: "FCM 4622", series: "FCM Fixed Curb", size: '46" x 22"', roughOpening: '46-1/2 x 22-1/2', mountType: "curb", materialPrice: 302 },
  { code: "FCM 4630", series: "FCM Fixed Curb", size: '46" x 30"', roughOpening: '46-1/2 x 30-1/2', mountType: "curb", materialPrice: 432 },
  { code: "FCM 4634", series: "FCM Fixed Curb", size: '46" x 34"', roughOpening: '46-1/2 x 34-1/2', mountType: "curb", materialPrice: 453 },
  { code: "FCM 4646", series: "FCM Fixed Curb", size: '46" x 46"', roughOpening: '46-1/2 x 46-1/2', mountType: "curb", materialPrice: 473 },
  { code: "FCM 4672", series: "FCM Fixed Curb", size: '46" x 72"', roughOpening: '46-1/2 x 72-1/2', mountType: "curb", materialPrice: 802 },
];

export const ALL_VELUX_MODELS: VeluxModel[] = [
  ...VELUX_DECK_FIXED,
  ...VELUX_CURB_FIXED,
];

// Installation and flashing costs
export const SKYLIGHT_INSTALL_COST = 75;      // per unit, all types
export const SKYLIGHT_FLASHING_COST = 140;    // per unit, deck mount only
