// Regression check for parseAnnotatedSheet across the three layouts it now has
// to cover. Pure function, no PDF needed — the input is what readPdfLines emits.
import {
  parseAnnotatedSheet,
  parseAnswerKeyPaper,
  looksLikeAnswerList,
  parseAnswerList,
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

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
