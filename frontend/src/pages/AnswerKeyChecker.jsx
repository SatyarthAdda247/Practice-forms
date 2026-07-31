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
  DEFAULT_EXAM,
  EXAM_GROUPS,
  KEY_URL_HOSTS,
  examLabel,
  normalizeKeyUrl,
  parseAnnotatedHtmlSheet,
  parseAnswerList,
  parseResponseFile,
  round,
  schemeForExam,
  scoreAll,
  toCsv,
} from "../tools/lib/answerKey.js";

// Search-facing title/description for this route. server.js serves the same
// pair in the initial HTML — change both together.
const PAGE_TITLE = "Answer Key Calculator for SSC, Railway & Govt Exams (Free)";
const PAGE_DESCRIPTION =
  "Calculate your expected score using the official answer key for SSC, Railway, " +
  "Defence, Teaching, State, and Central Government exams.";
// The one URL this tool should rank under, absolute because a canonical must be.
// Mirrors PAGE_META in server.js — change both together.
const PAGE_CANONICAL = "https://tools.adda247.com/answerkey-checker";

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
  usePageMeta({
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    canonical: PAGE_CANONICAL,
  });

  const fileRef = useRef(null);

  const [exam, setExam] = useState(DEFAULT_EXAM);
  const [shift, setShift] = useState("");
  const [scheme, setScheme] = useState(() => schemeForExam(DEFAULT_EXAM));
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
  // The emailed response-sheet link, and how far the fetch has got.
  const [keyUrl, setKeyUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  // Cohort standing for the score just computed. null until it comes back, and
  // stays null when there is not enough data to say anything.
  const [rank, setRank] = useState(null);

  // Most exams pin no marking scheme — see the note above SCHEMES. For those the
  // marks inputs are left exactly as they are rather than reset to a guess, and
  // `schemePinned` below tells the candidate the marks are theirs to confirm.
  const pickExam = (value) => {
    setExam(value);
    const preset = schemeForExam(value);
    if (preset) setScheme(preset);
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

  // `from` lets the URL path score the sheet it has just parsed directly.
  // Without it this would read the state set moments earlier in the same tick,
  // which React has not applied yet.
  const analyze = (from) => {
    const responses = from?.responses ?? parseAnswerList(responsesText);
    const key = from?.key ?? parseAnswerList(keyText);
    const useSections = from?.sections ?? sections;
    const useLabels = from?.labels ?? labels;
    const useScheme = from?.scheme ?? scheme;
    const useDetected = from ? from.detected : detected;
    const inputSource = from?.inputSource ?? (fileLabel ? "upload" : "manual");
    if (!responses.size) return setError("Add your responses — upload a response sheet or paste them above.");
    if (!key.size) return setError("Paste the official answer key to compare against.");

    setError("");
    const marking = {
      correct: Number(useScheme.correct) || 0,
      wrong: Number(useScheme.wrong) || 0,
      skipped: Number(useScheme.skipped) || 0,
    };
    const result = scoreAll({
      responses,
      key,
      sections: useSections,
      labels: useLabels,
      total: Number(useScheme.total) || 0,
      scheme: marking,
    });
    // Keep the scheme the score was computed with, so the report keeps saying
    // what it was marked by even if the inputs are edited afterwards.
    setReport({ ...result, marking });

    // Where this score stands among everyone who has checked the same paper.
    // Asked for after the report is set, and allowed to come back empty — the
    // score must never wait on it.
    const testDate = useDetected?.meta?.testDate || null;
    setRank(null);
    toolsApi
      .keyCheckRank({ exam, score: result.score, testDate })
      .then((r) => setRank(r?.available ? r : null));

    // Warehouse the analysis (aggregates only — no individual answers, no key,
    // nothing that identifies the candidate).
    // Fire-and-forget: the report is already on screen either way.
    toolsApi.logKeyCheckResult({
      exam,
      shift,
      scheme: marking,
      inputSource,
      // How much of this came out of the file rather than the keyboard — the
      // signal for whether sheet parsing is actually working in the wild.
      fileKind: useDetected?.kind || null,
      keyDetected: Boolean(useDetected?.key),
      schemeDetected: Boolean(useDetected?.scheme),
      testDate,
      testTime: useDetected?.meta?.testTime || null,
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

  /* Paste-a-link path: fetch the emailed response sheet, read the responses AND
     the official key straight out of it, and score it in one go — the candidate
     types nothing. The page is fetched through the backend because the exam CDNs
     send no CORS headers; it is parsed here and never stored anywhere. */
  const analyzeUrl = async () => {
    const { url, error: bad } = normalizeKeyUrl(keyUrl);
    if (bad) return setError(bad);

    setUrlBusy(true);
    setError("");
    setReport(null);
    setRank(null);
    try {
      const { html } = await toolsApi.fetchAnswerKeyUrl(url);
      const parsed = parseAnnotatedHtmlSheet(html);
      if (!parsed.responses.size) {
        throw new Error(
          "That page opened, but no response sheet could be read from it. " +
            "Check the link points at your own response sheet, or upload the file below.",
        );
      }

      const asLines = (map) =>
        [...map.entries()].sort((a, b) => a[0] - b[0]).map(([q, a]) => `${q} ${a || "-"}`).join("\n");
      const hasKey = parsed.key.size > 0;

      // The sheet's own marking note beats the exam preset — it is what the
      // commission will actually mark this paper by. Only the fields it states
      // are overwritten; the rest keep the preset.
      const stated = Object.fromEntries(
        Object.entries(parsed.scheme || {}).filter(([, v]) => v != null),
      );
      const merged = { ...scheme, ...stated };
      const detectedFromUrl = {
        kind: "url",
        responses: parsed.responses.size,
        key: hasKey ? parsed.key.size : 0,
        // `total` is inferred from the question count, so this only counts as a
        // stated scheme if the marks themselves were stated.
        scheme: stated.correct != null || stated.wrong != null ? stated : null,
        sections: new Set(Object.values(parsed.sections)).size,
        meta: parsed.meta || {},
      };
      const shiftFromSheet = [parsed.meta?.testDate, parsed.meta?.testTime]
        .filter(Boolean)
        .join(", ");

      setResponsesText(asLines(parsed.responses));
      if (hasKey) setKeyText(asLines(parsed.key));
      setSections(parsed.sections);
      setLabels(parsed.labels || {});
      setScheme(merged);
      if (shiftFromSheet) setShift(shiftFromSheet);
      setDetected(detectedFromUrl);
      setFileLabel(null);
      if (fileRef.current) fileRef.current.value = "";

      if (!hasKey) {
        // Responses without the key cannot be scored, and silently showing a
        // zero would be worse than saying so.
        return setError(
          "That sheet lists your answers but not the official ones, so it cannot be " +
            "scored on its own. Paste the official answer key below and press Analyze.",
        );
      }

      analyze({
        responses: parsed.responses,
        key: parsed.key,
        sections: parsed.sections,
        labels: parsed.labels || {},
        scheme: merged,
        detected: detectedFromUrl,
        inputSource: "url",
      });
    } catch (e) {
      console.warn("answer key URL failed:", e);
      setError(e.message || "Could not read that link.");
    } finally {
      setUrlBusy(false);
    }
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
    setKeyUrl("");
    setRank(null);
    const preset = schemeForExam(exam);
    if (preset) setScheme(preset);
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
  // Whether the selected exam carries a known marking pattern, or the marks in
  // the boxes are the candidate's own to confirm.
  const schemePinned = schemeForExam(exam) !== null;
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

          {/* The fastest route in, so it goes first: candidates are emailed a
              link to their response sheet, and that page carries their answers,
              the official key, the marking scheme and the section names. One
              paste and the score is done — nothing to type, nothing to upload. */}
          <div className="bg-tool-surface-low border border-tool-outline rounded-xl p-4 md:p-6 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="answer-key-url" className="text-label-md text-tool-on-surface-variant uppercase">
                Answer Key URL
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  id="answer-key-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={keyUrl}
                  onChange={(e) => setKeyUrl(e.target.value)}
                  // Enter is what anyone does after pasting a link into a single
                  // field, so make it submit rather than do nothing.
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !urlBusy) {
                      e.preventDefault();
                      analyzeUrl();
                    }
                  }}
                  placeholder="https://cdn3.digialm.com/per/g26/pub/…/….html"
                  className={`${inputClass} font-data-mono flex-grow min-w-0`}
                />
                <button
                  type="button"
                  onClick={analyzeUrl}
                  disabled={urlBusy}
                  className="bg-tool-primary text-tool-on-primary px-6 py-3 rounded-lg text-body-md font-semibold shadow-sm hover:bg-tool-tint transition-colors flex items-center justify-center gap-1 shrink-0 disabled:opacity-60"
                >
                  <Icon name={urlBusy ? "hourglass_top" : "link"} size={18} />
                  {urlBusy ? "Reading sheet…" : "Get My Score"}
                </button>
              </div>
            </div>
            <p className="text-body-md text-tool-secondary">
              Paste the response-sheet link the commission emailed you and your score is
              calculated automatically — your answers, the official key and the marking scheme
              are all read from that page. Supported: {KEY_URL_HOSTS.join(", ")}.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="h-px flex-grow bg-tool-outline" />
            <span className="text-label-md text-tool-secondary uppercase">or set it up yourself</span>
            <span className="h-px flex-grow bg-tool-outline" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-1">
              <label htmlFor="exam-select" className="text-label-md text-tool-on-surface-variant uppercase">
                Exam
              </label>
              {/* Grouped by conducting body: the list runs to ~200 papers, and
                  the exam picked here is the cohort a rank is measured against,
                  so picking the actual paper rather than a family matters. */}
              <select
                id="exam-select"
                value={exam}
                onChange={(e) => pickExam(e.target.value)}
                className={inputClass}
              >
                {EXAM_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {/* Say when the marks are the candidate's to confirm rather than a
                  known pattern — otherwise whatever is in the boxes silently
                  decides the score of a hand-typed paper. */}
              {!schemePinned && (
                <p className="text-body-md text-tool-secondary">
                  No standard marking pattern is stored for this exam — check the marks below, or
                  paste your sheet above and they will be read from it.
                </p>
              )}
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
                // Wrapped, not passed directly: analyze() now takes parsed input
                // as its first argument, and onClick would hand it a MouseEvent.
                onClick={() => analyze()}
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

            {/* Expected rank. Deliberately labelled with the cohort it is drawn
                from: the only scores this tool holds are those of candidates who
                used it, so this is a standing among them, not the commission's
                rank list. Hidden entirely when the cohort is too small to mean
                anything (the backend decides that, not this component). */}
            {rank && (
              <div className="bg-tool-surface-lowest border border-tool-outline rounded-xl p-6 flex flex-col gap-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-label-md text-tool-secondary uppercase">Expected Rank</span>
                    <span className="text-[40px] leading-[48px] font-bold text-tool-primary">
                      #{rank.rank}
                      <span className="text-headline-md text-tool-secondary">
                        {" "}of {rank.cohort.toLocaleString("en-IN")}
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <div className="flex flex-col gap-1">
                      <span className="text-label-md text-tool-secondary uppercase">Standing</span>
                      {/* rank/cohort, not the backend's `percentile` (which is the
                          share at or below this score): topping the cohort has to
                          read as "Top 1%", never "Top 0%". */}
                      <span className="text-headline-lg">
                        Top {Math.max(1, Math.ceil((rank.rank / rank.cohort) * 100))}%
                      </span>
                    </div>
                    {rank.avgScore != null && (
                      <div className="flex flex-col gap-1">
                        <span className="text-label-md text-tool-secondary uppercase">Cohort Average</span>
                        <span className="text-headline-lg">{round(rank.avgScore)}</span>
                      </div>
                    )}
                    {rank.topScore != null && (
                      <div className="flex flex-col gap-1">
                        <span className="text-label-md text-tool-secondary uppercase">Cohort Best</span>
                        <span className="text-headline-lg">{round(rank.topScore)}</span>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-body-md text-tool-secondary">
                  Among {rank.cohort.toLocaleString("en-IN")} candidates who have checked{" "}
                  {rank.basis === "paper"
                    ? "this same shift"
                    : "this exam"}{" "}
                  with this tool — {rank.better.toLocaleString("en-IN")} scored higher than you.
                  This is an indicative standing within that group, not the conducting body's
                  official rank list.
                </p>
              </div>
            )}

            <p className="text-body-md text-tool-secondary">
              {[
                examLabel(exam),
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
