// Public standalone tool at /image-resizer — no auth, no portal chrome. All
// image work runs on <canvas> in the browser; the file is never uploaded.
// Only the captured lead + job metadata go to BigQuery on download.
//
// Layout note: on lg+ the page is locked to the viewport (h-screen +
// overflow-hidden) so it never scrolls — the requirements panel and the
// checklist scroll inside their own boxes instead. Below lg the page scrolls
// normally, because a phone viewport cannot hold this without clipping.
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { toolsApi } from "../api.js";
import {
  ACCEPTED_TYPES,
  MAX_INPUT_BYTES,
  PRESETS,
  describeTarget,
  encodeWithinBudget,
  loadImage,
  padJpegToSize,
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
  warn: ["text-tool-primary", "warning"],
  fail: ["text-tool-error", "cancel"],
  skip: ["text-tool-secondary", "help"],
  pending: ["text-tool-secondary", "pending"],
};

function ChecklistRow({ row }) {
  const [cls, icon] = CHECK_STYLES[row.status || "pending"];
  return (
    <li className="text-body-md">
      <div className="flex items-center justify-between gap-3">
        <span className="text-tool-on-surface-variant">{row.label}</span>
        <span className={`flex items-center gap-1 shrink-0 ${cls}`}>
          <Icon name={icon} size={16} />
          {row.text || "Pending"}
        </span>
      </div>
      {row.hint && <p className="text-label-sm text-tool-secondary mt-1 leading-snug">{row.hint}</p>}
    </li>
  );
}

const CARD = "bg-tool-surface-lowest border border-tool-outline rounded-xl";
const FIELD =
  "w-full bg-tool-surface border border-tool-outline rounded px-3 py-2 text-body-md text-tool-on-surface focus:ring-2 focus:ring-tool-primary focus:border-tool-primary outline-none";

export default function ImageResizer() {
  const fileRef = useRef(null);
  // Guards against an older async encode landing after a newer one.
  const runRef = useRef(0);
  // The blob URL currently shown. Revoked when replaced, and on unmount —
  // never from an effect cleanup keyed on `output`, because StrictMode's
  // double-invoke would then revoke the URL the preview is still displaying.
  const urlRef = useRef(null);

  const [source, setSource] = useState(null); // { img, name, label, size }
  // Custom is the default: most candidates arrive with a size from their own
  // notification rather than one of the presets below.
  const [presetKey, setPresetKey] = useState("custom");
  const [custom, setCustom] = useState({ w: "", h: "", kb: "" });
  const [fitMode, setFitMode] = useState("cover");
  const [stretch, setStretch] = useState(false);
  const [padToMin, setPadToMin] = useState(true);
  const [output, setOutput] = useState(null);
  const [checks, setChecks] = useState(null);
  const [status, setStatus] = useState("Upload an image and set a size to begin.");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [leadOpen, setLeadOpen] = useState(false);
  const [lead, setLead] = useState({ name: "", phone: "", exam: "" });

  const isCustom = presetKey === "custom";

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
      const mode = stretch ? "stretch" : fitMode;
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
  }, [source, presetKey, custom.w, custom.h, custom.kb, fitMode, stretch, padToMin]);

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

  const modeLabel = { stretch: "stretched", cover: "cropped to fill", contain: "fitted on white" };

  return (
    <div className="lg:h-screen lg:overflow-hidden flex flex-col bg-tool-surface text-tool-on-surface font-body-md">
      <header className="shrink-0 bg-tool-surface-lowest border-b border-tool-outline px-4 lg:px-8 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-headline-md font-bold">Image Resizer Utility</h1>
        <p className="text-body-md text-tool-secondary">
          Optimize and format your exam documents to strict civil service standards.
        </p>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 lg:px-8 max-w-[1400px] w-full mx-auto">
        {/* Left: settings & upload */}
        <div className="lg:col-span-8 flex flex-col gap-4 min-h-0">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
            onDrop={(e) => { e.preventDefault(); setDragging(false); takeFile(e.dataTransfer.files[0]); }}
            className={`${CARD} shrink-0 w-full p-3 transition-colors hover:bg-tool-surface-low group`}
          >
            <div
              className={`flex items-center justify-center gap-4 border-2 border-dashed rounded-lg px-4 py-4 text-center transition-colors ${
                dragging || source ? "border-tool-primary-container" : "border-tool-outline"
              }`}
            >
              <Icon name="cloud_upload" size={28} className="text-tool-secondary group-hover:text-tool-primary transition-colors" />
              <div className="text-left">
                <p className="text-body-lg font-semibold leading-tight">
                  {source ? source.label : "Drag & Drop Image Here"}
                </p>
                <p className="text-body-md text-tool-on-surface-variant">
                  {source
                    ? `${source.img.width} × ${source.img.height} px · ${(source.size / 1024).toFixed(1)} KB — click to replace`
                    : "JPEG, PNG or WebP up to 10MB"}
                </p>
              </div>
              <span className="ml-auto bg-tool-primary-container text-tool-on-primary-container text-label-md px-4 py-2 rounded shrink-0">
                Browse
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

          {error && <p className="text-body-md text-tool-error shrink-0">{error}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
            {/* Custom dimensions — the default, so it leads */}
            <div className={`${CARD} p-4`}>
              <h2 className="text-headline-sm mb-3 flex items-center justify-between">
                Custom Size
                {isCustom && (
                  <span className="bg-tool-secondary-container text-tool-on-secondary-container text-label-sm px-2 py-[2px] rounded">
                    Active
                  </span>
                )}
              </h2>
              <div className={`grid grid-cols-3 gap-3 ${isCustom ? "" : "opacity-50 pointer-events-none"}`}>
                {[
                  ["w", "Width (px)", "350"],
                  ["h", "Height (px)", "450"],
                  ["kb", "Max KB", "50"],
                ].map(([field, label, ph]) => (
                  <div key={field}>
                    <label className="block text-label-sm text-tool-on-surface-variant mb-1">{label}</label>
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
              {isCustom && !target && (
                <p className="text-label-sm text-tool-secondary mt-3">
                  Enter a width and height to process the image.
                </p>
              )}
            </div>

            {/* Exam presets */}
            <div className={`${CARD} p-4`}>
              <h2 className="text-headline-sm mb-3">Exam Preset</h2>
              <select
                aria-label="Select target exam"
                value={presetKey}
                onChange={(e) => setPresetKey(e.target.value)}
                className={`${FIELD} cursor-pointer`}
              >
                <option value="custom">Custom Dimensions</option>
                {Object.entries(PRESETS)
                  .filter(([key]) => key !== "custom")
                  .map(([key, p]) => (
                    <option key={key} value={key}>{p.label}</option>
                  ))}
              </select>
              <p className="text-label-sm text-tool-secondary mt-3 flex items-start gap-1">
                <Icon name={target?.source ? "verified" : "info"} size={16} className="shrink-0" />
                <span>
                  {target?.source
                    ? `Official values from the ${target.source}.`
                    : isCustom
                      ? "Using your own dimensions. Pick a preset to load an exam's official requirements."
                      : "Not verified against an official notification — confirm before your final upload."}
                </span>
              </p>
            </div>
          </div>

          {/* Active target + options */}
          <div className={`${CARD} shrink-0 p-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2`}>
            <div className="min-w-0">
              <p className="text-label-md text-tool-secondary uppercase">Active Target</p>
              <p className="text-body-lg mt-1">{describeTarget(target)}</p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-body-md text-tool-on-surface-variant cursor-pointer">
                <input
                  type="checkbox"
                  checked={stretch}
                  onChange={(e) => setStretch(e.target.checked)}
                  className="rounded border-tool-outline text-tool-primary focus:ring-tool-primary"
                />
                Stretch to exact size (may distort)
              </label>
              {target?.minKB > 0 && (
                <label className="flex items-center gap-2 text-body-md text-tool-on-surface-variant cursor-pointer">
                  <input
                    type="checkbox"
                    checked={padToMin}
                    onChange={(e) => setPadToMin(e.target.checked)}
                    className="rounded border-tool-outline text-tool-primary focus:ring-tool-primary"
                  />
                  Pad to minimum size ({target.minKB} KB) when needed
                </label>
              )}
            </div>
          </div>

          {/* Requirements — scrolls inside itself so the page never does */}
          {target?.guidance?.length > 0 && (
            <div className={`${CARD} flex-1 min-h-0 p-4 flex flex-col`}>
              <h2 className="text-headline-sm flex items-center gap-1 shrink-0">
                <Icon name="rule" size={20} className="text-tool-primary" />
                Official Requirements
              </h2>
              <p className="text-label-sm text-tool-secondary mb-2 shrink-0">{target.source}</p>
              <ul className="space-y-2 overflow-y-auto custom-scrollbar pr-1 min-h-0">
                {target.guidance.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-body-md text-tool-on-surface-variant">
                    <Icon name="check" size={16} className="text-tool-primary shrink-0 mt-[3px]" />
                    <span>{line}</span>
                  </li>
                ))}
                <li className="text-label-sm text-tool-secondary pt-2 border-t border-tool-outline/50">
                  Scan at 200 DPI minimum in True Colour and save as JPG/JPEG. Certificates are uploaded separately as
                  an A4 PDF under 500 KB — this tool does not handle those.
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* Right: preview & health check */}
        <div className="lg:col-span-4 min-h-0">
          <div className={`${CARD} h-full p-4 flex flex-col min-h-0`}>
            <div className="flex justify-between items-center pb-2 mb-3 border-b border-tool-outline/50 shrink-0">
              <h2 className="text-headline-sm">Image Health Check</h2>
              <span className="bg-tool-surface-highest text-tool-on-surface-variant text-label-sm px-2 py-[2px] rounded">
                Preview
              </span>
            </div>

            <div className="flex-1 min-h-[120px] bg-tool-surface border border-dashed border-tool-outline rounded-lg flex items-center justify-center mb-3 relative overflow-hidden">
              {output ? (
                <img src={output.url} alt="Processed preview" className="absolute inset-0 w-full h-full object-contain bg-white" />
              ) : (
                <Icon name="image" size={32} className="text-tool-secondary" />
              )}
              <button
                type="button"
                title={fitMode === "cover" ? "Crop to fill (click to fit on white)" : "Fit on white (click to crop)"}
                onClick={() => setFitMode(fitMode === "cover" ? "contain" : "cover")}
                className="absolute bottom-2 right-2 z-10 bg-tool-surface-lowest border border-tool-outline p-2 rounded shadow-sm hover:bg-tool-surface-high text-tool-secondary"
              >
                <Icon name="crop" size={18} />
              </button>
            </div>

            <p className="text-label-sm text-tool-secondary mb-3 shrink-0">
              {status ||
                (output &&
                  `${output.w} × ${output.h} px · ${(output.bytes / 1024).toFixed(1)} KB · JPEG q${Math.round(
                    output.quality * 100,
                  )} @ ${output.dpi} DPI · ${modeLabel[output.mode]}`)}
            </p>

            <ul className="space-y-2 mb-3 overflow-y-auto custom-scrollbar pr-1 min-h-0">
              {(checks || PENDING_CHECKS).map((row) => (
                <ChecklistRow key={row.key} row={row} />
              ))}
            </ul>

            <button
              type="button"
              disabled={!output}
              onClick={() => setLeadOpen(true)}
              className="mt-auto shrink-0 w-full bg-tool-primary text-tool-on-primary text-label-md py-3 rounded hover:opacity-90 transition-opacity flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Icon name="download" size={18} /> Download Updated Image
            </button>
          </div>
        </div>
      </main>

      {/* Lead capture */}
      {leadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-tool-on-surface/50 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setLeadOpen(false)}
        >
          <div className={`${CARD} p-6 max-w-md w-full shadow-lg`}>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-headline-md mb-1">Almost Ready!</h2>
                <p className="text-body-md text-tool-secondary">
                  Your optimized image is ready. Please provide brief details to initiate download.
                </p>
              </div>
              <button type="button" onClick={() => setLeadOpen(false)} className="text-tool-secondary hover:text-tool-on-surface">
                <Icon name="close" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={submitLead}>
              {[
                ["name", "Full Name", "text", "Enter your full name"],
                ["phone", "Mobile Number", "tel", "+91"],
                ["exam", "Target Exam", "text", "e.g. UPSC CSE 2026"],
              ].map(([field, label, type, ph]) => (
                <div key={field}>
                  <label className="block text-label-sm text-tool-on-surface-variant mb-1">{label}</label>
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
              <button type="submit" className="w-full bg-tool-primary text-tool-on-primary text-label-md py-3 rounded hover:opacity-90 transition-opacity">
                Confirm &amp; Download
              </button>
              <p className="text-label-sm text-tool-secondary text-center">We value your privacy. No spam.</p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
