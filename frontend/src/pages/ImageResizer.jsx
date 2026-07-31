// Public standalone tool at /image-resizer — no auth, no portal chrome. All
// image work runs on <canvas> in the browser; the uploaded file itself is never
// sent anywhere. Only the captured lead + job metadata go to BigQuery on
// download.
//
// One exception: for photographs the resized output is posted to
// /api/tools/image-resizer/face-check, measured with OpenCV in memory and
// dropped — no browser ships a face detector this can use. See imageOps'
// detectFace and backend/face_check.py.
//
// Layout note: on lg+ the page is locked to the viewport (h-screen +
// overflow-hidden) so it never scrolls — the dropzone absorbs the spare height
// and the checklist scrolls inside its own box. Below lg the page scrolls
// normally, because a phone viewport cannot hold this without clipping.
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { toolsApi } from "../api.js";
import {
  ACCEPTED_TYPES,
  MAX_INPUT_BYTES,
  PRESETS,
  encodeWithinBudget,
  loadImage,
  padJpegToSize,
  presetFamilyLabel,
  presetKind,
  renderToCanvas,
  runHealthChecks,
  setJpegDpi,
} from "../tools/lib/imageOps.js";

// Rows shown before anything has been processed. Derived from the chosen target
// rather than hard-coded, because the panel is the landing state now: a list
// that changes shape the moment an image arrives reads as a glitch. Order and
// labels track runHealthChecks, which is what fills these in for real.
const pendingChecks = (target) => {
  const c = target?.checks || { background: true, sharpness: true };
  return [
    c.face && { key: "face", label: "Face Visibility" },
    c.ink && { key: "ink", label: "Ink Visibility" },
    c.background && { key: "background", label: "Background (White)" },
    c.sharpness && { key: "sharpness", label: "Image Sharpness" },
    { key: "dimensions", label: "Dimensions & Ratio" },
    { key: "filesize", label: "Format & File Size" },
    { key: "dpi", label: `Resolution (${target?.dpi || 200} DPI)` },
  ].filter(Boolean);
};

const CHECK_STYLES = {
  pass: ["text-tool-success", "check_circle"],
  warn: ["text-[#b45309]", "warning"],
  fail: ["text-tool-error", "cancel"],
  skip: ["text-tool-secondary", "help"],
  pending: ["text-tool-secondary", "pending"],
};

// What the candidate is uploading. Chosen first, because it decides which
// presets can even apply.
const DOC_TYPES = [
  { key: "photo", label: "Photograph", icon: "account_box" },
  { key: "sign", label: "Signature", icon: "draw" },
  { key: "other", label: "Custom Image", icon: "description" },
];

// borderRadius.full is only 0.75rem in this theme, so true pills/circles need
// an explicit radius.
// Custom Dimensions start blank. They used to be pre-filled with the spec that
// suits most exams (200 x 230 at up to 50 KB), which produced a result the
// moment an image was dropped — but a number already sitting in the box reads
// as the size the candidate asked for, and a wrong photo size is rejected at
// upload. Blank forces the one decision only the candidate can make; the
// placeholders still show the shape of an answer.
const DEFAULT_CUSTOM = { w: "", h: "", kb: "" };

const PILL = "rounded-[999px]";
const CARD =
  "bg-tool-surface-lowest border border-tool-outline/70 rounded-xl shadow-[0_1px_2px_rgba(0,30,46,0.04),0_1px_3px_rgba(0,30,46,0.06)]";
const FIELD =
  "w-full bg-tool-surface-lowest border border-tool-outline/70 rounded-lg px-3 py-2.5 text-body-md text-tool-on-surface " +
  "placeholder:text-tool-secondary/60 focus:ring-2 focus:ring-tool-primary/30 focus:border-tool-primary outline-none transition-shadow";
const LABEL = "block text-label-sm font-medium uppercase tracking-wider text-tool-secondary mb-1.5";

// Empty-state art for the preview box. The panel is on screen from page load
// now, so this is the first thing a candidate sees, and a silhouette in the
// target's own aspect ratio says what the tool expects faster than a line of
// text can. Inline SVG: nothing to fetch, and it inherits the theme's colours.
//
// The frame is sized by the target so it previews the output shape — tall for a
// passport photo, wide for a signature — and the figure follows the document
// type, so switching Photograph → Signature visibly changes what is being asked
// for.
// Each viewBox is cropped to its own drawing rather than left at a uniform
// square: an SVG scales to fit its shorter side, so a square box around the
// signature squiggle left it stranded in the middle of a 140 × 60 frame.
const PLACEHOLDER_ART = {
  photo: {
    viewBox: "10 18 80 84",
    art: (
      <>
        <circle cx="50" cy="40" r="19" />
        <path d="M13 100c0-20 16.6-31 37-31s37 11 37 31z" />
      </>
    ),
  },
  sign: {
    viewBox: "4 30 92 48",
    art: (
      <path
        d="M10 68c12-4 17-30 24-30s3 34 11 34 9-22 15-22 4 16 10 16 12-6 20-14"
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        stroke="currentColor"
      />
    ),
  },
  other: {
    viewBox: "20 8 62 90",
    art: (
      <>
        <path d="M24 12h36l18 18v58a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6z" opacity=".35" />
        <rect x="36" y="46" width="34" height="6" rx="3" />
        <rect x="36" y="60" width="34" height="6" rx="3" />
        <rect x="36" y="74" width="22" height="6" rx="3" />
      </>
    ),
  },
};

const PLACEHOLDER_CAPTION = {
  photo: "Your passport photo will appear here",
  sign: "Your signature will appear here",
  other: "Your document will appear here",
};

function PreviewPlaceholder({ docType, target }) {
  // Clamped so a lopsided custom size (2000 × 50) still leaves a frame you can
  // see rather than a hairline.
  const ratio = Math.min(2.2, Math.max(0.45, (target?.w || 200) / (target?.h || 230)));
  const { viewBox, art } = PLACEHOLDER_ART[docType] || PLACEHOLDER_ART.other;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
      <div
        className="relative max-h-[62%] max-w-[62%] rounded-xl border-2 border-dashed border-tool-primary/25 bg-gradient-to-b from-tool-surface-low to-tool-surface-lowest p-[7%] shadow-[0_1px_2px_rgba(0,30,46,0.04)]"
        style={{ aspectRatio: ratio, width: ratio >= 1 ? "62%" : "auto", height: ratio >= 1 ? "auto" : "62%" }}
      >
        <svg viewBox={viewBox} className="h-full w-full text-tool-secondary/30" fill="currentColor">
          {art}
        </svg>
      </div>
      <p className="text-label-sm leading-snug text-tool-secondary">
        {PLACEHOLDER_CAPTION[docType] || PLACEHOLDER_CAPTION.other}
      </p>
    </div>
  );
}

function ChecklistRow({ row }) {
  const [cls, icon] = CHECK_STYLES[row.status || "pending"];
  return (
    <li className="rounded-lg px-2.5 py-2 hover:bg-tool-surface transition-colors">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body-md text-tool-on-surface">{row.label}</span>
        <span className={`flex items-center gap-1.5 shrink-0 text-label-md font-medium ${cls}`}>
          <Icon name={icon} size={16} />
          {row.text || "Pending"}
        </span>
      </div>
      {row.hint && (
        <p className="text-label-sm text-tool-secondary mt-1 leading-snug">{row.hint}</p>
      )}
    </li>
  );
}

export default function ImageResizer() {
  const fileRef = useRef(null);
  // Guards against an older async encode landing after a newer one.
  const runRef = useRef(0);
  // The blob URL currently shown. Revoked when replaced, and on unmount —
  // never from an effect cleanup keyed on `output`, because StrictMode's
  // double-invoke would then revoke the URL the preview is still displaying.
  const urlRef = useRef(null);

  const [source, setSource] = useState(null); // { img, name, label, size }
  const [docType, setDocType] = useState("photo");
  // Custom is the default: most candidates arrive with a size from their own
  // notification rather than one of the presets below.
  const [presetKey, setPresetKey] = useState("custom");
  const [custom, setCustom] = useState(DEFAULT_CUSTOM);
  const [fitMode, setFitMode] = useState("cover");
  const [output, setOutput] = useState(null);
  const [checks, setChecks] = useState(null);
  const [status, setStatus] = useState("Upload an image and set a size to begin.");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [leadOpen, setLeadOpen] = useState(false);
  const [lead, setLead] = useState({ name: "", phone: "", exam: "" });
  // Asks for a width and height when Custom is selected and they are blank.
  // Without it the tool just sits there: no preview, a disabled download
  // button, and a line of status text that is easy to miss.
  const [sizePromptOpen, setSizePromptOpen] = useState(false);

  const isCustom = presetKey === "custom";
  // A max-KB of blank is fine — it means "no ceiling". Width and height are
  // what the tool cannot proceed without.
  const customIncomplete =
    isCustom && (!(parseInt(custom.w, 10) > 0) || !(parseInt(custom.h, 10) > 0));
  const presetsForType = Object.entries(PRESETS).filter(
    ([key]) => key !== "custom" && presetKind(key) === docType,
  );

  // Drop the loaded image and everything derived from it.
  const resetImage = () => {
    // Supersede any encode still running, or it would finish after the reset
    // and put the old document's preview back on screen.
    runRef.current++;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setSource(null);
    setOutput(null);
    setChecks(null);
    setError("");
    // Without this, re-picking the same file after a reset fires no change
    // event and the dropzone appears dead.
    if (fileRef.current) fileRef.current.value = "";
  };

  // Switching document type keeps you in the same exam family where it has an
  // equivalent (SSC photo → SSC signature); otherwise it falls back to custom
  // rather than silently leaving a preset from the wrong type selected.
  const changeDocType = (next) => {
    if (next === docType) return;
    setDocType(next);
    // A photograph is not a signature. Carrying the uploaded file across the
    // switch left the new type showing — and running its checks against — the
    // old document, which reads as the tool ignoring the change.
    resetImage();
    if (presetKey === "custom") return;
    const family = presetKey.split("-")[0];
    const twin = `${family}-${next === "photo" ? "photo" : next === "sign" ? "sign" : ""}`;
    setPresetKey(PRESETS[twin] ? twin : "custom");
  };

  const target = (() => {
    if (!presetKey) return null;
    if (!isCustom) return PRESETS[presetKey];
    const w = parseInt(custom.w, 10);
    const h = parseInt(custom.h, 10);
    const maxKB = parseFloat(custom.kb);
    if (!w || !h) return null;
    return {
      ...PRESETS.custom,
      label: "Custom",
      w,
      h,
      maxKB: maxKB > 0 ? maxKB : 0,
      // A custom size still has a document type picked above it, so a
      // photograph gets the face row here just as a preset would. Without this
      // the default path — Custom dimensions — would never show the check at
      // all. The other rows stay as PRESETS.custom sets them.
      checks: { ...PRESETS.custom.checks, face: docType === "photo" },
    };
  })();

  const takeFile = useCallback(async (file) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.test(file.type)) return setError("Unsupported file. Use JPEG, PNG or WebP.");
    if (file.size > MAX_INPUT_BYTES) return setError("File is larger than 10MB.");
    try {
      const img = await loadImage(file);
      setError("");
      setSource({
        img,
        name: file.name.replace(/\.[^.]+$/, "") || "image",
        label: file.name,
        size: file.size,
      });
      // The image is accepted either way — it just cannot be processed until
      // there is a size to process it to, so ask for one now rather than
      // leaving the candidate looking at an empty preview.
      if (customIncomplete) setSizePromptOpen(true);
    } catch (e) {
      setError(e.message);
    }
  }, [customIncomplete]);

  // Re-encode whenever the source or any target setting changes.
  useEffect(() => {
    if (!source || !target) {
      setOutput(null);
      setChecks(null);
      setStatus(
        !source
          ? "Upload an image and set a size to begin."
          : "Enter a width and height (or pick a preset) to process.",
      );
      return;
    }

    const run = ++runRef.current;
    setStatus("Processing…");

    (async () => {
      const mode = fitMode;
      const canvas = renderToCanvas(source.img, target.w, target.h, mode);
      const encoded = await encodeWithinBudget(canvas, target.minKB, target.maxKB);
      // Stamp the DPI the guidelines ask for. Same byte count, so the size
      // budget checked below still holds.
      const stamped = await setJpegDpi(encoded.blob, target.dpi);
      // Only pads when quality alone can't reach the floor; never exceeds the
      // ceiling because the floor is always the smaller of the two. Not
      // optional: a file under the exam's minimum is rejected at upload, so
      // there is no version of this a candidate would want switched off. The
      // checklist says when it happened, and why the picture is unaffected.
      const { blob, padded } =
        target.minKB && stamped.size < target.minKB * 1024
          ? await padJpegToSize(stamped, target.minKB * 1024)
          : { blob: stamped, padded: false };
      const health = await runHealthChecks(canvas, target, blob.size, {
        padded,
        blob,
        // Identifies what the face check depends on, so retyping the KB budget
        // does not fire a fresh request — see imageOps' detectFace.
        face: { img: source.img, mode },
      });
      if (run !== runRef.current) return; // a newer run superseded this one

      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setOutput({
        url: urlRef.current,
        w: canvas.width,
        h: canvas.height,
        bytes: blob.size,
        quality: encoded.quality,
        mode,
        dpi: target.dpi,
        padded,
      });
      setChecks(health);
      setStatus("");
    })();
    // docType is here because on Custom it decides which checks apply (above);
    // on a preset it already moves presetKey with it.
  }, [source, docType, presetKey, custom.w, custom.h, custom.kb, fitMode]);

  // Release the last preview URL when the page goes away.
  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);

  const submitLead = (e) => {
    e.preventDefault();
    // Fire-and-forget: a warehouse hiccup must never block the download.
    toolsApi.logResizerLead({
      lead,
      presetKey,
      target: {
        label: target.label,
        w: target.w,
        h: target.h,
        minKB: target.minKB,
        maxKB: target.maxKB,
        dpi: target.dpi,
      },
      output: {
        w: output.w,
        h: output.h,
        bytes: output.bytes,
        quality: output.quality,
        mode: output.mode,
        padded: output.padded,
      },
      source: {
        name: source.label,
        w: source.img.width,
        h: source.img.height,
        bytes: source.size,
      },
      checks: (checks || []).map(({ key, status: s, text }) => ({ key, status: s, text })),
    });

    setLeadOpen(false);
    const a = document.createElement("a");
    a.href = output.url;
    a.download = `${source.name}-${output.w}x${output.h}.jpg`;
    a.click();
  };

  const modeLabel = { cover: "cropped to fill", contain: "fitted on white" };

  return (
    <div className="lg:h-screen lg:overflow-hidden flex flex-col bg-tool-surface text-tool-on-surface font-body-md">
      {/* Sticky so the bar is pinned below lg too, where the page scrolls
          normally — on lg+ the page is locked to the viewport and it never moves
          anyway. Matches the Answer Key Checker's bar. */}
      <header className="shrink-0 sticky top-0 z-20 bg-tool-surface-lowest border-b border-tool-outline/70">
        {/* On a phone the title wraps to two lines, so the row breaks and the
            badge would sit alone against the left edge. Centre the whole stack
            below sm instead — badge over centred text — and restore the
            left-aligned row from sm up, where it fits on one line. */}
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-4 flex flex-wrap items-center justify-center text-center gap-x-4 gap-y-2 sm:justify-start sm:text-left">
          <span className={`${PILL} grid place-items-center w-10 h-10 bg-tool-primary text-tool-on-primary shrink-0`}>
            <Icon name="photo_size_select_large" size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="text-headline-md font-bold leading-tight">Image Resizer</h1>
            <p className="text-body-md text-tool-secondary leading-tight">
              Resize photos and signatures to exact exam upload specifications.
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 lg:px-8 max-w-[1400px] w-full mx-auto">
        {/* Left: what → where → the file */}
        <div className="lg:col-span-8 flex flex-col gap-4 min-h-0 min-w-0">
          {/* Step 1 — document type. First decision, so it leads the page. */}
          <div className={`${CARD} shrink-0 p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-label-sm font-semibold uppercase tracking-wider text-tool-secondary">
                <span className="text-tool-primary">1.</span> What do you want to resize?
              </h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DOC_TYPES.map((d) => {
                const active = docType === d.key;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => changeDocType(d.key)}
                    aria-pressed={active}
                    className={`flex min-w-0 items-center justify-center gap-1.5 sm:gap-2 rounded-lg border px-2 sm:px-3 py-2.5 text-label-sm sm:text-label-md font-medium transition-all ${
                      active
                        ? "border-tool-primary bg-tool-primary text-tool-on-primary shadow-sm"
                        : "border-tool-outline/70 bg-tool-surface-lowest text-tool-on-surface hover:border-tool-primary/50 hover:bg-tool-surface"
                    }`}
                  >
                    <Icon name={d.icon} size={18} />
                    <span className="truncate">{d.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2 — the target size */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
            <div className={`${CARD} p-4`}>
              <h2 className="text-label-sm font-semibold uppercase tracking-wider text-tool-secondary mb-3">
                <span className="text-tool-primary">2.</span> Select Exam
              </h2>
              <select
                aria-label="Select target exam"
                value={presetKey}
                onChange={(e) => setPresetKey(e.target.value)}
                className={`${FIELD} cursor-pointer`}
              >
                <option value="custom">Custom dimensions</option>
                {presetsForType.map(([key, p]) => (
                  <option key={key} value={key}>{presetFamilyLabel(key, p)}</option>
                ))}
              </select>
              {/* The exams a family covers are spelled out in the option text
                  itself, so they are not repeated underneath. */}
              {!isCustom && !target?.source && (
                <p className="text-label-sm text-tool-secondary mt-2 flex items-start gap-1.5">
                  <Icon name="info" size={14} className="shrink-0 mt-[2px]" />
                  <span>Confirm against your official notification before uploading.</span>
                </p>
              )}
            </div>

            <div className={`${CARD} p-4`}>
              <h2 className="text-label-sm font-semibold uppercase tracking-wider text-tool-secondary mb-3">
                Custom Dimensions
              </h2>
              <div className={`grid grid-cols-3 gap-2.5 ${isCustom ? "" : "opacity-40 pointer-events-none"}`}>
                {[
                  ["w", "Width (px)", "350"],
                  ["h", "Height (px)", "450"],
                  ["kb", "Max Size (KB)", "50"],
                ].map(([field, label, ph]) => (
                  <div key={field} className="min-w-0">
                    <label className={LABEL}>{label}</label>
                    <input
                      type="number"
                      placeholder={ph}
                      value={custom[field]}
                      onChange={(e) => setCustom({ ...custom, [field]: e.target.value })}
                      className={FIELD}
                    />
                  </div>
                ))}
              </div>
              {/* Only once there is an image waiting on it. The fields are
                  blank by design at load, so flagging them before the candidate
                  has done anything would open the page on an error. */}
              {customIncomplete && (
                <p
                  className={`text-label-sm mt-2 flex items-start gap-1.5 ${
                    source ? "text-tool-error" : "text-tool-secondary"
                  }`}
                >
                  <Icon name={source ? "error" : "info"} size={14} className="shrink-0 mt-[2px]" />
                  <span>
                    {source
                      ? "Width and height are required to process your image."
                      : "Enter the width and height your exam asks for, or pick it from the list."}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Step 3 — the file. Takes all the remaining height. */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
            onDrop={(e) => { e.preventDefault(); setDragging(false); takeFile(e.dataTransfer.files[0]); }}
            className={`${CARD} group flex-1 w-full p-2.5 sm:p-3 text-left transition-colors hover:border-tool-primary/40
              min-h-[150px] sm:min-h-[190px] lg:min-h-[230px] lg:max-h-[360px]`}
          >
            <div
              className={`h-full flex flex-col items-center justify-center gap-2 sm:gap-3 rounded-lg border-2 border-dashed px-4 sm:px-6 py-5 sm:py-7 text-center transition-colors ${
                dragging
                  ? "border-tool-primary bg-tool-primary/5"
                  : source
                    ? "border-tool-primary/50 bg-tool-primary/[0.03]"
                    : "border-tool-primary/25 group-hover:border-tool-primary/50 group-hover:bg-tool-primary/[0.03]"
              }`}
            >
              <span
                className={`${PILL} grid place-items-center w-11 h-11 sm:w-14 sm:h-14 transition-colors ${
                  dragging || source
                    ? "bg-tool-primary text-tool-on-primary"
                    : "bg-tool-primary/10 text-tool-primary group-hover:bg-tool-primary group-hover:text-tool-on-primary"
                }`}
              >
                <Icon name={source ? "check" : "cloud_upload"} size={26} />
              </span>
              <div>
                <p className="text-body-lg sm:text-headline-sm font-semibold leading-tight break-all">
                  {source ? source.label : "Drag & drop your image"}
                </p>
                <p className="text-label-sm sm:text-body-md text-tool-secondary mt-0.5 sm:mt-1">
                  {source
                    ? `${source.img.width} × ${source.img.height} px · ${(source.size / 1024).toFixed(1)} KB`
                    : "or click to browse — JPEG, PNG or WebP up to 10MB"}
                </p>
              </div>
              <span
                className={`${PILL} px-4 sm:px-5 py-1.5 sm:py-2 text-label-sm sm:text-label-md font-medium transition-colors ${
                  source
                    ? "border border-tool-outline/70 text-tool-secondary group-hover:border-tool-primary/50 group-hover:text-tool-primary"
                    : "bg-tool-primary text-tool-on-primary shadow-sm"
                }`}
              >
                {source ? "Replace image" : "Upload Image"}
              </span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              className="hidden"
              onChange={(e) => takeFile(e.target.files[0])}
            />
          </button>

          {error && (
            <p className="shrink-0 flex items-center gap-2 rounded-lg bg-tool-error/10 px-3 py-2 text-body-md text-tool-error">
              <Icon name="error" size={18} /> {error}
            </p>
          )}

        </div>

        {/* Right: preview & checks. On screen from the start — the empty state
            shows the frame the chosen spec produces and the checks that will
            run, so a candidate knows what they are getting before uploading. */}
        <div className="lg:col-span-4 min-h-0 min-w-0">
          <div className={`${CARD} h-full p-4 flex flex-col min-h-0`}>
            <div className="flex justify-between items-center pb-3 mb-3 border-b border-tool-outline/60 shrink-0">
              <h2 className="text-headline-sm font-semibold">Preview & checks</h2>
              {output && (
                <span className={`${PILL} bg-tool-success/10 text-tool-success px-2.5 py-[3px] text-label-sm font-medium`}>
                  Ready
                </span>
              )}
            </div>

            {/* The transparency checkerboard is there to show what a real JPEG
                is matted against, so it only belongs under a real result — behind
                the placeholder it is just noise.

                min-h matters below lg, where the card is not height-constrained
                and flex-1 collapses to that floor; 140px left the placeholder
                too small to read. */}
            <div
              className={`flex-1 min-h-[210px] border border-tool-outline/60 rounded-lg flex items-center justify-center mb-3 relative overflow-hidden ${
                output
                  ? "bg-[repeating-conic-gradient(#f1f5f9_0_25%,#ffffff_0_50%)] bg-[length:16px_16px]"
                  : "bg-tool-surface"
              }`}
            >
              {output ? (
                <img
                  src={output.url}
                  alt="Processed preview"
                  className="absolute inset-0 w-full h-full object-contain"
                />
              ) : (
                <PreviewPlaceholder docType={docType} target={target} />
              )}
              {/* Only once there is something to re-crop — with an empty box it
                  would be a control that appears to do nothing. */}
              {output && (
                <button
                  type="button"
                  title={fitMode === "cover" ? "Crop to fill (click to fit on white)" : "Fit on white (click to crop)"}
                  onClick={() => setFitMode(fitMode === "cover" ? "contain" : "cover")}
                  className="absolute bottom-2 right-2 z-10 bg-tool-surface-lowest border border-tool-outline/70 p-2 rounded-lg shadow-sm hover:border-tool-primary/50 hover:text-tool-primary text-tool-secondary transition-colors"
                >
                  <Icon name="crop" size={18} />
                </button>
              )}
            </div>

            <p className="text-label-sm text-tool-secondary mb-3 shrink-0 leading-snug">
              {status ||
                (output &&
                  `${output.w} × ${output.h} px · ${(output.bytes / 1024).toFixed(1)} KB · JPEG q${Math.round(
                    output.quality * 100,
                  )} @ ${output.dpi} DPI · ${modeLabel[output.mode]}`)}
            </p>

            <ul className="space-y-0.5 mb-3 overflow-y-auto custom-scrollbar pr-1 min-h-0">
              {(checks || pendingChecks(target)).map((row) => (
                <ChecklistRow key={row.key} row={row} />
              ))}
            </ul>

            <button
              type="button"
              // Stays clickable when the only thing missing is the custom size,
              // so pressing it explains what to do. A disabled button with no
              // explanation is the dead end this is here to avoid.
              disabled={!output && !(source && customIncomplete)}
              onClick={() => (customIncomplete ? setSizePromptOpen(true) : setLeadOpen(true))}
              className="mt-auto shrink-0 w-full bg-tool-primary text-tool-on-primary text-label-md font-medium py-3.5 rounded-lg shadow-sm hover:brightness-110 active:brightness-95 transition-all flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <Icon name="download" size={18} /> Download Updated Image
            </button>
          </div>
        </div>
      </main>

      {/* Custom size missing. Carries the same three fields as the card so it
          can be answered here instead of sending the candidate back up. */}
      {sizePromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-tool-on-surface/50 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setSizePromptOpen(false)}
        >
          <div className={`${CARD} p-6 max-w-md w-full shadow-xl`}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex gap-3">
                <span className={`${PILL} grid place-items-center w-10 h-10 shrink-0 bg-tool-primary/10 text-tool-primary`}>
                  <Icon name="straighten" size={20} />
                </span>
                <div>
                  <h2 className="text-headline-sm font-bold mb-1">Enter a size first</h2>
                  <p className="text-body-md text-tool-secondary">
                    Custom dimensions are selected but the width and height are blank.
                    Fill them in, or pick your exam from the list instead.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSizePromptOpen(false)}
                className="text-tool-secondary hover:text-tool-on-surface shrink-0"
              >
                <Icon name="close" />
              </button>
            </div>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!customIncomplete) setSizePromptOpen(false);
              }}
            >
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  ["w", "Width (px)", "350"],
                  ["h", "Height (px)", "450"],
                  ["kb", "Max Size (KB)", "50"],
                ].map(([field, label, ph], i) => (
                  <div key={field} className="min-w-0">
                    <label className={LABEL}>{label}</label>
                    <input
                      autoFocus={i === 0}
                      type="number"
                      min="1"
                      placeholder={ph}
                      value={custom[field]}
                      onChange={(e) => setCustom({ ...custom, [field]: e.target.value })}
                      className={FIELD}
                    />
                  </div>
                ))}
              </div>
              <p className="text-label-sm text-tool-secondary">
                Max size is optional — leave it blank for no file-size limit.
              </p>
              <button
                type="submit"
                disabled={customIncomplete}
                className="w-full bg-tool-primary text-tool-on-primary text-label-md font-medium py-3.5 rounded-lg shadow-sm hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {customIncomplete ? "Enter a width and height" : "Use these dimensions"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Lead capture */}
      {leadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-tool-on-surface/50 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setLeadOpen(false)}
        >
          <div className={`${CARD} p-6 max-w-md w-full shadow-xl`}>
            <div className="flex justify-between items-start mb-5">
              <div>
                <h2 className="text-headline-md font-bold mb-1">Almost ready</h2>
                <p className="text-body-md text-tool-secondary">
                  Your optimized image is ready. Add a few details to start the download.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLeadOpen(false)}
                className="text-tool-secondary hover:text-tool-on-surface shrink-0"
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={submitLead}>
              {[
                ["name", "Full name", "text", "Enter your full name"],
                ["phone", "Mobile number", "tel", "+91"],
                ["exam", "Target exam", "text", "e.g. UPSC CSE 2026"],
              ].map(([field, label, type, ph]) => (
                <div key={field}>
                  <label className={LABEL}>{label}</label>
                  <input
                    required
                    type={type}
                    placeholder={ph}
                    value={lead[field]}
                    onChange={(e) => setLead({ ...lead, [field]: e.target.value })}
                    className={FIELD}
                  />
                </div>
              ))}
              <button
                type="submit"
                className="w-full bg-tool-primary text-tool-on-primary text-label-md font-medium py-3.5 rounded-lg shadow-sm hover:brightness-110 transition-all"
              >
                Confirm &amp; download
              </button>
              <p className="text-label-sm text-tool-secondary text-center">
                We value your privacy. No spam.
              </p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
