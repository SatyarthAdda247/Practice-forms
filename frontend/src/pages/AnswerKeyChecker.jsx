// Public standalone tool at /answerkey-checker — no auth, no portal chrome.
// The response sheet is parsed in the browser and never uploaded: the only
// thing sent anywhere is the aggregate score summary below, which carries no
// individual answers and nothing identifying the candidate.
// Parsing and scoring live in ../tools/lib/answerKey.js.
import { useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { toolsApi } from "../api.js";
import usePageMeta from "../pageMeta.js";
import {
  EXAM_OPTIONS,
  SCHEMES,
  parseAnswerList,
  parseResponseFile,
  round,
  scoreAll,
  toCsv,
} from "../tools/lib/answerKey.js";

// Search-facing title/description for this route. server.js serves the same
// pair in the initial HTML — change both together.
const PAGE_TITLE = "Answer Key Calculator for SSC, Railway & Govt Exams (Free)";
const PAGE_DESCRIPTION =
  "Calculate your expected score using the official answer key for SSC, Railway, " +
  "Defence, Teaching, State, and Central Government exams.";

const IMPACT_STYLES = {
  correct: "text-tool-success",
  incorrect: "text-tool-error",
  skipped: "text-tool-secondary",
  unkeyed: "text-tool-secondary",
};

// Per-section tallies — drawn in the report, and sent to the warehouse to show
// how a cohort did by subject. Counts and marks only; no individual answers
// ever leave the browser.
function summariseSections(rows) {
  const out = {};
  for (const r of rows) {
    if (r.status === "unkeyed") continue;
    const bucket = (out[r.section] ??= { correct: 0, incorrect: 0, skipped: 0, score: 0 });
    bucket[r.status] += 1;
    bucket.score += r.impact;
  }
  return out;
}

// One line per thing the uploaded sheet gave us, so the candidate can see what
// was filled in for them rather than wondering whether the numbers are theirs.
function detectedChips(detected) {
  if (!detected) return [];
  const { responses, key, scheme, sections, meta } = detected;
  const chips = [];
  if (responses) chips.push(`${responses} responses`);
  if (key) chips.push(`${key} official answers`);
  if (scheme) {
    const marks = [];
    if (scheme.correct != null) marks.push(`+${round(scheme.correct)} per correct`);
    if (scheme.wrong != null) marks.push(`−${round(scheme.wrong)} per wrong`);
    chips.push(marks.join(" · "));
  }
  if (sections) chips.push(`${sections} section${sections > 1 ? "s" : ""}`);
  if (meta?.testDate) chips.push([meta.testDate, meta.testTime].filter(Boolean).join(" · "));
  return chips;
}

function StatCard({ label, value, className = "", accent = false }) {
  return (
    <div className="bg-tool-surface-lowest border border-tool-outline rounded-lg p-6 flex flex-col gap-1 relative overflow-hidden">
      {accent && <div className="absolute top-0 right-0 w-16 h-16 bg-tool-primary opacity-10 rounded-bl-full -mr-4 -mt-4" />}
      <span className="text-label-md text-tool-secondary uppercase">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}

export default function AnswerKeyChecker() {
  usePageMeta({ title: PAGE_TITLE, description: PAGE_DESCRIPTION });

  const fileRef = useRef(null);

  const [exam, setExam] = useState("ssc");
  const [shift, setShift] = useState("");
  const [scheme, setScheme] = useState({ ...SCHEMES.ssc });
  const [responsesText, setResponsesText] = useState("");
  const [keyText, setKeyText] = useState("");
  const [sections, setSections] = useState({});
  // Question numbers as printed on the sheet, for the report to show.
  const [labels, setLabels] = useState({});
  const [fileLabel, setFileLabel] = useState(null);
  const [detected, setDetected] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const [filter, setFilter] = useState("all");

  const pickExam = (value) => {
    setExam(value);
    if (SCHEMES[value]) setScheme({ ...SCHEMES[value] });
  };

  const setField = (field, value) => setScheme({ ...scheme, [field]: value });

  const takeFile = async (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return setError("File is larger than 20MB.");
    setFileLabel({ name: file.name, hint: "Reading…" });
    try {
      // A 60-page sheet takes a few seconds to read, so say where we are.
      const onProgress = (page, pages) =>
        setFileLabel({ name: file.name, hint: `Reading page ${page} of ${pages}…` });
      const { responses, key, sections: found, labels: printed, scheme: stated, meta, kind } =
        await parseResponseFile(file, onProgress);
      if (!responses.size) {
        setFileLabel({ name: file.name, hint: "Could not find any answers — paste them manually below." });
        return setError("No responses found in the uploaded file.");
      }
      const asLines = (map) =>
        [...map.entries()].sort((a, b) => a[0] - b[0]).map(([q, a]) => `${q} ${a || "-"}`).join("\n");

      setSections(found);
      setLabels(printed || {});
      setResponsesText(asLines(responses));

      // Annotated sheets carry the key alongside the responses; use it rather
      // than making the candidate retype what the file already contains.
      const hasKey = key && key.size > 0;
      if (hasKey) setKeyText(asLines(key));

      // The sheet's own header note beats the exam preset — it is what the
      // commission will actually mark this paper by. Only the fields it states
      // are overwritten; the rest keep the preset.
      const fromSheet = Object.fromEntries(
        Object.entries(stated || {}).filter(([, v]) => v != null),
      );
      if (Object.keys(fromSheet).length) setScheme((prev) => ({ ...prev, ...fromSheet }));
      // Paper date/time, so the saved analysis says which shift it was. Nothing
      // identifying the candidate is read out of the sheet.
      if (meta?.testDate) setShift([meta.testDate, meta.testTime].filter(Boolean).join(", "));

      setDetected({
        kind,
        responses: responses.size,
        key: hasKey ? key.size : 0,
        // `total` is inferred from the question count on any parsed sheet, so it
        // is only a "stated marking scheme" if the marks themselves were stated.
        scheme: fromSheet.correct != null || fromSheet.wrong != null ? fromSheet : null,
        sections: new Set(Object.values(found)).size,
        meta: meta || {},
      });

      setFileLabel({
        name: file.name,
        hint: hasKey
          ? `${responses.size} responses + the official key read from this file — click to replace`
          : `${responses.size} responses parsed — paste the official key on the right`,
      });
      setError("");
    } catch (e) {
      console.warn("response sheet parse failed:", e);
      setError("Could not read that file. Try the HTML response sheet, or paste your answers below.");
      setFileLabel(null);
      setDetected(null);
    }
  };

  const analyze = () => {
    const responses = parseAnswerList(responsesText);
    const key = parseAnswerList(keyText);
    if (!responses.size) return setError("Add your responses — upload a response sheet or paste them above.");
    if (!key.size) return setError("Paste the official answer key to compare against.");

    setError("");
    const marking = {
      correct: Number(scheme.correct) || 0,
      wrong: Number(scheme.wrong) || 0,
      skipped: Number(scheme.skipped) || 0,
    };
    const result = scoreAll({
      responses,
      key,
      sections,
      labels,
      total: Number(scheme.total) || 0,
      scheme: marking,
    });
    // Keep the scheme the score was computed with, so the report keeps saying
    // what it was marked by even if the inputs are edited afterwards.
    setReport({ ...result, marking });

    // Warehouse the analysis (aggregates only — no individual answers, no key,
    // nothing that identifies the candidate).
    // Fire-and-forget: the report is already on screen either way.
    toolsApi.logKeyCheckResult({
      exam,
      shift,
      scheme: marking,
      inputSource: fileLabel ? "upload" : "manual",
      // How much of this came out of the file rather than the keyboard — the
      // signal for whether sheet parsing is actually working in the wild.
      fileKind: detected?.kind || null,
      keyDetected: Boolean(detected?.key),
      schemeDetected: Boolean(detected?.scheme),
      testDate: detected?.meta?.testDate || null,
      testTime: detected?.meta?.testTime || null,
      sectionSummary: summariseSections(result.rows),
      stats: {
        total: result.total,
        attempted: result.attempted,
        correct: result.correct,
        incorrect: result.incorrect,
        skipped: result.skipped,
        unkeyed: result.unkeyed,
        score: result.score,
        maxScore: result.maxScore,
        accuracy: result.accuracy,
      },
    });
  };

  const reset = () => {
    setResponsesText("");
    setKeyText("");
    setSections({});
    setLabels({});
    setFileLabel(null);
    setDetected(null);
    setShift("");
    setReport(null);
    setError("");
    if (SCHEMES[exam]) setScheme({ ...SCHEMES[exam] });
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadCsv = () => {
    const blob = new Blob([toCsv(report.rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `answer-key-result-${exam}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shownRows = report?.rows.filter((r) => filter === "all" || r.status === filter) || [];
  // Worth a table only when the sheet actually named its subjects.
  const bySection = report ? Object.entries(summariseSections(report.rows)) : [];
  const showSections = bySection.length > 1 || (bySection.length === 1 && bySection[0][0] !== "—");
  const inputClass =
    "w-full bg-tool-surface-lowest border border-tool-outline rounded-lg p-3 text-body-md text-tool-on-surface focus:border-tool-primary focus:ring-1 focus:ring-tool-primary outline-none transition-colors";

  return (
    <div className="min-h-screen bg-tool-surface text-tool-on-surface font-body-md flex flex-col items-center">
      {/* Same compact title bar as the Image Resizer tool, so the two public
          tools read as one family. Sticky rather than in-flow: this page scrolls
          (the resizer is locked to the viewport, so its bar never moves), and the
          bar should stay put the same way while the report scrolls under it. */}
      <header className="w-full shrink-0 sticky top-0 z-20 bg-tool-surface-lowest border-b border-tool-outline/70">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="rounded-[999px] grid place-items-center w-10 h-10 bg-tool-primary text-tool-on-primary shrink-0">
            <Icon name="fact_check" size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="text-headline-md font-bold leading-tight">Answer Key Checker</h1>
            <p className="text-body-md text-tool-secondary leading-tight">
              Upload your response sheet to instantly calculate your estimated score based on the official answer keys.
            </p>
          </div>
        </div>
      </header>

      <main className="w-full max-w-4xl px-4 md:px-0 py-8 md:py-12 flex-grow flex flex-col gap-6">
        <section className="bg-tool-surface border border-tool-outline rounded-xl p-6 flex flex-col gap-6">
          <h2 className="text-headline-md">Configuration &amp; Upload</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-1">
              <label className="text-label-md text-tool-on-surface-variant uppercase">Exam Category</label>
              <select value={exam} onChange={(e) => pickExam(e.target.value)} className={inputClass}>
                {EXAM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-label-md text-tool-on-surface-variant uppercase">Shift / Date</label>
              {/* Free text, not a list: every commission words its shifts
                  differently. Filled in from the sheet's own test date when the
                  uploaded file states one. */}
              <input
                type="text"
                value={shift}
                onChange={(e) => setShift(e.target.value)}
                placeholder="e.g. 09/10/2025, Shift 2"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              ["correct", "Marks / Correct"],
              ["wrong", "Penalty / Wrong"],
              ["skipped", "Marks / Skipped"],
              ["total", "Total Questions"],
            ].map(([field, label]) => (
              <div key={field} className="flex flex-col gap-1">
                <label className="text-label-md text-tool-on-surface-variant uppercase">{label}</label>
                <input
                  type="number"
                  step={field === "total" ? "1" : "0.25"}
                  value={scheme[field]}
                  onChange={(e) => setField(field, e.target.value)}
                  className={inputClass}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
            onDrop={(e) => { e.preventDefault(); setDragging(false); takeFile(e.dataTransfer.files[0]); }}
            className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center bg-tool-surface-lowest hover:bg-tool-surface-low transition-colors group ${
              dragging ? "border-tool-primary" : "border-tool-outline"
            }`}
          >
            <Icon name="upload_file" size={40} className="text-tool-primary mb-3 group-hover:scale-110 transition-transform" />
            <p className="text-body-lg font-semibold">{fileLabel?.name || "Drag & Drop Response Sheet"}</p>
            <p className="text-body-md text-tool-secondary mt-1">
              {fileLabel?.hint || "Response sheet PDF or saved HTML, or a plain text / CSV list of answers"}
            </p>
            <span className="mt-6 bg-tool-primary text-tool-on-primary px-6 py-3 rounded-lg text-body-md font-medium">
              Select File
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.html,.htm,.txt,.csv"
              className="hidden"
              onChange={(e) => takeFile(e.target.files[0])}
            />
          </button>

          {detected && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-md text-tool-secondary">Read from your sheet:</span>
              {detectedChips(detected).map((chip) => (
                <span
                  key={chip}
                  className="bg-tool-surface-low border border-tool-outline rounded-[999px] px-3 py-1 text-body-md"
                >
                  {chip}
                </span>
              ))}
              {!detected.key && (
                <span className="text-body-md text-tool-secondary">
                  — this file has no answer key in it, so paste the official one below.
                </span>
              )}
              {/* Plenty of sheets never print their marking scheme. Say so, or the
                  preset above silently decides the score. */}
              {!detected.scheme && (
                <span className="text-body-md text-tool-secondary">
                  — this file does not state its marking scheme, so check the marks above.
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-1">
              <label className="text-label-md text-tool-on-surface-variant uppercase">Your Responses</label>
              <textarea
                rows={8}
                value={responsesText}
                onChange={(e) => setResponsesText(e.target.value)}
                placeholder={"One per line:\n1 B\n2 C\n3 -\n\n…or a single run: BCAD-BA"}
                className={`${inputClass} font-data-mono`}
              />
              <p className="text-body-md text-tool-secondary">
                Auto-filled when you upload a response sheet. Use <span className="font-data-mono">-</span> for unattempted.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-label-md text-tool-on-surface-variant uppercase">Official Answer Key</label>
              <textarea
                rows={8}
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                placeholder={"One per line:\n1 B\n2 A\n\n…or a single run: BACD"}
                className={`${inputClass} font-data-mono`}
              />
              <p className="text-body-md text-tool-secondary">
                Paste the official key. Multiple correct: <span className="font-data-mono">7 A,C</span>. Dropped question:{" "}
                <span className="font-data-mono">9 *</span>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap justify-between items-center gap-3">
            {error && <p className="text-body-md text-tool-error">{error}</p>}
            <div className="flex gap-3 ml-auto">
              <button
                type="button"
                onClick={reset}
                className="border border-tool-outline px-6 py-3 rounded-lg text-body-md hover:bg-tool-surface-low transition-colors"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={analyze}
                className="bg-tool-primary text-tool-on-primary px-8 py-3 rounded-lg text-body-md font-semibold shadow-sm hover:bg-tool-tint transition-colors flex items-center gap-1"
              >
                <Icon name="analytics" size={18} />
                Analyze Responses
              </button>
            </div>
          </div>
        </section>

        {report && (
          <div className="mt-12 border-t border-tool-outline pt-12 flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-headline-lg">Analysis Report</h2>
              <button
                type="button"
                onClick={downloadCsv}
                className="border border-tool-outline px-6 py-3 rounded-lg text-body-md hover:bg-tool-surface-low transition-colors flex items-center gap-1"
              >
                <Icon name="download" size={18} /> Download CSV
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <StatCard
                accent
                label="Calculated Score"
                className="text-[40px] leading-[48px] font-bold text-tool-primary"
                value={
                  <>
                    {round(report.score)}
                    <span className="text-headline-md text-tool-secondary">/{round(report.maxScore)}</span>
                  </>
                }
              />
              <StatCard label="Total Attempted" className="text-headline-lg" value={report.attempted} />
              <StatCard label="Correct Answers" className="text-headline-lg text-tool-success" value={report.correct} />
              <StatCard label="Incorrect Answers" className="text-headline-lg text-tool-error" value={report.incorrect} />
            </div>

            <p className="text-body-md text-tool-secondary">
              {[
                EXAM_OPTIONS.find((o) => o.value === exam)?.label,
                shift,
                `${report.total} questions`,
                `${report.skipped} unattempted`,
                `${report.accuracy.toFixed(1)}% accuracy`,
                `+${round(report.marking.correct)} per correct, −${round(report.marking.wrong)} per wrong`,
                report.unkeyed > 0 && `${report.unkeyed} question(s) had no key entry and were excluded`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>

            {showSections && (
              <div className="bg-tool-surface border border-tool-outline rounded-xl overflow-hidden">
                <div className="bg-tool-surface-low p-3 border-b border-tool-outline">
                  <h3 className="text-headline-sm">Section-wise Performance</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-tool-surface-lowest border-b border-tool-outline">
                        {["Section / Subject", "Correct", "Incorrect", "Unattempted", "Score"].map((h, i) => (
                          <th
                            key={h}
                            className={`p-3 text-label-md text-tool-secondary uppercase ${i === 0 ? "" : "text-right"}`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-body-md divide-y divide-tool-outline">
                      {bySection.map(([name, s]) => (
                        <tr key={name}>
                          <td className="p-3 font-medium">{name}</td>
                          <td className="p-3 text-right text-tool-success">{s.correct}</td>
                          <td className="p-3 text-right text-tool-error">{s.incorrect}</td>
                          <td className="p-3 text-right text-tool-secondary">{s.skipped}</td>
                          <td className="p-3 text-right font-medium">{round(s.score)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-tool-surface border border-tool-outline rounded-xl overflow-hidden">
              <div className="bg-tool-surface-low p-3 border-b border-tool-outline flex items-center justify-between">
                <h3 className="text-headline-sm">Question Breakdown</h3>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="bg-tool-surface-lowest border border-tool-outline rounded-lg px-3 py-1 text-body-md outline-none"
                >
                  <option value="all">All questions</option>
                  <option value="correct">Correct only</option>
                  <option value="incorrect">Incorrect only</option>
                  <option value="skipped">Unattempted only</option>
                </select>
              </div>
              <div className="overflow-x-auto max-h-[520px] custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0">
                    <tr className="bg-tool-surface-lowest border-b border-tool-outline">
                      {["Q. No", "Section / Subject", "Your Ans", "Correct Ans", "Impact"].map((h, i) => (
                        <th
                          key={h}
                          className={`p-3 text-label-md text-tool-secondary uppercase ${
                            i === 4 ? "text-right" : i >= 2 ? "text-center" : ""
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-body-md divide-y divide-tool-outline">
                    {shownRows.length === 0 ? (
                      <tr>
                        <td className="p-6 text-tool-secondary" colSpan={5}>No questions match this filter.</td>
                      </tr>
                    ) : (
                      shownRows.map((r) => (
                        <tr key={r.q} className="hover:bg-tool-surface-lowest transition-colors">
                          <td className="p-3 font-medium">Q{r.label}</td>
                          <td className="p-3 text-tool-secondary">{r.section}</td>
                          <td className={`p-3 text-center font-medium ${r.mine ? "" : "text-tool-secondary"}`}>
                            {r.mine || "--"}
                          </td>
                          <td className="p-3 text-center text-tool-primary font-medium">{r.right || "—"}</td>
                          <td className={`p-3 text-right font-medium ${IMPACT_STYLES[r.status]}`}>
                            {r.status === "unkeyed" ? "—" : `${r.status === "correct" ? "+" : ""}${round(r.impact)}`}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="w-full bg-tool-surface-lowest border-t border-tool-outline mt-auto py-6">
        <div className="max-w-4xl mx-auto px-4 md:px-0">
          <p className="text-body-md text-tool-secondary">
            Scores are indicative. The official result published by the conducting body is final.
          </p>
        </div>
      </footer>
    </div>
  );
}
