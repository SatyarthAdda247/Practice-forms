import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";

const OPTIONS = ["A", "B", "C", "D"];
const PRESETS = [50, 100, 200];

// One question row: number + four radio bubbles.
function QuestionRow({ q, value, onChange }) {
  return (
    <div className="flex items-center gap-md p-sm rounded-lg hover:bg-surface-container-low transition-colors group">
      <span className="font-data-mono text-data-mono text-secondary w-8 text-right shrink-0">
        {String(q).padStart(2, "0")}.
      </span>
      <div className="flex gap-xs flex-1">
        {OPTIONS.map((opt) => {
          const checked = value === opt;
          return (
            <label key={opt} className="cursor-pointer relative">
              <input
                type="radio"
                name={`q${q}`}
                value={opt}
                checked={checked}
                onChange={() => onChange(q, opt)}
                className="peer sr-only"
              />
              <div
                className={`w-8 h-8 rounded-full border flex items-center justify-center font-body-sm text-body-sm transition-colors ${
                  checked
                    ? "bg-primary border-primary text-on-primary shadow-[0_2px_4px_rgba(0,0,0,0.1)]"
                    : "border-outline-variant text-on-surface-variant hover:border-primary"
                }`}
              >
                {opt}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function AnswerKeyConfig() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [numQuestions, setNumQuestions] = useState(50);
  const [custom, setCustom] = useState(false); // "Custom…" OMR format selected
  const [marksCorrect, setMarksCorrect] = useState(4);
  const [marksPenalty, setMarksPenalty] = useState(1);
  const [answers, setAnswers] = useState({}); // { "1": "B", ... }
  const [visibleCount, setVisibleCount] = useState(10); // paginated in 10s
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load existing exam when editing.
  useEffect(() => {
    if (!id) return;
    api
      .getExam(id)
      .then((e) => {
        setName(e.name);
        setDate(e.date || "");
        setNumQuestions(e.numQuestions);
        setCustom(!PRESETS.includes(e.numQuestions));
        setMarksCorrect(e.marksCorrect);
        setMarksPenalty(e.marksPenalty);
        setAnswers(e.answerKey || {});
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const setAnswer = (q, opt) => setAnswers((prev) => ({ ...prev, [q]: opt }));

  // Show questions in pages of 10 (matches the mobile "Load More" pattern).
  const shown = Math.min(visibleCount, numQuestions);
  const segments = useMemo(() => {
    const segs = [];
    for (let start = 1; start <= shown; start += 10) {
      const end = Math.min(start + 9, shown);
      segs.push({ start, end, questions: range(start, end) });
    }
    return segs;
  }, [shown]);

  const answeredCount = Object.keys(answers).length;

  const handleImportCsv = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { answers: parsed, outOfRange } = parseCsv(text, numQuestions);
      // The imported file *is* the key: it replaces whatever was there rather
      // than merging into it. Merging left the two files interleaved — every
      // question the new file didn't cover kept the old file's answer, so a
      // second import silently produced a key matching neither.
      const replaced = Object.keys(answers).length;
      setAnswers(parsed);
      // Say what landed. A key that runs past the exam's question count is the
      // one import failure that otherwise looks like a success: the grid fills
      // in as far as it goes and the rest of the file is simply gone.
      const imported = Object.keys(parsed).length;
      setError(
        [
          replaced
            ? `Replaced the previous key (${replaced} answers) with ${imported} ` +
              `from this file.`
            : "",
          outOfRange.length
            ? `Skipped ${outOfRange.length} answers for questions past ` +
              `${numQuestions} — raise "Number of Questions" to ` +
              `${Math.max(...outOfRange)} and import again.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (err) {
      setError(`CSV import failed: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  };

  const save = async () => {
    setError("");
    if (!name.trim()) {
      setError("Exam name is required.");
      return;
    }
    const nq = Number(numQuestions);
    if (!Number.isInteger(nq) || nq < 1 || nq > 200) {
      setError("Number of questions must be between 1 and 200.");
      return;
    }
    // Drop any answers for questions beyond the (possibly reduced) count so the
    // backend doesn't reject the key as out of range.
    const answerKey = Object.fromEntries(
      Object.entries(answers).filter(([q]) => Number(q) >= 1 && Number(q) <= nq)
    );
    setSaving(true);
    const payload = {
      name: name.trim(),
      date: date || null,
      numQuestions: nq,
      marksCorrect: Number(marksCorrect),
      marksPenalty: Number(marksPenalty),
      answerKey,
    };
    try {
      const exam = id
        ? await api.updateExam(id, payload)
        : await api.createExam(payload);
      navigate(`/upload/${exam.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="mb-xl">
        <div className="flex items-center gap-sm mb-xs text-on-surface-variant">
          <Link to="/exams" className="hover:text-primary transition-colors flex items-center">
            <Icon name="arrow_back" size={18} />
          </Link>
          <span className="font-label-md text-label-md uppercase tracking-wider">
            {id ? "Edit Exam" : "New Exam Setup"}
          </span>
        </div>
        <h1 className="font-headline-lg text-headline-lg text-on-background mb-sm">
          Answer Key Configuration
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
          Define the exam parameters and set the correct answers. Use the segmented grid below to
          input the master key for OMR validation.
        </p>
      </div>

      {error && (
        <div className="mb-lg p-md rounded-xl bg-error-container text-on-error-container font-body-md">
          {error}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-lg items-start">
        {/* Left column: settings */}
        <div className="w-full lg:w-1/3 space-y-md">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-md shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <h2 className="font-headline-sm text-headline-sm text-on-background mb-md border-b border-outline-variant pb-xs">
              Exam Details
            </h2>
            <div className="space-y-md">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                  Exam Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Mid-Term Physics 2024"
                  className="w-full bg-surface border border-outline-variant rounded-lg px-sm py-2 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary transition-shadow placeholder:text-outline"
                />
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-surface border border-outline-variant rounded-lg pl-sm pr-10 py-2 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary transition-shadow"
                />
              </div>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-md shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <h2 className="font-headline-sm text-headline-sm text-on-background mb-md border-b border-outline-variant pb-xs">
              Format &amp; Marking
            </h2>
            <div className="space-y-md">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                  OMR Format
                </label>
                <select
                  value={custom ? "custom" : numQuestions}
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      setCustom(true);
                    } else {
                      setCustom(false);
                      setNumQuestions(Number(e.target.value));
                    }
                  }}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-sm py-2 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary transition-shadow"
                >
                  <option value={50}>50 Questions (Standard)</option>
                  <option value={100}>100 Questions</option>
                  <option value={200}>200 Questions (Extended)</option>
                  <option value="custom">Custom…</option>
                </select>
                {custom && (
                  <div className="mt-sm">
                    <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                      Number of Questions
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={numQuestions}
                      onChange={(e) => setNumQuestions(Number(e.target.value))}
                      placeholder="e.g., 35"
                      className="w-full bg-surface border border-outline-variant rounded-lg px-sm py-2 font-data-mono text-data-mono text-on-surface focus:ring-1 focus:ring-primary focus:border-primary transition-shadow"
                    />
                    <p className="mt-xs font-body-sm text-body-sm text-on-surface-variant">
                      Only these questions are graded, even if the printed sheet has more.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-md">
                <div className="flex-1">
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                    Marks/Correct
                  </label>
                  <div className="relative">
                    <span className="absolute left-sm top-1/2 -translate-y-1/2 text-outline-variant font-data-mono">
                      +
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={marksCorrect}
                      onChange={(e) => setMarksCorrect(e.target.value)}
                      className="w-full bg-surface border border-outline-variant rounded-lg pl-xl pr-sm py-2 font-data-mono text-data-mono text-on-surface focus:ring-1 focus:ring-primary focus:border-primary transition-shadow text-right"
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                    Penalty/Wrong
                  </label>
                  <div className="relative">
                    <span className="absolute left-sm top-1/2 -translate-y-1/2 text-error font-data-mono">
                      −
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={marksPenalty}
                      onChange={(e) => setMarksPenalty(e.target.value)}
                      className="w-full bg-surface border border-outline-variant rounded-lg pl-xl pr-sm py-2 font-data-mono text-data-mono text-on-surface focus:ring-1 focus:ring-error focus:border-error transition-shadow text-right"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: answer key grid */}
        <div className="w-full lg:w-2/3 bg-surface-container-lowest rounded-xl border border-outline-variant shadow-[0_1px_2px_rgba(0,0,0,0.05)] flex flex-col lg:h-[600px]">
          <div className="p-md border-b border-outline-variant bg-surface-bright rounded-t-xl flex justify-between items-center gap-sm shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-sm flex-wrap">
                <h2 className="font-headline-sm text-headline-sm text-on-background">
                  Master Answer Key
                </h2>
                <span className="font-label-md text-label-md text-on-secondary-container bg-secondary-container px-sm py-xs rounded-full whitespace-nowrap">
                  1-{shown} of {numQuestions}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                {answeredCount} of {numQuestions} answered.
              </p>
            </div>
            <div className="flex gap-sm shrink-0">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportCsv}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="px-md py-sm border border-outline-variant rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-xs"
              >
                <Icon name="upload_file" size={18} />
                <span className="hidden sm:inline">Import CSV</span>
              </button>
            </div>
          </div>

          <div className="flex-1 lg:overflow-y-auto p-md custom-scrollbar bg-surface">
            {segments.map((seg) => (
              <div key={seg.start} className="mb-lg">
                <h3 className="font-label-md text-label-md text-on-surface-variant mb-sm uppercase tracking-wider pl-sm border-l-2 border-outline-variant">
                  Questions {seg.start} - {seg.end}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
                  {seg.questions.map((q) => (
                    <QuestionRow
                      key={q}
                      q={q}
                      value={answers[String(q)]}
                      onChange={setAnswer}
                    />
                  ))}
                </div>
              </div>
            ))}

            {shown < numQuestions && (
              <button
                onClick={() => setVisibleCount((c) => c + 10)}
                className="w-full py-sm border border-primary rounded-full font-label-md text-label-md text-primary hover:bg-secondary-container/40 transition-colors"
              >
                Load More Questions
              </button>
            )}
          </div>

          <div className="p-md border-t border-outline-variant bg-surface-bright rounded-b-xl flex justify-end gap-sm shrink-0">
            <Link
              to="/exams"
              className="px-lg py-2 border border-outline-variant rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              Cancel
            </Link>
            <button
              onClick={save}
              disabled={saving}
              className="px-lg py-2 bg-primary-container text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors shadow-[0_2px_8px_rgba(26,54,93,0.15)] flex items-center gap-xs disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save & Continue"}
              <Icon name="arrow_forward" size={18} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

// Parse an answer-key CSV. Returns ``{ answers, outOfRange }`` — the questions
// beyond ``numQuestions`` are reported rather than dropped in silence, because
// importing a 100-question key onto an exam still set to 50 would otherwise
// look like a half-empty file.
//
// Accepted layouts:
//   * one "question,answer" pair per row            ("1,A")
//   * several pairs side by side on a row           ("1,A,26,B,51,C,76,D") —
//     how a printed key of 100 questions fits on 25 rows, and the layout the
//     exported Adda247 keys use
//   * a bare list of answers in question order      ("A,B,C,D")
//
// Pairs are found by scanning each row for a question number followed by an
// option, which is what makes the wide layout work without having to declare
// the number of blocks. It also skips whatever else the row carries — a header,
// a section name in a third column, the trailing all-comma line spreadsheets
// leave behind — instead of counting those cells as answer positions. Counting
// them is what went wrong before: a key laid out in four Q/Ans blocks fell
// through to the bare-list branch, and every answer landed on the wrong
// question (Q1's "D" was imported as Q10's).
function parseCsv(text, numQuestions) {
  const rows = text
    .replace(/^\uFEFF/, "")     // Excel writes a BOM onto the first cell
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim().toUpperCase()))
    .filter((cells) => cells.some(Boolean));
  if (!rows.length) throw new Error("the file is empty");

  const isNumber = (cell) => /^\d+$/.test(cell);
  const answers = {};
  const outOfRange = new Set();
  const record = (q, opt) => {
    const n = Number(q);
    if (n < 1 || !OPTIONS.includes(opt)) return;
    if (n > numQuestions) outOfRange.add(n);
    else answers[String(n)] = opt;
  };

  let pairs = 0;
  for (const cells of rows) {
    for (let i = 0; i + 1 < cells.length; i += 1) {
      if (!isNumber(cells[i]) || !OPTIONS.includes(cells[i + 1])) continue;
      record(cells[i], cells[i + 1]);
      pairs += 1;
      i += 1;                        // consume the option cell as well
    }
  }

  // No numbering anywhere: the file is a plain list of options in question
  // order, so position *is* the question number. Rows carrying no option at all
  // (a "Answer" label line) are dropped first; empty cells inside a row are
  // kept, since they are unanswered questions holding their place.
  if (!pairs) {
    rows
      .filter((cells) => cells.some((c) => OPTIONS.includes(c)))
      .flat()
      .forEach((opt, i) => record(String(i + 1), opt));
  }

  if (!Object.keys(answers).length) {
    throw new Error(
      outOfRange.size
        ? `the key covers questions up to ${Math.max(...outOfRange)}, but this ` +
          `exam is set to ${numQuestions} questions`
        : "no valid answers found"
    );
  }
  return { answers, outOfRange: [...outOfRange] };
}
