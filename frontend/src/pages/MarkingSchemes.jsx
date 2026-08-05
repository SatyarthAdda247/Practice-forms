/* Admin console for the Answer Key Checker's marking schemes.
 *
 * Why this screen exists. The checker fills its marks in from three places, in
 * this order of authority: the marking note printed on the candidate's response
 * sheet, a row set here, and the built-in per-exam preset shipped in
 * answerKey.js. Plenty of commissions print no marking note, and the presets
 * deliberately cover only long-standing patterns — so a newly announced paper
 * had nothing to be scored by but whatever preset the dropdown happened to be
 * showing. That is how a Punjab Police paper (+1, no penalty) came to be scored
 * as SSC (+2, −0.5): every mark inflated, and a penalty applied that the paper
 * does not have.
 *
 * Correcting that by editing answerKey.js means waiting for a frontend deploy,
 * during which every candidate checking that shift is shown a wrong score. A row
 * saved here reaches candidates within a couple of minutes (the public endpoint
 * caches for SCHEME_TTL, and sends a matching Cache-Control).
 *
 * Access is deliberately narrow. A number on this screen changes the score shown
 * to every candidate who checks that paper, so it is not open to all admins:
 * super admins always, plus the people a super admin has named under "Who can
 * change marking" on the Administrator page. The API enforces it — this page only
 * avoids offering what would 403.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";
import Loading from "../components/Loading.jsx";
import {
  EXAM_OPTIONS,
  builtInSchemeForExam,
  defaultPaper,
  examGroups,
  examLabel,
  isAddedExam,
  isExamSlug,
  papersForExam,
  parseMarksValue,
  round,
  setSchemeOverrides,
  slugifyExam,
} from "../tools/lib/answerKey.js";

// How commissions word a penalty. Offered as chips because "one-third of a mark"
// is what a notification says and 0.3333 is what has to be stored — a mismatch
// there is exactly the kind of transcription slip this screen exists to prevent.
const PENALTY_PRESETS = [
  ["None", "0"],
  ["1/4", "0.25"],
  ["1/3", "0.3333"],
  ["1/2", "0.5"],
  ["2/3", "0.6667"],
  ["1", "1"],
];

const BLANK = {
  exam: "",
  correct: "1",
  wrong: "0",
  skipped: "0",
  total: "",
  enforced: false,
  note: "",
  // Only used while adding an exam the tool has never heard of.
  newExam: false,
  label: "",
  group: "",
  // Which tier of the exam this row applies to. Blank on a single-paper exam.
  paper: "",
};

/* A row's storage key. An exam with tiers is keyed per tier, so correcting SSC
 * CGL Tier-II leaves Tier-I alone — they are different papers with different
 * marking, and one row could not describe both. Mirrors overrideKey() in
 * answerKey.js; the two have to agree or a saved row would never be found. */
const rowKey = (exam, paper) => (paper ? `${exam}#${paper}` : exam);

const inputClass =
  "w-full bg-surface border border-outline-variant rounded-lg px-sm py-2 font-body-md text-body-md " +
  "text-on-surface focus:ring-1 focus:ring-primary focus:border-primary";

// A marks value as it will be stored, or null when it cannot be read. Shown back
// to the admin before they save, so "1/3" and a stray "o.33" are told apart on
// screen rather than by a validation error.
function preview(raw) {
  const value = parseMarksValue(raw);
  return Number.isFinite(value) ? value : null;
}

// One line describing a scheme the way the candidate-facing tool phrases it, so
// what is checked here reads the same as what is shipped.
function describe(scheme) {
  if (!scheme) return "no marking pattern stored";
  const penalty = Number(scheme.wrong)
    ? `−${round(Number(scheme.wrong))} per wrong`
    : "no negative marking";
  const parts = [`+${round(Number(scheme.correct))} per correct`, penalty];
  if (Number(scheme.skipped)) parts.push(`${round(Number(scheme.skipped))} per unattempted`);
  if (Number(scheme.total)) parts.push(`${scheme.total} questions`);
  return parts.join(" · ");
}

/* A stored row's identity, decomposed. `exam` ids carry the tier ("ssc-cgl#tier-2"),
 * so anything that reasons about the exam behind a row has to split it first —
 * otherwise a tiered override reads as an exam the tool has never heard of, gets
 * badged "added exam", and its clear dialog threatens to remove SSC CGL. */
function rowIdentity(row) {
  const [exam, paper = ""] = String(row.exam).split("#");
  const tier = paper ? papersForExam(exam).find((p) => p.value === paper)?.label || paper : "";
  return { exam, paper, tier, preset: builtInSchemeForExam(exam, paper) };
}

export default function MarkingSchemes() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [query, setQuery] = useState("");

  const load = () => {
    setLoading(true);
    api
      .adminListKeycheckSchemes()
      .then((d) => {
        const schemes = d.schemes || [];
        setRows(schemes);
        /* Register them with the library, exactly as the public tool does. That
           is what puts an admin-created exam into the dropdown below, so an exam
           added here can be edited here afterwards rather than being visible
           only to candidates. */
        setSchemeOverrides(Object.fromEntries(schemes.map((r) => [r.exam, r])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Keyed by the stored id, which for a tiered exam is "exam#paper".
  const byExam = useMemo(() => new Map(rows.map((r) => [r.exam, r])), [rows]);
  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  // What this form will save as, and the tiers the picked exam has.
  const stored = rowKey(form.exam, form.paper);
  const papers = form.exam ? papersForExam(form.exam) : [];

  // The exam paper picked in the form: what it is marked by now, and what it would
  // fall back to if this override were cleared.
  const selected = form.exam
    ? {
        override: byExam.get(stored) || null,
        preset: builtInSchemeForExam(form.exam, form.paper),
      }
    : null;

  // Editing a row loads it back, so a small correction does not mean retyping the
  // whole scheme (and accidentally dropping the note with it).
  const edit = (row) => {
    // Stored ids carry the tier: "ssc-cgl#tier-2" is Tier-II of SSC CGL.
    const [exam, paper = ""] = String(row.exam).split("#");
    setForm({
      ...BLANK,
      exam,
      paper,
      correct: String(row.correct ?? ""),
      wrong: String(row.wrong ?? "0"),
      skipped: String(row.skipped ?? "0"),
      total: row.total ? String(row.total) : "",
      enforced: Boolean(row.enforced),
      note: row.note || "",
      // An exam that exists only because it was added here keeps its name and
      // grouping in the form, so editing its marks cannot drop them.
      newExam: !builtInSchemeForExam(exam, paper) && isAddedExam(exam),
      label: row.label || "",
      group: row.group || "",
    });
    setSaved("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Start from whatever the paper is already marked by, rather than from +1/0 —
  // most edits are a correction to one number, not a scheme written from scratch.
  const pickExam = (exam, paperArg) => {
    // A tiered exam opens on its first tier, which is the one most candidates are
    // checking; the Tier selector switches it.
    const paper = paperArg ?? (papersForExam(exam).length ? defaultPaper(exam) : "");
    const existing = byExam.get(rowKey(exam, paper));
    if (existing) return edit(existing);
    const preset = builtInSchemeForExam(exam, paper);
    setForm({
      ...BLANK,
      exam,
      paper: paper || "",
      correct: preset ? String(preset.correct) : "1",
      wrong: preset ? String(preset.wrong) : "0",
      skipped: preset ? String(preset.skipped) : "0",
      total: preset?.total ? String(preset.total) : "",
    });
    setSaved("");
  };

  /* Switch between "set the marks for an exam the tool already lists" and "add a
     paper it has never heard of". The second is for a recruitment announced after
     the tool was last deployed: the exam appears in the candidate-facing dropdown
     as soon as it is saved. */
  const startNewExam = () => {
    setForm({ ...BLANK, newExam: true });
    setSaved("");
    setError("");
  };

  // The slug is suggested from the name and stays editable until it is saved,
  // because it is permanent afterwards: renaming one orphans every score already
  // warehoused under the old name. Once the row exists, the field is read-only.
  const isEditingExisting = Boolean(form.newExam && byExam.has(stored));
  const setLabel = (label) => {
    setForm((f) => ({
      ...f,
      label,
      exam: isEditingExisting ? f.exam : slugifyExam(label),
    }));
  };

  // Existing group names, so an added exam files itself with its own board rather
  // than starting a near-duplicate group.
  const groupNames = useMemo(
    () => [...new Set(examGroups().map((g) => g.group))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );

  const save = async () => {
    setError("");
    setSaved("");
    const label = form.newExam ? form.label.trim() : examLabel(form.exam);
    if (form.newExam) {
      if (!label) return setError("Give the exam a name, as candidates should see it.");
      if (!isExamSlug(form.exam)) {
        return setError(
          "The exam ID must be lowercase letters, digits and hyphens — " +
            "e.g. punjab-police-si. Edit it below.",
        );
      }
      // A slug already in the shipped catalogue is that exam, not a new one, and
      // saving over it would replace its marking rather than adding a paper.
      const clash = EXAM_OPTIONS.find((o) => o.value === form.exam);
      if (clash && !byExam.has(stored)) {
        return setError(
          `"${form.exam}" is already the ID of ${clash.label}. Pick a different ID, or ` +
            `choose that exam above to change how it is marked.`,
        );
      }
    } else if (!form.exam) {
      return setError("Pick the exam this marking scheme applies to.");
    }
    const correct = preview(form.correct);
    if (!correct || correct <= 0) {
      return setError("Marks per correct answer must be a number greater than 0.");
    }
    /* Every marks field is checked, not just the two obvious ones. An unreadable
       value resolves to null, which the API cannot tell from "not filled in" and
       therefore stores as 0 — so a mistyped "−1/3" in the unattempted box would
       have saved silently as "no deduction" and scored every candidate on that
       paper without it. */
    for (const [field, label] of [
      ["wrong", "Penalty per wrong answer"],
      ["skipped", "Marks per unattempted question"],
    ]) {
      if (form[field] !== "" && preview(form[field]) === null) {
        return setError(`${label} must be a number, e.g. 0.33 or 1/3.`);
      }
    }
    // Checked here rather than relying on the input's min/max/step: there is no
    // <form> around it, so the browser never runs constraint validation, and the
    // API would truncate "12.5" to 12 without saying so.
    if (form.total !== "" && !(Number.isInteger(Number(form.total)) && Number(form.total) > 0)) {
      return setError("Total questions must be a whole number greater than 0, or left blank.");
    }
    setSaving(true);
    try {
      await api.adminSetKeycheckScheme({
        // The tier is part of the key, so each tier keeps its own marks.
        exam: stored,
        // Stored alongside the slug so the list and the audit trail still read
        // sensibly for an exam later retired from the catalogue — and, for an
        // exam added here, because it is the only name the tool has for it.
        label,
        // Only meaningful for an added exam; a catalogue exam carries its own.
        group: form.newExam ? form.group.trim() || null : null,
        correct,
        wrong: form.wrong === "" ? 0 : preview(form.wrong),
        skipped: form.skipped === "" ? 0 : preview(form.skipped),
        total: form.total === "" ? null : Number(form.total),
        enforced: form.enforced,
        note: form.note.trim() || null,
      });
      const marks = describe({
        correct,
        wrong: preview(form.wrong) ?? 0,
        skipped: preview(form.skipped) ?? 0,
        total: form.total,
      });
      setSaved(
        form.newExam && !byExam.has(stored)
          ? `${label} has been added to the Answer Key Checker and will be scored at ` +
              `${marks}. Candidates can pick it within a couple of minutes.`
          : `${label} will now be scored at ${marks}. Candidates see it within a ` +
              `couple of minutes.`,
      );
      setForm(BLANK);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async (row) => {
    const { tier, preset } = rowIdentity(row);
    const name = [row.label || row.exam, tier].filter(Boolean).join(" — ");
    /* Two very different outcomes behind one button. Clearing a catalogue exam's
       row falls it back to the shipped pattern; clearing an exam that was *added*
       here deletes the only record of it, so the exam disappears from the tool
       altogether. Say which. */
    const consequence = preset
      ? `Candidates will fall back to: ${describe(preset)}.`
      : `This exam exists only because it was added here, so it will be REMOVED from the ` +
        `Answer Key Checker entirely — candidates will no longer be able to pick it. ` +
        `Scores already recorded against it are kept.`;
    if (!confirm(`Clear the marking scheme for ${name}?\n\n${consequence}`)) return;
    setError("");
    setSaved("");
    try {
      await api.adminClearKeycheckScheme(row.exam);
      if (form.exam === row.exam) setForm(BLANK);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.label || "").toLowerCase().includes(q) || (r.exam || "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <>
      <header className="mb-xl">
        <div className="flex items-center gap-sm mb-xs text-on-surface-variant">
          <Icon name="rule" size={18} />
          <span className="font-label-md text-label-md uppercase tracking-wider">
            Answer Key Checker
          </span>
        </div>
        <h1 className="font-headline-lg text-headline-lg text-on-background mb-xs">
          Exam Marking Schemes
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant max-w-3xl">
          Set the marks per correct answer and the negative-marking penalty for any exam in the
          public Answer Key Checker — and add a paper the tool does not list yet, for a
          recruitment announced since it was last deployed. Either reaches candidates within a
          couple of minutes, with no deploy. A marking note printed on the candidate's own
          response sheet still wins, unless you tick <em>Override the sheet</em>.
        </p>
      </header>

      {error && (
        <div className="mb-lg p-md rounded-xl bg-error-container text-on-error-container font-body-md">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-lg p-md rounded-xl bg-secondary-container text-on-secondary-container font-body-md flex items-start gap-sm">
          <Icon name="check_circle" size={20} className="shrink-0 mt-0.5" />
          <span>{saved}</span>
        </div>
      )}

      {/* Editor */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden mb-xl">
        <div className="px-lg py-md border-b border-outline-variant bg-surface-bright flex flex-wrap items-center justify-between gap-sm">
          <h4 className="font-headline-sm text-headline-sm text-on-background flex items-center gap-sm">
            <Icon name={form.newExam ? "add_circle" : "edit_note"} size={20} />
            {form.newExam ? "Add an exam" : "Set a marking scheme"}
          </h4>
          {/* The escape hatch for a paper announced after the last deploy: there
              is no catalogue entry to select, so one is created here. */}
          <button
            onClick={form.newExam ? () => { setForm(BLANK); setError(""); } : startNewExam}
            className="px-md py-1.5 border border-outline-variant rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-xs"
          >
            <Icon name={form.newExam ? "arrow_back" : "add"} size={18} />
            {form.newExam ? "Pick an existing exam instead" : "Exam not listed? Add it"}
          </button>
        </div>

        <div className="px-lg py-md space-y-md">
          {form.newExam ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                    Exam name
                  </label>
                  <input
                    type="text"
                    value={form.label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Punjab Police Sub Inspector"
                    autoFocus
                    className={inputClass}
                  />
                  <p className="mt-xs font-body-sm text-body-sm text-secondary">
                    Exactly as candidates should see it in the dropdown.
                  </p>
                </div>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                    Conducting body / group
                  </label>
                  <input
                    type="text"
                    list="marking-groups"
                    value={form.group}
                    onChange={(e) => set("group", e.target.value)}
                    placeholder="e.g. Punjab"
                    className={inputClass}
                  />
                  {/* Existing group names offered, so a new Punjab paper files
                      itself with the other Punjab papers instead of starting a
                      near-duplicate heading beside it. */}
                  <datalist id="marking-groups">
                    {groupNames.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                  <p className="mt-xs font-body-sm text-body-sm text-secondary">
                    Which heading it sits under. Blank files it under “Recently added”.
                  </p>
                </div>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                  Exam ID
                </label>
                <input
                  type="text"
                  value={form.exam}
                  onChange={(e) => set("exam", e.target.value.toLowerCase())}
                  readOnly={isEditingExisting}
                  placeholder="punjab-police-si"
                  className={`${inputClass} font-data-mono ${
                    isEditingExisting ? "opacity-60 cursor-not-allowed" : ""
                  }`}
                />
                <p className="mt-xs font-body-sm text-body-sm text-secondary">
                  {isEditingExisting
                    ? "Fixed once saved — it is what every score already recorded for this exam is filed under."
                    : "Suggested from the name, and yours to change until you save. It is permanent " +
                      "afterwards: it is the key every score for this exam is filed under, so renaming " +
                      "it would orphan the ones already recorded."}
                </p>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                  Exam
                </label>
                {/* Grouped by conducting body, exactly as the public tool lists them,
                    so the exam picked here is unambiguously the one candidates pick.
                    examGroups() rather than the shipped catalogue, so exams added
                    here can be edited here too. */}
                <select value={form.exam} onChange={(e) => pickExam(e.target.value)} className={inputClass}>
                  <option value="">Select an exam…</option>
                  {examGroups().map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                          {byExam.has(o.value) ? " — override set" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selected && (
                  <p className="mt-xs font-body-sm text-body-sm text-secondary">
                    {selected.override
                      ? `Currently scored at ${describe(selected.override)} (set by ${
                          selected.override.updatedBy || "an admin"
                        }).`
                      : `No override yet. Built into the tool: ${describe(selected.preset)}.`}
                  </p>
                )}
              </div>
              {/* Each tier is stored separately, so correcting Tier-II never
                  touches Tier-I. Shown only where the exam actually has tiers. */}
              {papers.length > 0 && (
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                    Tier / Paper
                  </label>
                  <select
                    value={form.paper}
                    onChange={(e) => pickExam(form.exam, e.target.value)}
                    className={inputClass}
                  >
                    {papers.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                        {byExam.has(rowKey(form.exam, p.value)) ? " — override set" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-xs font-body-sm text-body-sm text-secondary">
                    Saved as <span className="font-data-mono">{stored}</span>. Each tier keeps its
                    own marks.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-md">
            <div>
              <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                Marks / Correct
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={form.correct}
                onChange={(e) => set("correct", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                Penalty / Wrong
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={form.wrong}
                onChange={(e) => set("wrong", e.target.value)}
                placeholder="0"
                className={inputClass}
              />
              <p className="mt-xs font-body-sm text-body-sm text-secondary">
                Positive number. 0 = no negative marking.
              </p>
            </div>
            <div>
              <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                Marks / Unattempted
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={form.skipped}
                onChange={(e) => set("skipped", e.target.value)}
                placeholder="0"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                Total Questions
              </label>
              <input
                type="number"
                min="1"
                max="500"
                value={form.total}
                onChange={(e) => set("total", e.target.value)}
                placeholder="from the sheet"
                className={inputClass}
              />
              <p className="mt-xs font-body-sm text-body-sm text-secondary">
                Optional — a parsed sheet counts its own.
              </p>
            </div>
          </div>

          {/* A notification says "one-third of a mark", not "0.3333" — these chips
              are the translation, so nobody has to do it by hand. */}
          <div className="flex flex-wrap items-center gap-xs">
            <span className="font-body-sm text-body-sm text-secondary mr-xs">Common penalties:</span>
            {PENALTY_PRESETS.map(([label, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => set("wrong", value)}
                className={`px-sm py-xs rounded-full border font-label-md text-label-md transition-colors ${
                  form.wrong === value
                    ? "border-primary bg-secondary-container text-on-secondary-container"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
              Note (internal)
            </label>
            <input
              type="text"
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="e.g. Clause 8 of the 12 Jul 2026 notification — 1 mark, no negative marking"
              className={inputClass}
            />
            <p className="mt-xs font-body-sm text-body-sm text-secondary">
              Where you confirmed this. Never shown to candidates — but it is what makes the next
              person able to check your work.
            </p>
          </div>

          <label className="flex items-start gap-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.enforced}
              onChange={(e) => set("enforced", e.target.checked)}
              className="mt-1"
            />
            <span className="font-body-md text-body-md text-on-surface">
              Override the sheet
              <span className="block font-body-sm text-body-sm text-secondary">
                Normally a marking note printed on the candidate's response sheet wins, because it
                is the paper in front of them. Tick this only when that note is wrong, unreadable,
                or the commission has revised the scheme since.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-sm pt-xs">
            <p className="font-body-sm text-body-sm text-secondary">
              Will be saved as: <strong className="text-on-background">{describe({
                correct: preview(form.correct) ?? 0,
                wrong: preview(form.wrong) ?? 0,
                skipped: preview(form.skipped) ?? 0,
                total: form.total,
              })}</strong>
            </p>
            <div className="flex gap-sm">
              <button
                onClick={() => { setForm(BLANK); setSaved(""); setError(""); }}
                className="px-md py-2 border border-outline-variant rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !form.exam}
                className="px-lg py-2 bg-primary-container text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save marking scheme"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* What is currently overridden */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
        <div className="px-lg py-md border-b border-outline-variant bg-surface-bright flex flex-wrap gap-sm justify-between items-center">
          <div>
            <h4 className="font-headline-sm text-headline-sm text-on-background">
              Marking set here ({rows.length})
            </h4>
            <p className="font-body-sm text-body-sm text-secondary mt-xs">
              Exams whose marks come from this screen rather than from the pattern built into the
              tool. Those tagged <em>added exam</em> exist only because they were created here.
            </p>
          </div>
          {rows.length > 0 && (
            <div className="relative">
              <Icon name="search" size={18} className="absolute left-sm top-1/2 -translate-y-1/2 text-outline" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search exam"
                className="bg-surface border border-outline-variant rounded-lg pl-xl pr-sm py-1.5 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
          )}
        </div>

        {loading ? (
          <Loading />
        ) : shown.length === 0 ? (
          <p className="px-lg py-md font-body-sm text-body-sm text-secondary">
            {rows.length
              ? "No exam matches that search."
              : `Nothing set here yet. All ${EXAM_OPTIONS.length} exams in the checker are scored ` +
                "by the pattern built into the tool, or by the marking note on the candidate's own sheet."}
          </p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {shown.map((r) => (
              <li key={r.exam} className="px-lg py-md flex flex-col sm:flex-row sm:items-center gap-md">
                <div className="flex-1 min-w-0">
                  <p className="font-body-md text-body-md text-on-background font-medium">
                    {r.label || examLabel(rowIdentity(r).exam)}
                    {rowIdentity(r).tier && (
                      <span className="ml-sm font-label-md text-label-md px-sm py-xs rounded-full border border-outline-variant text-on-surface-variant align-middle">
                        {rowIdentity(r).tier}
                      </span>
                    )}
                    {/* No built-in pattern means this exam is not in the shipped
                        catalogue — it was added here, and clearing its row takes
                        it out of the tool rather than falling it back. */}
                    {!rowIdentity(r).preset && (
                      <span className="ml-sm font-label-md text-label-md px-sm py-xs rounded-full bg-secondary-container text-on-secondary-container align-middle">
                        added exam
                      </span>
                    )}
                    {r.enforced && (
                      <span className="ml-sm font-label-md text-label-md px-sm py-xs rounded-full bg-primary text-on-primary align-middle">
                        overrides the sheet
                      </span>
                    )}
                  </p>
                  <p className="font-body-sm text-body-sm text-secondary">{describe(r)}</p>
                  {r.note && (
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs">{r.note}</p>
                  )}
                  <p className="font-body-sm text-body-sm text-secondary mt-xs">
                    {[
                      r.updatedBy && `set by ${r.updatedBy}`,
                      r.updatedAt && new Date(r.updatedAt).toLocaleString("en-IN"),
                      r.exam,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-xs shrink-0">
                  <button
                    onClick={() => edit(r)}
                    className="px-md py-1.5 border border-outline-variant rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => clear(r)}
                    title="Clear this override"
                    className="px-md py-1.5 border border-[#f87171] text-error rounded-lg font-label-md text-label-md hover:bg-error-container transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
