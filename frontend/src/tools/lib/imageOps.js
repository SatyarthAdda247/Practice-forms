// Image Resizer — canvas/measurement helpers, no React. Kept separate from the
// page so the numbers can be checked in isolation.
//
// Every measurement here is local except the face check, which posts the
// encoded JPEG to the backend because no browser ships a usable face detector —
// see detectFace below.
import { toolsApi } from "../../api.js";

// EDIT ME: the only table you normally need to touch.
//
// The IBPS entries are transcribed from the official "Guidelines for Scanning
// and Upload Of Documents" (IBPS PO). Everything with `source: null` is a
// commonly published value that nobody has verified against a notification —
// the UI says so out loud rather than implying the numbers are official.
//
// checks: which health checks apply to this document type.
// physical / dpi: printed size and scan resolution the guidelines ask for.
export const PRESETS = {
  "ibps-photo": {
    label: "Banking (IBPS / SBI / RBI / LIC) — Photograph",
    w: 200, h: 230, minKB: 20, maxKB: 50, dpi: 200,
    physical: "4.5 cm × 3.5 cm",
    checks: { face: true, background: true, sharpness: true, ink: false },
    source: "IBPS PO — Guidelines for Scanning and Upload of Documents",
    family: "Banking", covers: "IBPS PO/Clerk/SO, SBI PO/Clerk, RBI Assistant/Grade B, LIC AAO/ADO",
    guidance: [
      "Recent passport-style colour picture against a light-coloured, preferably white background.",
      "Look straight at the camera with a relaxed face — no harsh shadows, no red-eye.",
      "Glasses are allowed only if there are no reflections and your eyes are clearly visible.",
      "Caps, hats and dark glasses are not acceptable. Religious headwear must not cover the face.",
      "Rejected: small, distorted, masked or blurred photos, and photos taken in the dark.",
    ],
  },
  "ibps-sign": {
    label: "Banking (IBPS / SBI / RBI / LIC) — Signature",
    w: 140, h: 60, minKB: 10, maxKB: 20, dpi: 200,
    physical: null,
    checks: { face: false, background: true, sharpness: true, ink: true },
    source: "IBPS PO — Guidelines for Scanning and Upload of Documents",
    family: "Banking", covers: "IBPS PO/Clerk/SO, SBI PO/Clerk, RBI Assistant/Grade B, LIC AAO/ADO",
    guidance: [
      "Sign on white paper with a black ink pen.",
      "Signature must NOT be in capital letters — a capitalised signature is not accepted.",
      "It must be clearly visible and not smudged or blurred.",
      "It must match the signature you give on the attendance sheet and call letter, or you are disqualified.",
    ],
  },
  "ibps-thumb": {
    label: "Banking (IBPS / SBI / RBI / LIC) — Left Thumb Impression",
    w: 240, h: 240, minKB: 20, maxKB: 50, dpi: 200,
    physical: "3 cm × 3 cm",
    checks: { face: false, background: true, sharpness: true, ink: true },
    source: "IBPS PO — Guidelines for Scanning and Upload of Documents",
    family: "Banking", covers: "IBPS PO/Clerk/SO, SBI PO/Clerk, RBI Assistant/Grade B, LIC AAO/ADO",
    guidance: [
      "Left thumb impression on white paper, in black or blue ink.",
      "If you have no left thumb, use the right thumb; then a left-hand finger from the forefinger, then a right-hand finger, then the left toe.",
      "If anything other than the left thumb is used, name the finger and the hand/toe in the uploaded document.",
      "It must be clear and not smudged — a smudged impression can get the application rejected.",
    ],
  },
  "ibps-declaration": {
    label: "Banking (IBPS / SBI / RBI / LIC) — Hand-written Declaration",
    w: 800, h: 400, minKB: 50, maxKB: 100, dpi: 200,
    physical: "10 cm × 5 cm",
    checks: { face: false, background: true, sharpness: true, ink: true },
    source: "IBPS PO — Guidelines for Scanning and Upload of Documents",
    family: "Banking", covers: "IBPS PO/Clerk/SO, SBI PO/Clerk, RBI Assistant/Grade B, LIC AAO/ADO",
    guidance: [
      'Write, in your own hand and in English: "I, ______ (Name of the candidate), hereby declare that all the information submitted by me in the application form is correct, true and valid. I will present the supporting documents as and when required."',
      "Black ink on white paper. The text must NOT be in capital letters.",
      "It must be in the candidate's own handwriting — written by anyone else, or in any other language, makes the application invalid.",
      "Candidates who cannot write may type the declaration and add their left thumb impression below it.",
    ],
  },

  // --- Exam-family presets ------------------------------------------------
  // Grouped by specification, not by exam name. Around 30 major exams share
  // only these few distinct sizes, so one entry per family covers them all
  // instead of repeating identical rows 30 times. `covers` lists the exams a
  // family applies to, and the UI shows it so a candidate can confirm theirs
  // is included.
  //
  // Where a family's members differ slightly, the entry takes the
  // INTERSECTION of their limits, which is valid for every member: NTA's
  // photo is 10-200 KB except CTET at 10-100, so the family uses 10-100.
  //
  // These are commonly published values (source: null) — the UI flags them as
  // unverified, unlike the IBPS block above which is transcribed from the
  // official guidelines.
  "ssc-photo": {
    label: "SSC — Photograph", w: 100, h: 120, minKB: 20, maxKB: 50, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, family: "SSC", covers: "CGL, CHSL, MTS, GD, JE, Stenographer",
    guidance: ["Recent passport-size colour photo on a white or light background.",
               "Face should fill 70–80% of the frame. No cap, hat or sunglasses."],
  },
  "ssc-sign": {
    label: "SSC — Signature", w: 140, h: 60, minKB: 10, maxKB: 20, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, family: "SSC", covers: "CGL, CHSL, MTS, GD, JE, Stenographer",
    guidance: ["Sign on white paper in black or blue ink, then crop to the signature.",
               "Must not be in capital or block letters."],
  },
  "upsc-photo": {
    label: "UPSC — Photograph", w: 350, h: 350, minKB: 20, maxKB: 300, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, family: "UPSC", covers: "CSE, CDS, NDA, CAPF",
    guidance: ["Square photo — 350 × 350 px.",
               "Recent passport-style colour photo on a light background."],
  },
  "upsc-sign": {
    label: "UPSC — Signature", w: 350, h: 100, minKB: 20, maxKB: 300, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, family: "UPSC", covers: "CSE, CDS, NDA, CAPF",
    guidance: ["Sign on white paper in black or blue ink, then crop to the signature."],
  },
  "rrb-photo": {
    label: "Railway (RRB) — Photograph", w: 320, h: 240, minKB: 20, maxKB: 50, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, family: "Railway", covers: "RRB NTPC, Group D, ALP, JE",
    guidance: ["Landscape 320 × 240 px — wider than it is tall.",
               "Recent colour photo on a light background."],
  },
  "rrb-sign": {
    label: "Railway (RRB) — Signature", w: 140, h: 60, minKB: 10, maxKB: 40, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, family: "Railway", covers: "RRB NTPC, Group D, ALP, JE",
    guidance: ["Sign on white paper in black or blue ink, then crop to the signature."],
  },
  "nta-photo": {
    label: "NTA (JEE / NEET / CUET / UGC NET / CTET) — Photograph", w: 200, h: 230, minKB: 10, maxKB: 100, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, family: "NTA", covers: "JEE Main, NEET UG, CUET UG, UGC NET, CTET",
    guidance: ["Capped at 100 KB so the file is valid for CTET as well as the 200 KB exams.",
               "Recent passport-size colour photo on a white background."],
  },
  "nta-sign": {
    label: "NTA (JEE / NEET / CUET / UGC NET / CTET) — Signature", w: 140, h: 60, minKB: 4, maxKB: 30, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, family: "NTA", covers: "JEE Main, NEET UG, CUET UG, UGC NET, CTET",
    guidance: ["Sign on white paper in black or blue ink. Not in capital letters."],
  },
  "afcat-photo": {
    label: "AFCAT — Photograph", w: 200, h: 230, minKB: 10, maxKB: 50, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, family: "AFCAT", covers: "AFCAT",
    guidance: ["Recent passport-size colour photo on a light background."],
  },
  "afcat-sign": {
    label: "AFCAT — Signature", w: 140, h: 60, minKB: 10, maxKB: 50, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, family: "AFCAT", covers: "AFCAT",
    guidance: ["Sign on white paper in black or blue ink, then crop to the signature."],
  },
  "statepsc-photo": {
    label: "State PSC — Photograph", w: 200, h: 230, minKB: 20, maxKB: 50, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, family: "State PSC", covers: "UPPSC, BPSC, MPSC, RPSC and most others",
    guidance: ["Typical State PSC requirement — always confirm against your own notification.",
               "Recent passport-size colour photo on a light background."],
  },
  "statepsc-sign": {
    label: "State PSC — Signature", w: 140, h: 60, minKB: 10, maxKB: 20, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, family: "State PSC", covers: "UPPSC, BPSC, MPSC, RPSC and most others",
    guidance: ["Sign on white paper in black or blue ink, then crop to the signature."],
  },

  custom: {
    label: "Custom Dimensions",
    w: 0, h: 0, minKB: 0, maxKB: 0, dpi: 200, physical: null,
    checks: { face: false, background: false, sharpness: true, ink: false },
    source: null,
    guidance: [],
  },
};

// Which document a preset targets. Drives the Photograph / Signature switch at
// the top of the tool, so a candidate picks what they are uploading first and
// only ever sees the presets that apply to it.
export const presetKind = (key) =>
  key.endsWith("-photo") ? "photo" : key.endsWith("-sign") ? "sign" : "other";

// Name for the exam-preset dropdown. The document type is already chosen above
// it, so "SSC — Photograph" would say Photograph twice; show just the family.
// "Other" keeps its full label, because there the suffix is the distinguishing
// part (thumb impression vs hand-written declaration), not a repeat.
export const presetFamilyLabel = (key, preset) => {
  const family = preset.family || preset.label.split(" — ")[0];
  // Spell out the exams a family covers, unless the list would just repeat the
  // family name (AFCAT covers only AFCAT).
  const scope = preset.covers && preset.covers !== family
    ? `${family} (${preset.covers})`
    : family;
  // "Other" keeps the document name in front — there the suffix distinguishes
  // thumb impression from hand-written declaration rather than repeating the
  // type, and the exam list still follows so a candidate sitting SBI or Clerk
  // can see the spec applies to them and not only to IBPS PO.
  return presetKind(key) === "other"
    ? `${preset.label.split(" — ").pop()} — ${scope}`
    : scope;
};

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = /^image\/(jpeg|jpg|png|webp)$/;

export function describeTarget(t) {
  if (!t) return "No preset selected";
  const size = t.maxKB ? ` · ${t.minKB ? `${t.minKB}–` : "≤ "}${t.maxKB} KB` : " · no size limit";
  const physical = t.physical ? ` (${t.physical})` : "";
  return `${t.label} — ${t.w} × ${t.h} px${physical}${size} · JPEG @ ${t.dpi} DPI`;
}

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

// Shrink towards the target by repeated halving, and return the last step.
//
// This is what stops a signature coming out washed out. drawImage resamples in
// one pass with a fixed-size kernel, so over the ~20× reduction a phone photo
// needs to reach 140 × 60 most source pixels never contribute at all: a stroke
// six source pixels wide lands on a third of an output pixel and is averaged
// into the paper around it. Halving averages every pixel on the way down, so
// the stroke keeps its weight and its edges.
//
// Only ever downscales, and stops one step short of the target so the caller's
// drawImage still does the final fractional resize.
function prescale(img, dw, dh) {
  // A zero-width target would never satisfy the loop's exit condition.
  if (!(dw > 0) || !(dh > 0)) return img;

  let src = img;
  let w = img.width;
  let h = img.height;
  while (w >= dw * 2 && h >= dh * 2) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    const step = document.createElement("canvas");
    step.width = w;
    step.height = h;
    const ctx = step.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    src = step;
  }
  return src;
}

// Draw onto a w×h canvas matted on white (JPEG has no alpha channel).
// mode: "cover" crops to fill, "contain" fits inside, "stretch" distorts.
export function renderToCanvas(img, w, h, mode) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";

  // Where the image lands, worked out before anything is drawn so the source
  // can be stepped down to roughly that size first.
  let dw = w;
  let dh = h;
  if (mode !== "stretch") {
    const scale =
      mode === "contain"
        ? Math.min(w / img.width, h / img.height)
        : Math.max(w / img.width, h / img.height);
    dw = img.width * scale;
    dh = img.height * scale;
  }
  ctx.drawImage(prescale(img, dw, dh), (w - dw) / 2, (h - dh) / 2, dw, dh);
  return canvas;
}

// --- Output finishing ------------------------------------------------------
// Applied to the finished canvas, before encoding, so the checklist and the
// downloaded file both describe the same pixels. Neither step moves a stroke or
// changes the dimensions — they restore contrast and edge definition the
// downscale cost, which is what a scanner's document mode does.

// Sharpening a downscale is standard; sharpening an enlargement only crunches
// up the artefacts, so callers pass whether the image was actually reduced.
// Ink gets the stronger amount: a pen stroke is the whole subject, whereas on a
// face a heavy amount shows as halos around the chin and hairline.
const INK_SHARPEN = 0.8;
const PHOTO_SHARPEN = 0.35;

// Paper lighter than this is not paper — a dark or heavily shaded photo would
// only be made worse by stretching it, so it is left alone.
const PAPER_MIN_LUM = 150;
// Ceiling on how hard the stretch may pull. A signature reduced this far is
// mostly sub-pixel strokes, so the measured ink is often only 60 levels below
// the paper and the honest gain would be large; unbounded, a photo with uneven
// lighting would have its shaded half pulled down into a blotch along with the
// ink. Six is enough to rescue a washed-out stroke and stops well short of that.
const MAX_LEVEL_GAIN = 6;
const MIN_LEVEL_RANGE = 12; // below this there is nothing but paper to stretch

// Luminance percentile from a 256-bin histogram.
const lumPercentile = (hist, total, p) => {
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= total * p) return v;
  }
  return 255;
};

// Pull the paper to white and the ink towards black.
//
// This is the step that fixes a washed-out signature, and the reason it is
// needed is arithmetic rather than any fault in the resize: a pen stroke six
// pixels wide in a 2800 px photo is a third of a pixel at 140 px, so averaging
// it correctly with the paper around it *must* produce mid-grey. The detail is
// all there — it is the contrast that the reduction spends. Re-stretching the
// measured paper back to white and the measured ink back down restores it.
export function normalizeInkLevels(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;

  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    hist[(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0]++;
  }
  const total = data.length / 4;
  // 92nd percentile rather than the maximum, so one blown-out highlight cannot
  // decide where the paper is; 1st rather than the minimum, for the same reason
  // at the ink end.
  const white = lumPercentile(hist, total, 0.92);
  const black = lumPercentile(hist, total, 0.01);
  if (white < PAPER_MIN_LUM || white - black < MIN_LEVEL_RANGE) return false;

  // Anchored at the paper — paper maps to white, and everything below it moves
  // down by its own distance from the paper, amplified. Written this way rather
  // than as a black-to-white stretch because it is the paper that must not
  // move: capping the gain then only limits how hard the ink is pulled, instead
  // of leaving the paper grey.
  const gain = Math.min(MAX_LEVEL_GAIN, 255 / (white - black));
  // One LUT, applied to all three channels: it keeps a blue pen blue instead of
  // flattening the scan to grey.
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = 255 - (white - v) * gain;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  ctx.putImageData(image, 0, 0);
  return true; // reported on the checklist, so it is never a silent change
}

// Unsharp mask: original + amount × (original − blur), with a separable 1-2-1
// blur. The canvas here is a few thousand pixels, so the cost is nil.
export function unsharpMask(canvas, amount) {
  if (!(amount > 0)) return canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const image = ctx.getImageData(0, 0, w, h);
  const { data } = image;

  // Horizontal pass into a scratch buffer, so the vertical pass below reads
  // blurred values taken from the untouched original.
  const blurred = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const left = (y * w + (x > 0 ? x - 1 : 0)) * 4;
      const mid = (y * w + x) * 4;
      const right = (y * w + (x < w - 1 ? x + 1 : w - 1)) * 4;
      for (let c = 0; c < 3; c++) {
        blurred[(y * w + x) * 3 + c] = (data[left + c] + 2 * data[mid + c] + data[right + c]) / 4;
      }
    }
  }
  // Vertical pass, combined with the mask in the same step. data is a
  // Uint8ClampedArray, so it rounds and clamps the result on assignment.
  for (let y = 0; y < h; y++) {
    const above = (y > 0 ? y - 1 : 0) * w;
    const below = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        const blur =
          (blurred[(above + x) * 3 + c] +
            2 * blurred[(y * w + x) * 3 + c] +
            blurred[(below + x) * 3 + c]) /
          4;
        const i = (y * w + x) * 4 + c;
        data[i] = data[i] + amount * (data[i] - blur);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// The finishing pass as the page uses it: levels for ink documents, sharpening
// for anything that was reduced to get here. Mutates the canvas in place and
// returns what it did, which the checklist reports.
export function enhanceOutput(canvas, target, srcImg) {
  const ink = !!target.checks?.ink;
  const levels = ink ? normalizeInkLevels(canvas) : false;
  // Sharpen only a real reduction — 1.2× per side, so an image already close to
  // the target size is left as it is rather than given edges it never had.
  const shrank = !!(
    srcImg && srcImg.width * srcImg.height >= canvas.width * canvas.height * 1.44
  );
  if (shrank) unsharpMask(canvas, ink ? INK_SHARPEN : PHOTO_SHARPEN);
  return { levels, sharpened: shrank };
}

const toBlob = (canvas, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

// Canvas writes a JFIF header with no real resolution ("units = 0", aspect
// ratio only). The guidelines ask for 200 DPI, so stamp the density fields in
// the APP0 segment. Byte count is unchanged, so the KB budget still holds.
//
// JFIF APP0 layout: FFD8 | FFE0 len(2) "JFIF\0" ver(2) units(1) Xden(2) Yden(2)
export async function setJpegDpi(blob, dpi) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const isJfif =
    bytes[0] === 0xff && bytes[1] === 0xd8 && // SOI
    bytes[2] === 0xff && bytes[3] === 0xe0 && // APP0
    bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46; // "JFIF"
  if (!isJfif) return blob; // unexpected encoder output — leave it alone

  bytes[13] = 1; // units: 1 = dots per inch
  bytes[14] = (dpi >> 8) & 0xff;
  bytes[15] = dpi & 0xff;
  bytes[16] = (dpi >> 8) & 0xff;
  bytes[17] = dpi & 0xff;
  return new Blob([bytes], { type: "image/jpeg" });
}

// Read back the DPI written above (used by the tests and the health check).
export async function readJpegDpi(blob) {
  const b = new Uint8Array(await blob.slice(0, 20).arrayBuffer());
  if (b[2] !== 0xff || b[3] !== 0xe0 || b[13] !== 1) return null;
  return (b[14] << 8) | b[15];
}

// Binary-search JPEG quality so the encoded size lands inside [minKB, maxKB].
export async function encodeWithinBudget(canvas, minKB, maxKB) {
  if (!maxKB) return { blob: await toBlob(canvas, 0.92), quality: 0.92 };

  let lo = 0.2;
  let hi = 0.98;
  let best = null;
  let bestQ = 0.2;
  for (let i = 0; i < 8; i++) {
    const q = (lo + hi) / 2;
    const blob = await toBlob(canvas, q);
    if (blob.size <= maxKB * 1024) {
      best = blob;
      bestQ = q;
      lo = q; // fits — try higher quality
    } else {
      hi = q; // too big — back off
    }
  }
  if (!best) {
    best = await toBlob(canvas, 0.2);
    bestQ = 0.2;
  }

  // Under the floor? Nudge quality up while staying inside the ceiling.
  if (minKB && best.size < minKB * 1024) {
    for (let q = bestQ + 0.02; q <= 1; q += 0.02) {
      const blob = await toBlob(canvas, Math.min(q, 1));
      if (blob.size > maxKB * 1024) break;
      best = blob;
      bestQ = Math.min(q, 1);
      if (blob.size >= minKB * 1024) break;
    }
  }
  return { blob: best, quality: bestQ };
}

// Grow a JPEG to a minimum byte count by inserting COM (comment) segments.
//
// Why this exists: some minimums cannot be met by quality alone. An IBPS
// signature is 140 × 60 px — 8,400 pixels — which encodes to roughly 3–6 KB
// even at quality 100, well under the 10 KB floor the guidelines set. Raising
// quality or re-scanning cannot fix that; the pixel budget is the limit. A COM
// segment is standard JPEG metadata that every decoder skips, so the picture
// is byte-for-byte identical while the file reaches the required size.
export async function padJpegToSize(blob, minBytes) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let needed = minBytes - bytes.length;
  if (needed <= 4) return { blob, padded: false };

  // Insert after SOI + APP0 so the JFIF header stays where decoders expect it.
  const app0End = bytes[2] === 0xff && bytes[3] === 0xe0 ? 4 + ((bytes[4] << 8) | bytes[5]) : 2;

  const segments = [];
  while (needed > 4) {
    const payload = Math.min(needed - 4, 65533);
    const seg = new Uint8Array(payload + 4);
    seg[0] = 0xff;
    seg[1] = 0xfe; // COM
    seg[2] = ((payload + 2) >> 8) & 0xff;
    seg[3] = (payload + 2) & 0xff;
    seg.fill(0x20, 4); // spaces — never 0xFF, which naive parsers trip on
    segments.push(seg);
    needed -= seg.length;
  }

  return {
    blob: new Blob([bytes.subarray(0, app0End), ...segments, bytes.subarray(app0End)], {
      type: "image/jpeg",
    }),
    padded: true,
  };
}

// Median luminance of the border, as a proxy for "light-coloured, preferably
// white" backgrounds.
//
// Two deliberate choices, both because a passport crop is mostly subject:
//   - the bottom band is skipped and the side bands stop at 60% height, since
//     that lower region is shoulders and clothing, not background;
//   - the median, not the mean, so whatever subject does intrude (stray hair,
//     a collar) can't drag an otherwise white background into a false warning.
export function backgroundWhiteness(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.08));
  const sideHeight = Math.max(band, Math.round(h * 0.6));

  const regions = [
    ctx.getImageData(0, 0, w, band), // top edge — the most reliable sample
    ctx.getImageData(0, 0, band, sideHeight), // upper left
    ctx.getImageData(w - band, 0, band, sideHeight), // upper right
  ];

  const lums = [];
  for (const r of regions) {
    for (let i = 0; i < r.data.length; i += 8) {
      // every 2nd pixel is plenty
      lums.push(0.299 * r.data[i] + 0.587 * r.data[i + 1] + 0.114 * r.data[i + 2]);
    }
  }
  if (!lums.length) return 0;
  lums.sort((a, b) => a - b);
  return lums[Math.floor(lums.length / 2)];
}

// Variance of the Laplacian on a grayscale copy — the standard blur metric.
export function sharpnessScore(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const lap = 4 * gray[p] - gray[p - 1] - gray[p + 1] - gray[p - w] - gray[p + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// Share of clearly dark pixels — catches a blank/too-faint scan at one end and
// a smudged or fully shaded one at the other.
export function inkCoverage(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let dark = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 128) dark++;
    n++;
  }
  return n ? dark / n : 0;
}

// --- Face visibility -------------------------------------------------------
// This is the one check that is not a local measurement. The in-browser option,
// window.FaceDetector, is behind a flag on Chrome desktop and absent from
// Firefox and Safari, so in practice it always fell through to "check manually"
// — the row told every candidate to eyeball their own photo. The backend runs
// OpenCV's YuNet detector instead (see backend/face_check.py) and returns
// geometry; the wording below is this file's job, like every other row.
//
// Fallback order: server, then window.FaceDetector where it happens to exist,
// then "check manually". Nothing here ever reports a pass it did not establish
// — in particular there is no head-tilt or "eyes visible" row, because the
// detector cannot support either (backend/face_check.py explains why).

// Warning thresholds, all as a share of the output frame. Deliberately loose:
// these back a "retake your photo" nudge, so a false alarm on an acceptable
// photo costs more than staying quiet about a borderline one.
const FACE_MIN_HEIGHT = 0.3; // below this the face is lost in the frame
const FACE_MAX_HEIGHT = 0.92; // above this the crop has cut into the head
const FACE_MAX_OFFSET_X = 0.18;

// Turn the backend's geometry into one checklist row. Only the first problem is
// reported: a candidate fixes their photo by retaking it, so a list of four
// complaints is no more useful than the biggest one.
function describeFaces({ faces, primary }) {
  if (!faces) {
    return {
      status: "fail",
      text: "No face detected",
      hint: "Use a straight-on, well-lit passport-style photo. A profile view, a dark photo or a covered face will be rejected at upload.",
    };
  }
  if (faces > 1) {
    return {
      status: "warn",
      text: `${faces} faces found`,
      hint: "Only the candidate may appear in the photo — crop out anyone else in the frame.",
    };
  }

  const pct = Math.round(primary.heightRatio * 100);
  if (primary.heightRatio < FACE_MIN_HEIGHT) {
    return {
      status: "warn",
      text: `Face too small (${pct}% of height)`,
      hint: "Crop closer so the face fills most of the frame — head-and-shoulders, not a full-length photo.",
    };
  }
  if (primary.heightRatio > FACE_MAX_HEIGHT) {
    return {
      status: "warn",
      text: `Face fills the frame (${pct}%)`,
      hint: "Leave a little space above the head and below the chin, or switch the crop button to fit on white.",
    };
  }
  if (Math.abs(primary.offCenterX) > FACE_MAX_OFFSET_X) {
    return {
      status: "warn",
      text: "Face off-centre",
      hint: "Centre the face horizontally in the frame.",
    };
  }
  return { status: "pass", text: `1 face · ${pct}% of height` };
}

// window.FaceDetector, used only when the server check is unavailable. It gives
// a count and nothing else, so the row is correspondingly thinner.
async function detectFaceOnDevice(canvas) {
  if (!("FaceDetector" in window)) return null;
  try {
    const faces = await new window.FaceDetector({ fastMode: true }).detect(canvas);
    if (faces.length === 1) return { status: "pass", text: "1 face" };
    if (faces.length === 0) return { status: "warn", text: "None found" };
    return { status: "warn", text: `${faces.length} faces` };
  } catch {
    return null;
  }
}

// Smaller than the backend's own floor, so there is nothing to find. Worth
// checking here because the re-encode runs on every keystroke: a width typed as
// "3" then "35" on the way to "350" would otherwise post two doomed requests.
const FACE_MIN_SIDE = 32; // keep in step with face_check.MIN_SIDE

// Last definitive answer, reused while nothing that could change it has moved.
// The re-encode effect re-runs on every keystroke in the size fields and this is
// the only row that costs a request, so editing Max KB or toggling the padding
// checkbox must not fire one. Only the source image, the output dimensions and
// the fit mode can alter the result. A "check manually" fallback is never
// cached: a dropped connection has to be free to succeed on the next attempt.
let lastFace = null;

export async function detectFace(canvas, blob, { img = null, mode = null } = {}) {
  const { width: w, height: h } = canvas;
  if (
    lastFace &&
    img &&
    lastFace.img === img &&
    lastFace.mode === mode &&
    lastFace.w === w &&
    lastFace.h === h
  ) {
    return lastFace.row;
  }

  let row = null;
  if (blob && Math.min(w, h) >= FACE_MIN_SIDE) {
    // Resolves to null on any failure — an offline candidate or a 503 must not
    // turn into a claim about their photo.
    const result = await toolsApi.checkFace(blob);
    if (result && typeof result.faces === "number") row = describeFaces(result);
  }
  row = row || (await detectFaceOnDevice(canvas)) || { status: "skip", text: "Check manually" };

  if (img && row.status !== "skip") lastFace = { img, mode, w, h, row };
  return row;
}

// Ordered health report for an encoded result. Only the checks that apply to
// this document type are included.
//
// `blob` and `face` serve the face row alone: it is the only check measured off
// the encoded file rather than the canvas, because it is the only one that runs
// on the server. `face` is { img, mode } — the source image and fit mode — and
// is what lets detectFace skip a repeat request.
//
// `source` is the uploaded image's own { w, h }, used only to tell a soft result
// caused by an enlarged source apart from one the candidate can do nothing about.
// `enhanced` is enhanceOutput's report, so the rows can say what was done.
export async function runHealthChecks(
  canvas,
  target,
  bytes,
  { padded = false, blob = null, face = null, source = null, enhanced = null } = {},
) {
  const rows = [];
  const kb = bytes / 1024;

  if (target.checks.face) {
    rows.push({
      key: "face",
      label: "Face Visibility",
      ...(await detectFace(canvas, blob, face || {})),
    });
  }

  if (target.checks.ink) {
    const ink = inkCoverage(canvas);
    const pct = (ink * 100).toFixed(1);
    const row = { key: "ink", label: "Ink Visibility" };
    if (ink < 0.005) Object.assign(row, { status: "fail", text: `Too faint (${pct}%)` });
    else if (ink < 0.02) Object.assign(row, { status: "warn", text: `Faint (${pct}%)` });
    else if (ink <= 0.35) Object.assign(row, { status: "pass", text: `Clear (${pct}%)` });
    else if (ink <= 0.5) Object.assign(row, { status: "warn", text: `Heavy (${pct}%)` });
    else Object.assign(row, { status: "fail", text: `Smudged (${pct}%)` });
    // Same principle as the padding note on the file-size row: the tool changed
    // something about the file, so it says so rather than leaving the candidate
    // to wonder why the download looks darker than what they uploaded.
    if (enhanced?.levels) {
      row.hint =
        "Contrast was restored after resizing — the paper pulled back to white and the ink darkened. " +
        "Shrinking to this size averages a thin stroke into the paper around it, which is what makes an " +
        "untouched resize look faded. The strokes themselves are unchanged.";
    }
    rows.push(row);
  }

  if (target.checks.background) {
    const white = backgroundWhiteness(canvas);
    if (white >= 225) rows.push({ key: "background", label: "Background (White)", status: "pass", text: "White" });
    else if (white >= 190) rows.push({ key: "background", label: "Background (White)", status: "warn", text: "Off-white" });
    else rows.push({ key: "background", label: "Background (White)", status: "fail", text: "Too dark" });
  }

  if (target.checks.sharpness) {
    const sharp = sharpnessScore(canvas);
    const row = {
      key: "sharpness",
      label: "Image Sharpness",
      ...(sharp >= 120
        ? { status: "pass", text: "Sharp" }
        : sharp >= 40
          ? { status: "warn", text: "Soft" }
          : { status: "fail", text: "Blurry" }),
    };
    // Say why, when the reason is the source rather than anything the tool did.
    // Enlarging invents pixels, so a soft result here is the one case no amount
    // of resampling or sharpening can fix — only a better scan can.
    if (row.status !== "pass" && source && source.w < target.w && source.h < target.h) {
      row.hint =
        `Enlarged from ${source.w} × ${source.h} px, so there is no detail to sharpen. ` +
        `Re-scan at ${target.dpi} DPI, or photograph it closer, for a crisp result.`;
    }
    rows.push(row);
  }

  rows.push({
    key: "dimensions",
    label: "Dimensions & Ratio",
    status: "pass",
    text: `${canvas.width} × ${canvas.height}`,
  });

  let filesize;
  if (!target.maxKB) filesize = { status: "pass", text: `${kb.toFixed(1)} KB` };
  else if (kb > target.maxKB) filesize = { status: "fail", text: `${kb.toFixed(1)} KB > ${target.maxKB} KB` };
  else if (target.minKB && kb < target.minKB)
    filesize = {
      status: "warn",
      text: `${kb.toFixed(1)} KB < ${target.minKB} KB`,
      // Only reachable by a few bytes: padding to the floor is unconditional
      // now, and padJpegToSize stops when it is within one segment header of
      // the target. Quality is already at its ceiling and the dimensions are
      // fixed by the preset, so nothing about the source image can raise it.
      hint: `${target.w} × ${target.h} px cannot quite encode to ${target.minKB} KB. Most portals accept this, but check yours before uploading.`,
    };
  else if (padded)
    filesize = {
      status: "pass",
      text: `JPEG · ${kb.toFixed(1)} KB`,
      hint: `Padded with JPEG comment metadata to clear the ${target.minKB} KB minimum. The picture itself is unchanged.`,
    };
  else filesize = { status: "pass", text: `JPEG · ${kb.toFixed(1)} KB` };
  rows.push({ key: "filesize", label: "Format & File Size", ...filesize });

  rows.push({ key: "dpi", label: `Resolution (${target.dpi} DPI)`, status: "pass", text: `${target.dpi} DPI` });

  return rows;
}
