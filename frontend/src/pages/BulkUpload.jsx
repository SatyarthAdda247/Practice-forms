import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MAX_UPLOAD_BYTES, api } from "../api.js";
import Icon from "../components/Icon.jsx";
import { violationLabel } from "../violations.js";

const STATUS_STYLES = {
  validated: {
    label: "Validated",
    badge: "text-[#0d9488] bg-tertiary-fixed-dim/20 border-tertiary-fixed-dim",
    bar: "bg-primary",
    icon: "picture_as_pdf",
    iconColor: "text-secondary",
  },
  processing: {
    label: "Processing…",
    badge: "text-secondary bg-surface-variant border-outline-variant",
    bar: "bg-primary animate-pulse",
    icon: "image",
    iconColor: "text-secondary",
  },
  failed: {
    label: "Failed",
    badge: "text-error bg-error-container border-[#f87171]",
    bar: "bg-error",
    icon: "error",
    iconColor: "text-error",
  },
};

function fileIcon(filename) {
  return filename.toLowerCase().endsWith(".pdf") ? "picture_as_pdf" : "image";
}

// The upload loop reports three states per file: sending it, waiting for the
// API to come back after it dropped out, and re-sending it. Say which one is
// happening — "Uploading…" while the server is down reads as a hang.
function progressLabel({ index, total, name, waiting, attempt }) {
  const which = `file ${index + 1} of ${total}`;
  if (waiting) return `Server is restarting — waiting to resume ${name} (${which})…`;
  if (attempt) return `Retrying ${name} — attempt ${attempt + 1} (${which})…`;
  return `Uploading ${name} — ${which}…`;
}

function humanSize(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export default function BulkUpload() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState(id || "");
  // How many questions are PRINTED on the form. Distinct from the exam's
  // question count — a 50-question exam is often sat on a 200-question sheet,
  // and the reader needs the printed layout to number answers correctly.
  const [sheetQuestions, setSheetQuestions] = useState(100);
  const [sheets, setSheets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Which file of how many is uploading, now that each goes in its own request.
  const [progress, setProgress] = useState(null);

  // Load the exam list for the selector.
  useEffect(() => {
    api.listExams().then((list) => {
      setExams(list);
      if (!examId && list.length) setExamId(String(list[0].id));
    });
  }, []);

  // Refresh queue + summary whenever the selected exam changes.
  useEffect(() => {
    if (!examId) return;
    refresh(examId);
  }, [examId]);

  const refresh = async (eid) => {
    const [s, sum] = await Promise.all([api.listSheets(eid), api.validation(eid)]);
    setSheets(s);
    setSummary(sum);
  };

  const doUpload = async (files) => {
    if (!examId) {
      setError("Select an exam before uploading.");
      return;
    }
    const picked = [...(files || [])];
    if (!picked.length) return;

    // Reject oversized files here rather than letting them upload and then be
    // refused with a 413 halfway through. The good files still go.
    const tooBig = picked.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const sendable = picked.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    const sizeError = tooBig.length
      ? `Skipped ${tooBig.map((f) => `${f.name} (${humanSize(f.size)})`).join(", ")} — ` +
        `the limit is ${humanSize(MAX_UPLOAD_BYTES)} per file.`
      : "";
    if (!sendable.length) {
      setError(sizeError);
      return;
    }

    setBusy(true);
    setError("");
    setProgress(null);
    try {
      const { failures } = await api.uploadSheets(
        examId, sendable, sheetQuestions,
        // One request per file now, so say which one is in flight.
        ({ index, total, name }) => setProgress({ index, total, name }),
      );
      await refresh(examId);
      // Partial success: the sheets that landed are already on screen, so the
      // failures are a notice rather than a dead end.
      setError([sizeError, ...failures].filter(Boolean).join(" · "));
    } catch (e) {
      setError([sizeError, e.message].filter(Boolean).join(" · "));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    doUpload(e.dataTransfer.files);
  };

  const removeSheet = async (sid) => {
    await api.deleteSheet(sid);
    refresh(examId);
  };

  const clearAll = async () => {
    await Promise.all(sheets.map((s) => api.deleteSheet(s.id)));
    refresh(examId);
  };

  const beginGrading = async () => {
    setBusy(true);
    setError("");
    try {
      await api.grade(examId);
      navigate(`/results/${examId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="mb-xl flex justify-between items-end">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-xs">
            Bulk OMR Upload
          </h1>
          <p className="font-body-lg text-body-lg text-secondary">
            Upload scanned answer sheets for automated processing.
          </p>
        </div>
        <div className="flex items-end gap-sm">
          <select
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            className="bg-surface border border-outline-variant rounded-lg px-sm py-2 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
          >
            <option value="">Select exam…</option>
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}
              </option>
            ))}
          </select>
          <label>
            <span className="block font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs">
              Questions on sheet
            </span>
            <select
              value={sheetQuestions}
              onChange={(e) => setSheetQuestions(Number(e.target.value))}
              title="How many questions are printed on the OMR form — not the exam's question count"
              className="bg-surface border border-outline-variant rounded-lg px-sm py-2 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
            >
              <option value={100}>100-question sheet</option>
              <option value={200}>200-question sheet</option>
            </select>
          </label>
        </div>
      </header>

      {error && (
        <div className="mb-lg p-md rounded-xl bg-error-container text-on-error-container font-body-md">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-lg">
        {/* Left column: dropzone + queue */}
        <div className="lg:col-span-8 flex flex-col gap-lg">
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl bg-surface-container-lowest p-xl flex flex-col items-center justify-center text-center transition-colors cursor-pointer min-h-[320px] ${
              dragging ? "border-primary bg-secondary-container/30" : "border-[#cbd5e1] hover:border-primary"
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => doUpload(e.target.files)}
              className="hidden"
            />
            <div className="w-16 h-16 bg-surface-container rounded-full flex items-center justify-center mb-md">
              <Icon name="upload_file" filled size={32} className="text-primary" />
            </div>
            <h3 className="font-headline-md text-headline-md text-on-background mb-sm">
              Drag &amp; Drop Scans Here
            </h3>
            <p className="font-body-md text-body-md text-secondary mb-lg">
              {/* The limit really is per file now — each one is its own request. */}
              {progress ? progressLabel(progress) : `Support for PDF, JPG, and PNG files up to ${humanSize(MAX_UPLOAD_BYTES)} each.`}
            </p>
            <span className="py-sm px-lg bg-surface-container text-on-surface rounded-lg font-label-md text-label-md hover:bg-surface-container-high transition-colors border border-outline-variant">
              {busy ? "Uploading…" : "Browse Files"}
            </span>
          </div>

          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
            <div className="px-lg py-md border-b border-outline-variant bg-surface-bright flex justify-between items-center">
              <h4 className="font-headline-sm text-headline-sm text-on-background">
                Upload Queue ({sheets.length})
              </h4>
              {sheets.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-secondary hover:text-error text-label-md font-label-md transition-colors"
                >
                  Clear All
                </button>
              )}
            </div>
            {sheets.length === 0 ? (
              <p className="p-lg text-secondary font-body-md">No sheets uploaded yet.</p>
            ) : (
              <ul className="divide-y divide-outline-variant">
                {sheets.map((s) => {
                  const st = STATUS_STYLES[s.status] || STATUS_STYLES.processing;
                  const flags = s.flags || [];
                  return (
                    <li
                      key={s.id}
                      className={`flex items-center justify-between p-md hover:bg-surface-bright transition-colors ${
                        s.status === "failed" ? "bg-error-container/10" : ""
                      }`}
                    >
                      <div className="flex items-center gap-md min-w-0">
                        <Icon
                          name={s.status === "failed" ? "error" : fileIcon(s.filename)}
                          className={st.iconColor}
                        />
                        <div className="min-w-0">
                          <p className="font-body-md text-body-md text-on-background font-medium truncate">
                            {s.filename}
                          </p>
                          <p
                            className={`font-body-sm text-body-sm ${
                              s.status === "failed" ? "text-error" : "text-secondary"
                            }`}
                          >
                            {s.status === "failed" ? s.error : humanSize(s.sizeBytes)}
                            {s.studentName ? ` • ${s.studentName}` : ""}
                            {s.rollNumber ? ` • ${s.rollNumber}` : ""}
                          </p>
                          {flags.length > 0 && (
                            <div className="flex flex-wrap gap-xs mt-xs">
                              {flags.map((code) => (
                                <span
                                  key={code}
                                  className="inline-flex items-center gap-xs font-label-md text-[11px] px-sm py-[2px] rounded-full bg-error-container/40 text-error border border-[#fca5a5]"
                                >
                                  <Icon name="warning" size={12} filled />
                                  {violationLabel(code)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-lg shrink-0">
                        <div className="w-32 hidden sm:block">
                          <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
                            <div className={`h-full w-full rounded-full ${st.bar}`} />
                          </div>
                        </div>
                        <span
                          className={`font-label-md text-label-md px-sm py-xs rounded-full border hidden sm:inline-block ${
                            flags.length > 0 && s.status === "validated"
                              ? "text-error bg-error-container border-[#f87171]"
                              : st.badge
                          }`}
                        >
                          {flags.length > 0 && s.status === "validated" ? "Review" : st.label}
                        </span>
                        <button
                          onClick={() => removeSheet(s.id)}
                          className="text-outline hover:text-error transition-colors p-xs rounded-full hover:bg-error-container"
                        >
                          <Icon name="close" size={20} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Right column: summary + actions */}
        <div className="lg:col-span-4 flex flex-col gap-lg">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg shadow-sm">
            <h3 className="font-headline-sm text-headline-sm text-on-background mb-md">
              Validation Summary
            </h3>
            <div className="mb-lg">
              <div className="grid grid-cols-3 divide-x divide-outline-variant bg-surface rounded-lg border border-outline-variant py-md">
                <SummaryStat label="Total" value={summary?.totalDetected ?? 0} valueClass="text-primary" />
                <SummaryStat label="Ready" value={summary?.readyForGrading ?? 0} valueClass="text-[#0d9488]" />
                <SummaryStat label="Issues" value={summary?.issues ?? 0} valueClass="text-error" />
              </div>
              {summary?.issueDetails?.length > 0 && (
                <div className="mt-md bg-error-container/20 p-md rounded-lg border border-[#fca5a5]">
                  <ul className="list-disc list-inside font-body-sm text-body-sm text-on-surface-variant">
                    {summary.issueDetails.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="pt-md border-t border-outline-variant">
              <button
                onClick={beginGrading}
                disabled={busy || !summary?.readyForGrading}
                className="w-full py-md px-lg bg-primary text-on-primary rounded-xl font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors shadow-sm flex items-center justify-center gap-sm disabled:opacity-60"
              >
                <Icon name="play_arrow" />
                {busy ? "Working…" : "Begin Grading"}
              </button>
            </div>
          </div>

          <div className="bg-secondary-container/50 rounded-xl p-md flex gap-md items-start">
            <Icon name="lightbulb" className="text-primary mt-xs" />
            <div>
              <h4 className="font-label-md text-label-md text-on-background mb-xs">Pro Tip</h4>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                For best results, ensure all scanned images have a minimum resolution of 300 DPI and
                are well-lit without heavy shadows.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryStat({ label, value, valueClass = "text-on-background" }) {
  return (
    <div className="flex flex-col items-center justify-center px-sm text-center">
      <span className={`font-data-mono text-headline-md font-bold ${valueClass}`}>{value}</span>
      <span className="font-body-sm text-body-sm text-secondary mt-xs">{label}</span>
    </div>
  );
}
