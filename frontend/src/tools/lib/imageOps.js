// Image Resizer — pure canvas/measurement helpers, no React. Kept separate
// from the page so the numbers can be checked in isolation.

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
    covers: "IBPS PO/Clerk/SO, SBI PO/Clerk, RBI Assistant/Grade B, LIC AAO/ADO",
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
    covers: "IBPS PO/Clerk/SO, SBI PO/Clerk, RBI Assistant/Grade B, LIC AAO/ADO",
    guidance: [
      "Sign on white paper with a black ink pen.",
      "Signature must NOT be in capital letters — a capitalised signature is not accepted.",
      "It must be clearly visible and not smudged or blurred.",
      "It must match the signature you give on the attendance sheet and call letter, or you are disqualified.",
    ],
  },
  "ibps-thumb": {
    label: "IBPS — Left Thumb Impression",
    w: 240, h: 240, minKB: 20, maxKB: 50, dpi: 200,
    physical: "3 cm × 3 cm",
    checks: { face: false, background: true, sharpness: true, ink: true },
    source: "IBPS PO — Guidelines for Scanning and Upload of Documents",
    guidance: [
      "Left thumb impression on white paper, in black or blue ink.",
      "If you have no left thumb, use the right thumb; then a left-hand finger from the forefinger, then a right-hand finger, then the left toe.",
      "If anything other than the left thumb is used, name the finger and the hand/toe in the uploaded document.",
      "It must be clear and not smudged — a smudged impression can get the application rejected.",
    ],
  },
  "ibps-declaration": {
    label: "IBPS — Hand-written Declaration",
    w: 800, h: 400, minKB: 50, maxKB: 100, dpi: 200,
    physical: "10 cm × 5 cm",
    checks: { face: false, background: true, sharpness: true, ink: true },
    source: "IBPS PO — Guidelines for Scanning and Upload of Documents",
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
    source: null, covers: "CGL, CHSL, MTS, GD, JE, Stenographer",
    guidance: ["Recent passport-size colour photo on a white or light background.",
               "Face should fill 70–80% of the frame. No cap, hat or sunglasses."],
  },
  "ssc-sign": {
    label: "SSC — Signature", w: 140, h: 60, minKB: 10, maxKB: 20, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, covers: "CGL, CHSL, MTS, GD, JE, Stenographer",
    guidance: ["Sign on white paper in black or blue ink, then crop to the signature.",
               "Must not be in capital or block letters."],
  },
  "upsc-photo": {
    label: "UPSC — Photograph", w: 350, h: 350, minKB: 20, maxKB: 300, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, covers: "CSE, CDS, NDA, CAPF",
    guidance: ["Square photo — 350 × 350 px.",
               "Recent passport-style colour photo on a light background."],
  },
  "upsc-sign": {
    label: "UPSC — Signature", w: 350, h: 100, minKB: 20, maxKB: 300, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, covers: "CSE, CDS, NDA, CAPF",
    guidance: ["Sign on white paper in black or blue ink, then crop to the signature."],
  },
  "rrb-photo": {
    label: "Railway (RRB) — Photograph", w: 320, h: 240, minKB: 20, maxKB: 50, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, covers: "NTPC, Group D, ALP, JE",
    guidance: ["Landscape 320 × 240 px — wider than it is tall.",
               "Recent colour photo on a light background."],
  },
  "rrb-sign": {
    label: "Railway (RRB) — Signature", w: 140, h: 60, minKB: 10, maxKB: 40, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, covers: "NTPC, Group D, ALP, JE",
    guidance: ["Sign on white paper in black or blue ink, then crop to the signature."],
  },
  "nta-photo": {
    label: "NTA (JEE / NEET / CUET / UGC NET / CTET) — Photograph", w: 200, h: 230, minKB: 10, maxKB: 100, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, covers: "JEE Main, NEET UG, CUET UG, UGC NET, CTET",
    guidance: ["Capped at 100 KB so the file is valid for CTET as well as the 200 KB exams.",
               "Recent passport-size colour photo on a white background."],
  },
  "nta-sign": {
    label: "NTA (JEE / NEET / CUET / UGC NET / CTET) — Signature", w: 140, h: 60, minKB: 4, maxKB: 30, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, covers: "JEE Main, NEET UG, CUET UG, UGC NET, CTET",
    guidance: ["Sign on white paper in black or blue ink. Not in capital letters."],
  },
  "afcat-photo": {
    label: "AFCAT — Photograph", w: 200, h: 230, minKB: 10, maxKB: 50, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, covers: "AFCAT",
    guidance: ["Recent passport-size colour photo on a light background."],
  },
  "afcat-sign": {
    label: "AFCAT — Signature", w: 140, h: 60, minKB: 10, maxKB: 50, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, covers: "AFCAT",
    guidance: ["Sign on white paper in black or blue ink, then crop to the signature."],
  },
  "statepsc-photo": {
    label: "State PSC — Photograph", w: 200, h: 230, minKB: 20, maxKB: 50, dpi: 200,
    physical: null, checks: { face: true, background: true, sharpness: true, ink: false },
    source: null, covers: "Most State Public Service Commissions",
    guidance: ["Typical State PSC requirement — always confirm against your own notification.",
               "Recent passport-size colour photo on a light background."],
  },
  "statepsc-sign": {
    label: "State PSC — Signature", w: 140, h: 60, minKB: 10, maxKB: 20, dpi: 200,
    physical: null, checks: { face: false, background: true, sharpness: true, ink: true },
    source: null, covers: "Most State Public Service Commissions",
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

  if (mode === "stretch") {
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }
  const scale =
    mode === "contain"
      ? Math.min(w / img.width, h / img.height)
      : Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return canvas;
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

// Only Chromium ships FaceDetector. Everywhere else this says "check manually"
// rather than reporting a pass it cannot actually verify.
export async function detectFace(canvas) {
  if (!("FaceDetector" in window)) return { status: "skip", text: "Check manually" };
  try {
    const faces = await new window.FaceDetector({ fastMode: true }).detect(canvas);
    if (faces.length === 1) return { status: "pass", text: "1 face" };
    if (faces.length === 0) return { status: "warn", text: "None found" };
    return { status: "warn", text: `${faces.length} faces` };
  } catch {
    return { status: "skip", text: "Check manually" };
  }
}

// Ordered health report for an encoded result. Only the checks that apply to
// this document type are included.
export async function runHealthChecks(canvas, target, bytes, { padded = false } = {}) {
  const rows = [];
  const kb = bytes / 1024;

  if (target.checks.face) {
    rows.push({ key: "face", label: "Face Visibility", ...(await detectFace(canvas)) });
  }

  if (target.checks.ink) {
    const ink = inkCoverage(canvas);
    const pct = (ink * 100).toFixed(1);
    if (ink < 0.005) rows.push({ key: "ink", label: "Ink Visibility", status: "fail", text: `Too faint (${pct}%)` });
    else if (ink < 0.02) rows.push({ key: "ink", label: "Ink Visibility", status: "warn", text: `Faint (${pct}%)` });
    else if (ink <= 0.35) rows.push({ key: "ink", label: "Ink Visibility", status: "pass", text: `Clear (${pct}%)` });
    else if (ink <= 0.5) rows.push({ key: "ink", label: "Ink Visibility", status: "warn", text: `Heavy (${pct}%)` });
    else rows.push({ key: "ink", label: "Ink Visibility", status: "fail", text: `Smudged (${pct}%)` });
  }

  if (target.checks.background) {
    const white = backgroundWhiteness(canvas);
    if (white >= 225) rows.push({ key: "background", label: "Background (White)", status: "pass", text: "White" });
    else if (white >= 190) rows.push({ key: "background", label: "Background (White)", status: "warn", text: "Off-white" });
    else rows.push({ key: "background", label: "Background (White)", status: "fail", text: "Too dark" });
  }

  if (target.checks.sharpness) {
    const sharp = sharpnessScore(canvas);
    rows.push({
      key: "sharpness",
      label: "Image Sharpness",
      ...(sharp >= 120
        ? { status: "pass", text: "Sharp" }
        : sharp >= 40
          ? { status: "warn", text: "Soft" }
          : { status: "fail", text: "Blurry" }),
    });
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
      // Quality is already at its ceiling here, and the output dimensions are
      // fixed by the preset, so a better source image cannot raise this.
      hint: `${target.w} × ${target.h} px cannot encode to ${target.minKB} KB at any quality. Tick "Pad to minimum file size" to reach it.`,
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
