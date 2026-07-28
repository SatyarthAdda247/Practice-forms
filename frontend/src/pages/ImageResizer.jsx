// Public standalone tool at /image-resizer — no auth, no portal chrome. All
// image work runs on <canvas> in the browser; the file is never uploaded.
// Only the captured lead + job metadata go to BigQuery on download.
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

// Shown before an image has been processed, so the panel isn't empty.
const PENDING_CHECKS = [
  { key: "background", label: "Background (White)" },
  { key: "sharpness", label: "Image Sharpness" },
  { key: "dimensions", label: "Dimensions & Ratio" },
  { key: "filesize", label: "Format & File Size" },
];

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
  { key: "other", label: "Other", icon: "description" },
];

// borderRadius.full is only 0.75rem in this theme, so true pills/circles need
// an explicit radius.
// Custom size starts on the spec that satisfies the majority of exams (banking,
// NTA, AFCAT and most State PSCs all use 200 x 230 at up to 50 KB), so the tool
// produces something the moment an image is dropped rather than sitting inert
// until three fields are typed. Freely overwritten, and unused once a preset is
// selected.
const DEFAULT_CUSTOM = { w: "200", h: "230", kb: "50" };

const PILL = "rounded-[999px]";
const CARD =
  "bg-tool-surface-lowest border border-tool-outline/70 rounded-xl shadow-[0_1px_2px_rgba(0,30,46,0.04),0_1px_3px_rgba(0,30,46,0.06)]";
const FIELD =
  "w-full bg-tool-surface-lowest border border-tool-outline/70 rounded-lg px-3 py-2.5 text-body-md text-tool-on-surface " +
  "placeholder:text-tool-secondary/60 focus:ring-2 focus:ring-tool-primary/30 focus:border-tool-primary outline-none transition-shadow";
const LABEL = "block text-label-sm font-medium uppercase tracking-wider text-tool-secondary mb-1.5";

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
  const [padToMin, setPadToMin] = useState(true);
  const [output, setOutput] = useState(null);
  const [checks, setChecks] = useState(null);
  const [status, setStatus] = useState("Upload an image and set a size to begin.");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [leadOpen, setLeadOpen] = useState(false);
  const [lead, setLead] = useState({ name: "", phone: "", exam: "" });

  const isCustom = presetKey === "custom";
  const presetsForType = Object.entries(PRESETS).filter(
    ([key]) => key !== "custom" && presetKind(key) === docType,
  );

  // Switching document type keeps you in the same exam family where it has an
  // equivalent (SSC photo → SSC signature); otherwise it falls back to custom
  // rather than silently leaving a preset from the wrong type selected.
  const changeDocType = (next) => {
    setDocType(next);
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
    return { ...PRESETS.custom, label: "Custom", w, h, maxKB: maxKB > 0 ? maxKB : 0 };
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
    } catch (e) {
      setError(e.message);
    }
  }, []);

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
      // ceiling because the floor is always the smaller of the two.
      const { blob, padded } =
        padToMin && target.minKB && stamped.size < target.minKB * 1024
          ? await padJpegToSize(stamped, target.minKB * 1024)
          : { blob: stamped, padded: false };
      const health = await runHealthChecks(canvas, target, blob.size, { padded });
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
  }, [source, presetKey, custom.w, custom.h, custom.kb, fitMode, padToMin]);

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
      <header className="shrink-0 bg-tool-surface-lowest border-b border-tool-outline/70">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
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
        <div className={`${source ? "lg:col-span-8" : "lg:col-span-12"} flex flex-col gap-4 min-h-0 min-w-0`}>
          {/* Step 1 — document type. First decision, so it leads the page. */}
          <div className={`${CARD} shrink-0 p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-label-sm font-semibold uppercase tracking-wider text-tool-secondary">
                <span className="text-tool-primary">1.</span> What are you uploading?
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
                <span className="text-tool-primary">2.</span> Exam preset
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
              <h2 className="text-label-sm font-semibold uppercase tracking-wider text-tool-secondary mb-3 flex items-center justify-between">
                <span>Custom size</span>
                {isCustom && (
                  <span className={`${PILL} bg-tool-primary/10 text-tool-primary px-2 py-[2px] text-label-sm normal-case tracking-normal`}>
                    Active
                  </span>
                )}
              </h2>
              <div className={`grid grid-cols-3 gap-2.5 ${isCustom ? "" : "opacity-40 pointer-events-none"}`}>
                {[
                  ["w", "Width", "350"],
                  ["h", "Height", "450"],
                  ["kb", "Max KB", "50"],
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
                {source ? "Replace image" : "Browse files"}
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

          {/* Only the padding option remains, and only when the preset has a
              minimum size for it to act on. */}
          {target?.minKB > 0 && (
            <div className={`${CARD} shrink-0 px-4 py-3`}>
              <label className="flex items-center gap-2 text-body-md text-tool-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={padToMin}
                  onChange={(e) => setPadToMin(e.target.checked)}
                  className="rounded border-tool-outline text-tool-primary focus:ring-tool-primary/40"
                />
                Pad to minimum ({target.minKB} KB) when needed
              </label>
            </div>
          )}
        </div>

        {/* Right: preview & checks — only once there is an image to show. */}
        {source && (
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

            <div className="flex-1 min-h-[140px] bg-[repeating-conic-gradient(#f1f5f9_0_25%,#ffffff_0_50%)] bg-[length:16px_16px] border border-tool-outline/60 rounded-lg flex items-center justify-center mb-3 relative overflow-hidden">
              {output ? (
                <img
                  src={output.url}
                  alt="Processed preview"
                  className="absolute inset-0 w-full h-full object-contain"
                />
              ) : (
                <div className="text-center text-tool-secondary px-4">
                  <Icon name="image" size={34} />
                  <p className="text-label-sm mt-1">Your resized image appears here</p>
                </div>
              )}
              <button
                type="button"
                title={fitMode === "cover" ? "Crop to fill (click to fit on white)" : "Fit on white (click to crop)"}
                onClick={() => setFitMode(fitMode === "cover" ? "contain" : "cover")}
                className="absolute bottom-2 right-2 z-10 bg-tool-surface-lowest border border-tool-outline/70 p-2 rounded-lg shadow-sm hover:border-tool-primary/50 hover:text-tool-primary text-tool-secondary transition-colors"
              >
                <Icon name="crop" size={18} />
              </button>
            </div>

            <p className="text-label-sm text-tool-secondary mb-3 shrink-0 leading-snug">
              {status ||
                (output &&
                  `${output.w} × ${output.h} px · ${(output.bytes / 1024).toFixed(1)} KB · JPEG q${Math.round(
                    output.quality * 100,
                  )} @ ${output.dpi} DPI · ${modeLabel[output.mode]}`)}
            </p>

            <ul className="space-y-0.5 mb-3 overflow-y-auto custom-scrollbar pr-1 min-h-0">
              {(checks || PENDING_CHECKS).map((row) => (
                <ChecklistRow key={row.key} row={row} />
              ))}
            </ul>

            <button
              type="button"
              disabled={!output}
              onClick={() => setLeadOpen(true)}
              className="mt-auto shrink-0 w-full bg-tool-primary text-tool-on-primary text-label-md font-medium py-3.5 rounded-lg shadow-sm hover:brightness-110 active:brightness-95 transition-all flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <Icon name="download" size={18} /> Download image
            </button>
          </div>
        </div>
        )}
      </main>

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
