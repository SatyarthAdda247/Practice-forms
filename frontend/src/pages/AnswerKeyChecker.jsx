// Public standalone tool at /answerkey-checker — no auth, no portal chrome, no
// backend. The response sheet is parsed in the browser and never uploaded.
// Logic lives in ../tools/lib/answerKey.js.
import { useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { toolsApi } from "../api.js";
import {
  EXAM_OPTIONS,
  SCHEMES,
  parseAnswerList,
  parseResponseFile,
  round,
  scoreAll,
  toCsv,
} from "../tools/lib/answerKey.js";

const SHIFTS = ["24 Jan, Shift 1", "24 Jan, Shift 2", "25 Jan, Shift 1", "25 Jan, Shift 2"];

const IMPACT_STYLES = {
  correct: "text-tool-success",
  incorrect: "text-tool-error",
  skipped: "text-tool-secondary",
  unkeyed: "text-tool-secondary",
};

// Per-section tallies for the warehouse — how a cohort performed by subject.
// Counts only; no individual answers leave the browser.
function summariseSections(rows) {
  const out = {};
  for (const r of rows) {
    if (r.status === "unkeyed") continue;
    const bucket = (out[r.section] ??= { correct: 0, incorrect: 0, skipped: 0 });
    bucket[r.status] += 1;
  }
  return out;
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
  const fileRef = useRef(null);

  const [exam, setExam] = useState("jee");
  const [shift, setShift] = useState(SHIFTS[0]);
  const [scheme, setScheme] = useState({ ...SCHEMES.jee });
  const [responsesText, setResponsesText] = useState("");
  const [keyText, setKeyText] = useState("");
  const [sections, setSections] = useState({});
  const [fileLabel, setFileLabel] = useState(null);
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
      const { responses, key, sections: found } = await parseResponseFile(file);
      if (!responses.size) {
        setFileLabel({ name: file.name, hint: "Could not find any answers — paste them manually below." });
        return setError("No responses found in the uploaded file.");
      }
      const asLines = (map) =>
        [...map.entries()].sort((a, b) => a[0] - b[0]).map(([q, a]) => `${q} ${a || "-"}`).join("\n");

      setSections(found);
      setResponsesText(asLines(responses));

      // Annotated sheets carry the key alongside the responses; use it rather
      // than making the candidate retype what the file already contains.
      const hasKey = key && key.size > 0;
      if (hasKey) setKeyText(asLines(key));

      setFileLabel({
        name: file.name,
        hint: hasKey
          ? `${responses.size} responses + ${key.size} answers from the key — click to replace`
          : `${responses.size} responses parsed — paste the official key on the right`,
      });
      setError("");
    } catch (e) {
      console.warn("response sheet parse failed:", e);
      setError("Could not read that file. Try the HTML response sheet, or paste your answers below.");
      setFileLabel(null);
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
      total: Number(scheme.total) || 0,
      scheme: marking,
    });
    setReport(result);

    // Warehouse the analysis (aggregates only — no individual answers, no key).
    // Fire-and-forget: the report is already on screen either way.
    toolsApi.logKeyCheckResult({
      exam,
      shift,
      scheme: marking,
      inputSource: fileLabel ? "upload" : "manual",
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
    setFileLabel(null);
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
  const inputClass =
    "w-full bg-tool-surface-lowest border border-tool-outline rounded-lg p-3 text-body-md text-tool-on-surface focus:border-tool-primary focus:ring-1 focus:ring-tool-primary outline-none transition-colors";

  return (
    <div className="min-h-screen bg-tool-surface text-tool-on-surface font-body-md flex flex-col items-center">
      <main className="w-full max-w-4xl px-4 md:px-0 py-12 md:py-20 flex-grow flex flex-col gap-6">
        <header className="text-center mb-6">
          <h1 className="text-[48px] leading-[56px] tracking-[-0.02em] font-bold mb-3">Answer Key Checker</h1>
          <p className="text-body-lg text-tool-secondary max-w-2xl mx-auto">
            Upload your response sheet to instantly calculate your estimated score based on the official answer keys.
          </p>
        </header>

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
              <select value={shift} onChange={(e) => setShift(e.target.value)} className={inputClass}>
                {SHIFTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
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
              {EXAM_OPTIONS.find((o) => o.value === exam)?.label} · {shift} — {report.total} questions ·{" "}
              {report.skipped} unattempted · {report.accuracy.toFixed(1)}% accuracy
              {report.unkeyed > 0 && ` · ${report.unkeyed} question(s) had no key entry and were excluded`}
            </p>

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
                          <td className="p-3 font-medium">Q{r.q}</td>
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
