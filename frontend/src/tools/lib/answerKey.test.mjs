// Regression check for parseAnnotatedSheet across the three layouts it now has
// to cover. Pure function, no PDF needed — the input is what readPdfLines emits.
import {
  EXAM_OPTIONS,
  defaultPaper,
  papersForExam,
  sheetContentsForExam,
  builtInSchemeForExam,
  examGroups,
  examLabel,
  isAddedExam,
  isExamSlug,
  looksLikeAnswerList,
  parseAnnotatedSheet,
  parseAnswerKeyPaper,
  parseAnswerList,
  parseMarksValue,
  slugifyExam,
  schemeForExam,
  schemeIsEnforced,
  schemeSource,
  scoreAll,
  setSchemeOverrides,
} from "./answerKey.js";

let failures = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`);
};

// A line as readPdfLines produces it. `green` marks the official answer.
const L = (text, { green = false, marks = [], x = 100 } = {}) => ({
  text,
  runs: [{ x, str: text, colour: green ? "green" : "plain" }],
  marks,
});

// The header every one of these sheets carries — note the numbered notes, which
// look exactly like option rows.
const header = () => [
  L("Test Date 19/02/2026"),
  L("Test Time 9:00 AM - 10:30 AM"),
  L("Correct Answer will carry 2 marks per Question."),
  L("Incorrect Answer will carry 0.5 Negative mark per Question."),
  L("1. Options shown in green color with a tick icon are correct."),
  L("2. Chosen option on the right of the question indicates the option selected by the candidate."),
  L("Section : General Awareness"),
];

// One question: heading, four options, and optionally the candidate's own pick.
const question = (n, rightOpt, chosen) => [
  L(`Q.${n} Question number ${n} text goes here?`),
  ...[1, 2, 3, 4].map((o) => L(`${o}. Option ${o}`, { green: o === rightOpt })),
  ...(chosen === undefined ? [] : [L(`Chosen Option : ${chosen}`)]),
];

console.log("personalised response sheet (responses + key):");
{
  const lines = [...header(), ...question(1, 3, 3), ...question(2, 1, 4), ...question(3, 2, "--")];
  const r = parseAnnotatedSheet(lines);
  check("responses", [...r.responses], [[1, "C"], [2, "D"], [3, ""]]);
  check("key", [...r.key], [[1, "C"], [2, "A"], [3, "B"]]);
  check("labels", r.labels, { 1: "1", 2: "2", 3: "3" });
  check("sections", r.sections, { 1: "General Awareness", 2: "General Awareness", 3: "General Awareness" });
  check("scheme", r.scheme, { correct: 2, wrong: 0.5, total: 3 });
  check("meta", r.meta, { testDate: "19/02/2026", testTime: "9:00 AM - 10:30 AM" });
}

console.log("published answer key (key only, no Chosen Option rows):");
{
  const lines = [...header(), ...question(1, 3), ...question(2, 1), ...question(3, 2)];
  const r = parseAnnotatedSheet(lines);
  // Empty responses is the signal that this file holds a key and nothing else.
  check("responses stay empty", [...r.responses], []);
  check("key", [...r.key], [[1, "C"], [2, "A"], [3, "B"]]);
  check("no phantom leading question", r.scheme.total, 3);
  check("labels aligned", r.labels, { 1: "1", 2: "2", 3: "3" });
}

console.log("mixed: one block loses its Chosen Option row:");
{
  const lines = [...header(), ...question(1, 3, 3), ...question(2, 1), ...question(3, 2, 2)];
  const r = parseAnnotatedSheet(lines);
  check("later answers stay aligned", [...r.responses], [[1, "C"], [3, "B"]]);
  check("key complete", [...r.key], [[1, "C"], [2, "A"], [3, "B"]]);
}

console.log("question paper with the key printed under it:");
{
  const lines = [
    L("SSC CGL Previous Year Paper"),
    L("Q1. In the following question, select the related word."),
    L("A) Energy B) Temperature"),
    L("C) Pressure D) Force"),
    L("Correct Answer: C"),
    L("Q2. Mekong : Tibet :: Amazon : ?"),
    L("A) Chile B) Peru"),
    L("Correct Answer: B"),
    L("Q3. Odd one out"),
    L("Correct Answer: A,C"),
  ];
  const r = parseAnswerKeyPaper(lines);
  check("key", [...r.key], [[1, "C"], [2, "B"], [3, "A,C"]]);
  check("total", r.total, 3);
  check("no labels needed when printed numbers are unique", r.labels, {});
}

console.log("two papers in one file restart the numbering:");
{
  const lines = [
    L("Q1. first paper"), L("Correct Answer: A"),
    L("Q2. first paper"), L("Correct Answer: B"),
    L("Q1. qualifying paper"), L("Correct Answer: C"),
  ];
  const r = parseAnswerKeyPaper(lines);
  check("keyed by position", [...r.key], [[1, "A"], [2, "B"], [3, "C"]]);
  check("printed numbers reported as labels", r.labels, { 1: "1", 2: "2", 3: "1" });
}

console.log("a sentence that merely mentions an answer is not a key line:");
{
  const lines = [
    L("Q1. something"),
    L("The correct answer depends on A being true."),
    L("Correct Answer: D"),
  ];
  check("key", [...parseAnswerKeyPaper(lines).key], [[1, "D"]]);
}

console.log("junk guard on the last-ditch list reader:");
{
  const junk = parseAnswerList(
    ["12 Noida, 201301", "1 A", "2 A", "4 The findings of this investigation", "100 and 250 are divisible"].join("\n"),
  );
  check("rejects a question paper read as a list", looksLikeAnswerList(junk), false);
  const real = parseAnswerList(["1 A", "2 B", "3 -", "4 C", "5 D", "6 A"].join("\n"));
  check("accepts a genuine answer list", looksLikeAnswerList(real), true);
  check("accepts a run with dropped questions", looksLikeAnswerList(parseAnswerList("1 A\n2 *\n3 B\n4 C\n5 D")), true);
  check("rejects too short to judge", looksLikeAnswerList(parseAnswerList("1 A\n2 B")), false);
}

console.log("marking: a sheet that prints no marking note states no marks:");
{
  // The Punjab Police sheet's header carries the paper's name, date and shift
  // but no "Correct Answer will carry N marks" line at all — so nothing may be
  // inferred from it, and the exam's own scheme has to stand. Anything else here
  // would be a guessed penalty applied to a real score.
  const lines = [
    L("Exam Name Punjab Police Constables in District and Armed Cadre"),
    L("Test Date 12/07/2026"),
    L("Test Time 9:00 AM - 12:00 PM"),
    L("Section : General Awareness"),
    ...question(1, 3, 3),
    ...question(2, 1, 1),
  ];
  const r = parseAnnotatedSheet(lines);
  check("no marks claimed", { correct: r.scheme.correct, wrong: r.scheme.wrong }, {});
  check("question count still read", r.scheme.total, 2);
  check("responses and key still read", [[...r.responses], [...r.key]], [
    [[1, "C"], [2, "A"]],
    [[1, "C"], [2, "A"]],
  ]);
}

console.log("marking: a paper with no negative marking is not penalised:");
{
  // The bug this guards. Punjab Police Constable is +1 with no negative marking
  // and its sheet prints no marking note, so before it was catalogued the tool
  // scored it by whatever preset was selected — SSC's +2 / −0.5 by default.
  // 150 questions at +1 with nothing deducted, per the marking table.
  check("pinned to the no-penalty pattern", schemeForExam("punjab-police-constable"), {
    correct: 1,
    wrong: 0,
    skipped: 0,
    total: 150,
  });

  // Two right, two wrong.
  const responses = new Map([[1, "A"], [2, "A"], [3, "B"], [4, "C"]]);
  const key = new Map([[1, "A"], [2, "A"], [3, "A"], [4, "A"]]);
  const marked = (exam) =>
    scoreAll({ responses, key, scheme: schemeForExam(exam), total: 4 }).score;

  check("two right at +1, nothing deducted", marked("punjab-police-constable"), 2);
  // What the tool did before this exam was catalogued: every mark doubled and a
  // penalty applied that the paper does not have. Kept as a test because the
  // wrong number is plausible on its own — it is only wrong next to the right one.
  check("SSC marking would have reported 3", marked("ssc-cgl"), 3);
  check("marks out of the questions keyed", scoreAll({
    responses, key, scheme: schemeForExam("punjab-police-constable"), total: 4,
  }).maxScore, 4);
}

console.log("marking: admin overrides beat the built-in presets:");
{
  check("no overrides to start with", schemeSource("ssc-cgl"), "preset");

  const loaded = setSchemeOverrides({
    "ssc-cgl": { correct: 3, wrong: 1, skipped: 0, total: 120, enforced: true },
    // Dropped: a scheme awarding nothing for a correct answer would zero every
    // score, so the exam falls back to its preset instead.
    "ssc-chsl": { correct: 0, wrong: 1 },
    // Dropped: not a number at all.
    "rrb-ntpc": { correct: "n/a", wrong: 1 },
    // A penalty stored as a negative number is still a penalty of that size.
    "rrb-alp": { correct: 1, wrong: -0.25 },
  });
  check("only the usable rows are registered", loaded, 2);
  check("override applied", schemeForExam("ssc-cgl"), {
    correct: 3,
    wrong: 1,
    skipped: 0,
    total: 120,
  });
  check("source reported as admin", schemeSource("ssc-cgl"), "admin");
  check("enforced flag is not part of the marks", schemeIsEnforced("ssc-cgl"), true);
  check("built-in preset still readable", builtInSchemeForExam("ssc-cgl"), {
    correct: 2,
    wrong: 0.5,
    skipped: 0,
    total: 100,
  });
  check("a rejected row falls back to its preset", schemeForExam("ssc-chsl"), {
    correct: 2,
    wrong: 0.5,
    skipped: 0,
    total: 100,
  });
  check("a non-numeric row falls back too", schemeForExam("rrb-ntpc"), {
    correct: 1,
    wrong: 0.33,
    skipped: 0,
    total: 100,
  });
  check("penalties are stored as a magnitude", schemeForExam("rrb-alp").wrong, 0.25);
  check("unenforced by default", schemeIsEnforced("rrb-alp"), false);
  // An override that only corrects the marks must not blank the question count:
  // scoreAll takes the largest count it is given, so a total of 0 would shrink
  // the denominator of any hand-typed paper.
  // RRB ALP with no paper named resolves to its first, CBT-1, which is 75
  // questions — so that is the count an override without one inherits.
  check("the shipped question count survives", schemeForExam("rrb-alp").total, 75);

  // An empty payload (the fetch failed, or nothing is overridden) restores the
  // shipped behaviour rather than leaving the last load in place.
  setSchemeOverrides({});
  check("cleared", schemeSource("ssc-cgl"), "preset");
  check("an unknown exam pins nothing", schemeSource("not-an-exam"), null);
}

console.log("tiers are separate papers with their own marking:");
{
  check("SSC CGL offers both tiers", papersForExam("ssc-cgl").map((p) => p.label), [
    "Tier-I", "Tier-II (Paper-I)",
  ]);
  check("first tier is the default", defaultPaper("ssc-cgl"), "tier-1");
  check("Tier-I", schemeForExam("ssc-cgl", "tier-1"), { correct: 2, wrong: 0.5, skipped: 0, total: 100 });
  // The bug a single entry per exam caused: every Tier-II candidate scored as
  // though they had sat Tier-I, at +2/-0.5 over 100 instead of +3/-1 over 150.
  check("Tier-II", schemeForExam("ssc-cgl", "tier-2"), { correct: 3, wrong: 1, skipped: 0, total: 150 });
  check("no paper named falls back to the first", schemeForExam("ssc-cgl"), schemeForExam("ssc-cgl", "tier-1"));
  // A stale selection must not un-mark a paper that does have a scheme.
  check("an unknown tier falls back too", schemeForExam("ssc-cgl", "tier-9"), schemeForExam("ssc-cgl", "tier-1"));
  check("a single-paper exam asks nothing", papersForExam("dsssb-prt"), []);

  // DSSSB was pinned to nothing at all, which is what scored a DSSSB PRT sheet
  // by whichever preset the dropdown was showing.
  check("DSSSB PRT", schemeForExam("dsssb-prt"), { correct: 1, wrong: 0.25, skipped: 0, total: 200 });
  check("MP has no negative marking", schemeForExam("mpesb-police-constable").wrong, 0);
  check("RRB NTPC CBT-2 counts 120", schemeForExam("rrb-ntpc", "cbt-2").total, 120);

  // An override may pin one tier without touching the other.
  setSchemeOverrides({ "ssc-cgl#tier-2": { correct: 4, wrong: 2, total: 150 } });
  check("the pinned tier changes", schemeForExam("ssc-cgl", "tier-2").correct, 4);
  check("the other tier does not", schemeForExam("ssc-cgl", "tier-1").correct, 2);
  check("source is per tier", [schemeSource("ssc-cgl", "tier-2"), schemeSource("ssc-cgl", "tier-1")], ["admin", "preset"]);
  check("a per-tier row invents no exam", isAddedExam("ssc-cgl"), false);
  setSchemeOverrides({});
}

console.log("what an exam's sheet contains:");
{
  check("most sheets carry both", sheetContentsForExam("dsssb-prt"), { choosesOption: true, answerMarked: true });
  // These two publish the candidate's answers without the key, so the candidate
  // has to be told they will still need to paste it in.
  check("UGC NET omits the key", sheetContentsForExam("ugc-net"), { choosesOption: true, answerMarked: false });
  check("BSNL SET omits the key", sheetContentsForExam("bsnl-set").answerMarked, false);
  check("an uncatalogued exam says nothing", sheetContentsForExam("not-an-exam"), null);
}

console.log("the source table's own figures are kept verbatim:");
{
  /* Four rows state a total-marks figure that is not `correct x questions`, and
     both numbers are stored exactly as the source table gives them — confirmed
     deliberate. Scoring builds from the marks per correct answer, so a candidate
     checking one of these sees a maximum of 150 (or 100). Asserted so a future
     edit cannot quietly "tidy" the marks up to make the arithmetic close. */
  check("Rajasthan CET Graduate", schemeForExam("rsmssb-cet-graduate"), {
    correct: 1, wrong: 0, skipped: 0, total: 150,
  });
  check("Rajasthan CET 12th", schemeForExam("rsmssb-cet-12th").correct, 1);
  check("Rajasthan Informatics Assistant", schemeForExam("rsmssb-informatics-assistant").total, 150);
  check("ESIC MTS", schemeForExam("esic-mts"), {
    correct: 1, wrong: 0.25, skipped: 0, total: 100,
  });
}

console.log("a published answer key with sections restarting at Q.1 (DSSSB):");
{
  // The sheet DSSSB hands out: no marking note, no "Chosen Option" rows, and
  // every section numbered from 1 again.
  const q = (n, right) => [
    L(`Q.${n} Question ${n}?`),
    ...[1, 2, 3, 4].map((o) => L(`${o}. Option ${o}`, { green: o === right })),
  ];
  const r = parseAnnotatedSheet([
    L("Participant ID 258021201000276"),
    L("Test Date 16/02/2026"),
    L("Subject Assistant Teacher Primary"),
    L("Section : General Intelligence and Reasoning Ability"),
    ...q(1, 4), ...q(2, 3), ...q(3, 2),
    L("Section : General Awareness"),
    ...q(1, 4), ...q(2, 3),
  ]);
  check("no responses to read", [...r.responses], []);
  check("the key reads through, keyed by position", [...r.key], [
    [1, "D"], [2, "C"], [3, "B"], [4, "D"], [5, "C"],
  ]);
  check("printed numbers kept as labels", r.labels, { 1: "1", 2: "2", 3: "3", 4: "1", 5: "2" });
  /* The section boundary. Each block stays open until the *next* heading closes
     it, so without closing on the heading itself the last question of every
     section was filed under the following one — Q.3 here read as General
     Awareness, and both sections' tallies were wrong at each end. */
  check("sections do not bleed across the heading", r.sections, {
    1: "General Intelligence and Reasoning Ability",
    2: "General Intelligence and Reasoning Ability",
    3: "General Intelligence and Reasoning Ability",
    4: "General Awareness",
    5: "General Awareness",
  });
  check("no marks claimed by a sheet that prints none", { c: r.scheme.correct, w: r.scheme.wrong }, {});
  check("question count still read", r.scheme.total, 5);
}

console.log("exams an admin added after the bundle was built:");
{
  const shipped = examGroups().length;
  const registered = setSchemeOverrides({
    // Filed under a group that already exists — joins the Punjab papers.
    "punjab-jail-warder": {
      correct: 1, wrong: 0, label: "Punjab Jail Warder", group: "Punjab",
    },
    // A group of its own.
    "xyzsb-clerk": { correct: 2, wrong: 0.5, label: "XYZSB Clerk", group: "XYZ board" },
    // No label: the marks still apply, but a bare slug is not worth showing in a
    // dropdown, so it stays out of the exam list.
    "unnamed-paper": { correct: 1, wrong: 0 },
    // Not a usable slug — dropped outright, since it would be a permanent key.
    "Not A Slug": { correct: 1, wrong: 0, label: "Nope" },
  });
  check("usable rows registered", registered, 3);

  const groups = examGroups();
  const punjab = groups.find((g) => g.group === "Punjab");
  check("joins an existing group", punjab.options.map((o) => o.value), [
    "punjab-police-constable", "punjab-police-si", "punjab-jail-warder",
  ]);
  check("a new group is appended", groups.length, shipped + 1);
  check("its own group holds it", groups.at(-1).options.map((o) => o.label), ["XYZSB Clerk"]);
  check("named added exam is listed", isAddedExam("punjab-jail-warder"), true);
  check("unnamed one is not", isAddedExam("unnamed-paper"), false);
  check("but its marks still apply", schemeForExam("unnamed-paper"), {
    correct: 1, wrong: 0, skipped: 0, total: 0,
  });
  check("label resolves for an added exam", examLabel("punjab-jail-warder"), "Punjab Jail Warder");
  check("added exam scores by its row", schemeForExam("xyzsb-clerk"), {
    correct: 2, wrong: 0.5, skipped: 0, total: 0,
  });
  // Nothing shipped for it, so clearing the row would remove the exam entirely —
  // which is what the admin console warns about.
  check("no preset behind an added exam", builtInSchemeForExam("punjab-jail-warder"), null);
  check("a shipped exam is never 'added'", isAddedExam("ssc-cgl"), false);
  // A row keyed on a catalogue slug overrides that exam's marks — it must never
  // append a second copy of it to the dropdown.
  check(
    "no duplicate entry for a catalogue exam",
    examGroups().flatMap((g) => g.options).filter((o) => o.value === "punjab-police-si").length,
    1,
  );

  setSchemeOverrides({});
  check("cleared back to the shipped catalogue", examGroups().length, shipped);
  check("and the added exam is gone", isAddedExam("punjab-jail-warder"), false);
}

console.log("exam slugs:");
{
  check("every shipped slug is valid", EXAM_OPTIONS.filter((o) => !isExamSlug(o.value)).length, 0);
  check("from a name", slugifyExam("Punjab Police SI (2026) — Paper I"), "punjab-police-si-2026-paper-i");
  check("trailing punctuation trimmed", slugifyExam("SSC CGL!!"), "ssc-cgl");
  check("rejects spaces", isExamSlug("punjab police"), false);
  check("rejects capitals", isExamSlug("Punjab"), false);
  check("rejects a leading hyphen", isExamSlug("-punjab"), false);
  check("rejects a single character", isExamSlug("a"), false);
  check("rejects over 64 characters", isExamSlug("a".repeat(65)), false);
  check("accepts digits", isExamSlug("mpesb-group-2-sub-4"), true);
}

console.log("marking: a penalty typed as a fraction:");
{
  check("1/3", parseMarksValue("1/3"), 0.3333);
  check("2/3", parseMarksValue("2/3"), 0.6667);
  check("plain decimal", parseMarksValue("0.5"), 0.5);
  // A deduction for an unattempted question is signed, and "-1/3" is how it gets
  // typed. The backend accepts it, so this reader has to as well — otherwise the
  // admin console rejects what the API would have stored.
  check("signed fraction", parseMarksValue("-1/3"), -0.3333);
  check("nonsense", parseMarksValue("abc"), null);
  check("empty", parseMarksValue(""), null);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
