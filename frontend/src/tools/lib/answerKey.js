// Answer Key Checker — pure parsing and scoring. No React, no DOM writes.
//
// Accepted response formats
//   1. Saved response-sheet HTML (NTA-style "Question ID" / "Chosen Option"
//      tables, or a flat Q.No / Chosen Option grid).
//   2. Plain text / CSV: "1 B" per line, "1,B", or one run "BCAD-".

// EDIT ME: default marking scheme per exam. `null` leaves the inputs alone.
//
// These are starting points only: an uploaded response sheet usually states its
// own scheme in the header note, and that overrides whatever is picked here (see
// parseMarkingNote). Every field stays editable either way.
export const SCHEMES = {
  ssc:      { correct: 2, wrong: 0.5,  skipped: 0, total: 100 },
  railway:  { correct: 1, wrong: 0.33, skipped: 0, total: 100 },
  state:    { correct: 1, wrong: 0.33, skipped: 0, total: 100 },
  defence:  { correct: 1, wrong: 0.33, skipped: 0, total: 100 },
  teaching: { correct: 1, wrong: 0,    skipped: 0, total: 150 },
  upsc:     { correct: 2, wrong: 0.66, skipped: 0, total: 100 },
  jee:      { correct: 4, wrong: 1,    skipped: 0, total: 75 },
  neet:     { correct: 4, wrong: 1,    skipped: 0, total: 180 },
  custom:   null,
};

export const EXAM_OPTIONS = [
  { value: "ssc", label: "SSC (CGL / CHSL / MTS / GD)" },
  { value: "railway", label: "Railway (RRB NTPC / Group D / ALP)" },
  { value: "state", label: "State commission (OSSSC / PSC / Police)" },
  { value: "defence", label: "Defence (CDS / AFCAT / Agniveer)" },
  { value: "teaching", label: "Teaching (CTET / KVS / State TET)" },
  { value: "upsc", label: "Civil Services (UPSC Prelims)" },
  { value: "jee", label: "Engineering (JEE Main)" },
  { value: "neet", label: "Medical (NEET)" },
  { value: "custom", label: "Custom marking scheme" },
];

const NO_ANSWER = /^(-{1,2}|na|n\/a|not answered|not attempted|—|\.)$/i;

// Normalise one answer cell to "A".."E", "*" (dropped) or "" (unattempted).
export function normalizeAnswer(raw) {
  const v = String(raw ?? "").trim();
  if (!v || NO_ANSWER.test(v)) return "";
  if (v === "*") return "*";
  const letters = v.toUpperCase().match(/\b[A-E]\b/g);
  if (letters) return [...new Set(letters)].sort().join(",");
  const num = v.match(/^([1-5])$/); // numeric option: 1..5 -> A..E
  if (num) return "ABCDE"[+num[1] - 1];
  return v.toUpperCase(); // numeric-value question (JEE integer type)
}

// "1 B" / "1. B" / "1,B" / "1) A,C" per line, OR one continuous run "BCAD-".
export function parseAnswerList(text) {
  const out = new Map();
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let numbered = 0;
  for (const line of lines) {
    const m = line.match(/^(\d+)\s*[).:,\-\s]\s*(.*)$/);
    if (m) {
      numbered++;
      out.set(+m[1], normalizeAnswer(m[2]));
    }
  }
  if (numbered) return out;

  // No question numbers — every answer token in order becomes Q1, Q2, …
  const tokens = lines.join(" ").match(/[A-Ea-e]|[-*]|\d+(?:\.\d+)?/g) || [];
  tokens.forEach((tok, i) => out.set(i + 1, normalizeAnswer(tok)));
  return out;
}

// NTA-style saved HTML: one small label/value table per question, with
// "Section : Physics" headings in between.
export function parseResponseSheetHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  const SECTION_RE = /^(?:Section|Subject)\s*[:\-]?\s*(.{2,40})$/i;

  const responses = new Map();
  const sections = {};
  let qno = 0;
  let currentSection = "";

  // One walk in document order, so each question picks up the heading that
  // actually precedes it.
  for (const el of doc.querySelectorAll("*")) {
    if (el.tagName !== "TABLE") {
      // Leaf nodes only — a wrapper would repeat its child's text.
      if (el.children.length === 0) {
        const sec = text(el).match(SECTION_RE);
        if (sec) currentSection = sec[1].trim();
      }
      continue;
    }

    const pairs = new Map(); // label -> value for this question block
    const optionIds = new Map(); // "Option N ID" value -> letter

    for (const tr of el.querySelectorAll("tr")) {
      const cells = [...tr.children].map(text);
      if (cells.length < 2) continue;
      const label = cells[0].replace(/\s*:\s*$/, "");
      const value = cells[1];
      const opt = label.match(/^Option\s*(\d)\s*ID$/i);
      if (opt) optionIds.set(value, "ABCDE"[+opt[1] - 1]);
      pairs.set(label.toLowerCase(), value);
    }

    const chosen =
      pairs.get("chosen option") ?? pairs.get("candidate answer") ?? pairs.get("your answer");
    if (chosen === undefined) continue;

    qno++;
    // "Chosen Option" is either the option number (1-4) or the option ID.
    responses.set(qno, optionIds.get(chosen.trim()) ?? normalizeAnswer(chosen));
    if (currentSection) sections[qno] = currentSection;
  }

  // Fallback: a flat "Q.No | Chosen Option" grid instead of per-question blocks.
  if (!responses.size) {
    for (const table of doc.querySelectorAll("table")) {
      const rows = [...table.querySelectorAll("tr")];
      if (rows.length < 2) continue;
      const head = [...rows[0].children].map((c) => text(c).toLowerCase());
      const qCol = head.findIndex((h) => /q\.?\s*(no|id)|question/.test(h));
      const aCol = head.findIndex((h) => /chosen|answer|response|option/.test(h));
      if (qCol === -1 || aCol === -1) continue;
      for (const tr of rows.slice(1)) {
        const cells = [...tr.children].map(text);
        const n = parseInt(cells[qCol], 10);
        if (Number.isFinite(n)) responses.set(n, normalizeAnswer(cells[aCol]));
      }
      if (responses.size) break;
    }
  }

  return { responses, sections };
}

// An option row: "1. 2026", a bare "1." when the option is an image, and on the
// minority of sheets that print the marks as text rather than as an image, a
// leading ✔/✘. A ✘ needs no handling of its own — it flags the candidate's own
// wrong pick, which the "Chosen Option" row already states.
const OPTION_ROW = /^\s*[✔✓☑✘✗✕✖]?\s*([1-9])\s*[.)]/;
const TICK = /[✔✓☑]/;

/* -------------------------------------------------------------------------- *
 * PDF
 *
 * The file candidates actually download from SSC / RRB / state-commission
 * portals (digialm / TCS iON) is the *annotated* response sheet: every option
 * is printed, the official answer is green with a ✔, the candidate's wrong pick
 * red with a ✘, and a side table per question ends in "Chosen Option : N".
 * A header note states the marking scheme, and "Section : <name>" headings
 * separate the subjects.
 *
 * So the whole thing — responses, official key, marking scheme, sections — is
 * in the file, and the candidate should not have to retype any of it.
 *
 * The catch: the ✔/✘ are images, absent from the text layer. What survives is
 * the *colour* of the option text, which is why extraction below reads fill
 * colours alongside the text instead of using getTextContent() on its own.
 *
 * Nothing that identifies the candidate (roll number, name, test centre,
 * photographs) is read out of the file — only answers, sections and the paper's
 * own date/time.
 *
 * pdf.js is loaded on demand — it is ~1MB, and the portal must not pay for it.
 * -------------------------------------------------------------------------- */

// Classify a fill colour rather than matching the exact hexes one portal
// happens to use, so a sheet drawn in a different shade still reads correctly.
export function colourClass(rgb) {
  if (!rgb) return "plain";
  const [r, g, b] = rgb;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 60) return "plain"; // grey body text
  if (g > r && g - Math.max(r, b) > 40) return "green";
  if (r > g && r - Math.max(g, b) > 40) return "red";
  return "plain";
}

// pdf.js hands setFillRGBColor either a "#rrggbb" string (current) or three
// 0-255 components (older builds).
function toRgb(args) {
  const first = args?.[0];
  if (typeof first === "string") {
    const m = first.match(/^#?([0-9a-f]{6})$/i);
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
  }
  if (args?.length >= 3 && args.slice(0, 3).every((n) => typeof n === "number")) {
    const max = Math.max(...args.slice(0, 3));
    return args.slice(0, 3).map((n) => Math.round(max <= 1 ? n * 255 : n));
  }
  return null;
}

// 3x2 PDF matrix product, for tracking where an image is actually painted.
const compose = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

// A ✔/✘ is drawn about this far below the baseline of the option it belongs to.
// Big enough to match it to its own row, small enough not to reach the next one
// (option rows are 16pt+ apart) or an inline formula image (14pt+ away).
const MARK_NEAR = 6;
// Marks are icons a few points wide. Anything wider is a logo, a watermark or an
// inline equation, and is dropped before it can be mistaken for one.
const MARK_MAX_WIDTH = 40;

// Everything the operator list can tell us about a page, in one walk:
//
//  1. colours — which colour class each font resource is drawn in. Text items
//     carry a fontName but no colour; the operator list carries colours but no
//     laid-out text. These sheets give each colour its own font resource, so the
//     font stands in for the colour. A font used in more than one colour is
//     "mixed" and treated as no signal, which costs us that signal rather than
//     inventing a wrong answer from it.
//  2. marks — where each ✔/✘ image sits. Independent of colour entirely, so the
//     key is still readable on a sheet whose green shares a font with body text.
function pageMarkup(opList, OPS) {
  const tally = new Map();
  const marks = [];
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let colour = "plain";
  let font = null;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === OPS.setFillRGBColor) colour = colourClass(toRgb(args));
    else if (fn === OPS.setFillGray || fn === OPS.setFillCMYKColor) colour = "plain";
    else if (fn === OPS.setFont) font = args[0];
    else if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = compose(ctm, args);
    else if (fn === OPS.paintImageXObject) {
      // Only named XObjects: the name is what tells ✔ apart from ✘. Inline
      // images and masks carry no id, so they cannot be told apart and are
      // skipped — the colour signal still covers those sheets.
      if (typeof args[0] === "string" && Math.abs(ctm[0]) <= MARK_MAX_WIDTH) {
        marks.push({ name: args[0], y: ctm[5] });
      }
    } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      const glyphs = (args[0] || []).filter((gl) => gl?.unicode?.trim());
      if (!font || !glyphs.length) continue;
      const seen = tally.get(font) ?? new Map();
      seen.set(colour, (seen.get(colour) ?? 0) + glyphs.length);
      tally.set(font, seen);
    }
  }

  const colours = new Map();
  for (const [name, seen] of tally) {
    colours.set(name, seen.size === 1 ? [...seen.keys()][0] : "mixed");
  }
  return { colours, marks };
}

// Group a page's text items into visual lines, keeping each run's x position and
// colour, plus the names of any ✔/✘ images sitting on the row. Lines come back
// top-down, runs left-to-right, so a "Label : value" pair reads as one string
// the way it looks on the page.
function pageLines(content, { colours, marks }) {
  const rows = [];
  for (const item of content.items) {
    if (!item.str?.trim()) continue;
    const y = item.transform[5];
    // Within ~2pt is the same visual line; rounding to whole points would split
    // a row whose parts sit a fraction apart.
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) rows.push((row = { y, runs: [], marks: [] }));
    row.runs.push({
      x: item.transform[4],
      str: item.str,
      colour: colours.get(item.fontName) ?? "plain",
    });
  }

  for (const mark of marks) {
    let row = null;
    let nearest = MARK_NEAR;
    for (const candidate of rows) {
      const gap = Math.abs(candidate.y - mark.y);
      if (gap <= nearest) {
        row = candidate;
        nearest = gap;
      }
    }
    if (row) row.marks.push(mark.name);
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map(({ runs, marks: rowMarks }) => {
      runs.sort((a, b) => a.x - b.x);
      return {
        runs,
        marks: rowMarks,
        text: runs.map((r) => r.str).join(" ").replace(/\s+/g, " ").trim(),
      };
    })
    .filter((row) => row.text);
}

// Text, colour and answer marks for every line of a PDF, in reading order.
// `onProgress(page, pages)` is called as each page is read — these sheets run to
// 60 pages, which is slow enough that the caller should be able to say so.
export async function readPdfLines(file, onProgress) {
  const pdfjs = await import("pdfjs-dist");
  // Vite resolves this to a bundled asset URL at build time.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;

  // Keep the loading task: teardown lives on it, not on the document proxy.
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const lines = [];
  try {
    const doc = await task.promise;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const markup = pageMarkup(await page.getOperatorList(), pdfjs.OPS);
      lines.push(...pageLines(await page.getTextContent(), markup));
      onProgress?.(p, doc.numPages);
    }
  } finally {
    await task.destroy();
  }
  return lines;
}

// "0.33" or "1/3" as a number — sheets word the penalty either way. Fractions
// are rounded to 4dp so the marks input shows 0.3333 rather than 17 digits; the
// difference over a 100-question paper is far below a printed mark.
function marksValue(raw) {
  const v = String(raw).trim();
  const frac = v.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Math.round((+frac[1] / +frac[2]) * 10000) / 10000;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const NUM = "(\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+)?)";

// The marking scheme as stated on the sheet itself, e.g.
//   "Correct Answer will carry 1 mark per Question."
//   "Incorrect Answer will carry 0.33 Negative mark per Question."
// Only the parts actually found are returned; the caller keeps its own defaults
// for the rest.
export function parseMarkingNote(text) {
  const found = {};
  // \b matters: without it "correct" also matches inside "Incorrect Answer will
  // carry 0.33 …", and a sheet that states the penalty first would be read as
  // awarding 0.33 per correct answer.
  const correct = text.match(new RegExp(`\\bcorrect\\s+answers?[^.\\n]*?${NUM}\\s*marks?`, "i"));
  const wrong =
    text.match(new RegExp(`(?:incorrect|wrong)\\s+answers?[^.\\n]*?${NUM}\\s*(?:negative\\s*)?marks?`, "i")) ||
    text.match(new RegExp(`negative\\s+mark(?:ing)?[^.\\n]*?${NUM}`, "i"));

  if (correct) {
    const v = marksValue(correct[1]);
    if (v !== null) found.correct = v;
  }
  if (wrong) {
    const v = marksValue(wrong[1]);
    if (v !== null) found.wrong = Math.abs(v);
  }
  return found;
}

// Which option a block's ✔ belongs to, from the mark images alone.
//
// Every option carries a mark, and within one question the ✔ image appears once
// while the ✘ appears on all the others — so the mark that is unique inside the
// block is the tick. Anything less clear-cut (two accepted answers, a stray
// image landing on an option row) returns null rather than a guess.
function tickedOption(options) {
  const freq = new Map();
  for (const opt of options) {
    for (const name of opt.marks) freq.set(name, (freq.get(name) ?? 0) + 1);
  }
  const unique = [...freq].filter(([, count]) => count === 1).map(([name]) => name);
  if (unique.length !== 1) return null;
  const owners = options.filter((opt) => opt.marks.includes(unique[0]));
  return owners.length === 1 ? owners[0].n : null;
}

/* Parse an annotated response sheet from `readPdfLines` output.
 *
 * Returns
 *   responses  Map<qNo, letter>   the candidate's answers ("" = unattempted)
 *   key        Map<qNo, letter>   the official answer
 *   sections   {qNo: sectionName}
 *   labels     {qNo: "10"}        the question number as printed on the sheet
 *   scheme     {correct?, wrong?, total?} as declared on the sheet
 *   meta       {testDate?, testTime?} the paper's own identifiers
 *
 * Questions are *keyed* by position, not by the printed number: a sheet holding
 * two papers (a main paper plus a qualifying one) restarts at Q.1 half way
 * through, so printed numbers are not unique. They are still reported in
 * `labels`, because that is what the candidate sees on their own sheet.
 */
export function parseAnnotatedSheet(lines) {
  const responses = new Map();
  const key = new Map();
  const sections = {};
  const labels = {};
  const meta = {};

  let qno = 0;
  let currentSection = "";
  let options = []; // option rows seen since the last question block ended
  let label = null; // printed "Q.<n>", assembled from its (wrapped) parts
  let labelX = 0;

  for (const { text, runs, marks } of lines) {
    // "Section" only, never "Subject": on these sheets the Subject row is the
    // paper's own title, which would land in every question as its section.
    // Names run long — "English Language Skills and Punjabi Language Skills".
    const sec = text.match(/^Section\s*[:\-]\s*(.{2,100})$/i);
    if (sec) {
      currentSection = sec[1].trim();
      continue;
    }

    const date = text.match(/Test\s*Date\s*:?\s*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})/i);
    if (date) meta.testDate = date[1];
    const time = text.match(/Test\s*Time\s*:?\s*(.{3,40})$/i);
    if (time) meta.testTime = time[1].trim();

    // The printed question number, which sits in a cell narrow enough that
    // "Q.10" is laid out as "Q.1" with the "0" on the line below, and "Q.100" as
    // "Q.1" + "00". One continuation is therefore all there is: taking only the
    // first also stops a stray digit further down the block extending the number.
    const first = runs[0];
    const start = first?.str.match(/^Q\.\s*(\d+)/);
    if (start) {
      label = start[1];
      labelX = first.x;
    } else if (label !== null && labelX !== null && /^\d{1,2}$/.test(first?.str.trim())) {
      if (Math.abs(first.x - labelX) <= 8) {
        label += first.str.trim();
        labelX = null;
      }
    }

    // An option row. The official answer is the one printed in green, or failing
    // that (some sheets reuse one font for both colours) the one bearing the ✔.
    const option = runs.map((r) => ({ r, m: r.str.match(OPTION_ROW) })).find((o) => o.m);
    if (option) {
      options.push({
        n: +option.m[1],
        green: runs.some((r) => r.colour === "green") || TICK.test(option.r.str),
        marks,
      });
    }

    const chosen = text.match(/Chosen\s*Option\s*:?\s*(\d+|-{1,2})/i);
    if (!chosen) continue;

    qno++;
    responses.set(qno, /^-+$/.test(chosen[1]) ? "" : normalizeAnswer(chosen[1]));

    // Several green options means the commission accepted more than one answer;
    // `isCorrect` already treats "A,C" as either being right.
    const green = options.filter((o) => o.green).map((o) => o.n);
    const ticked = green.length ? [] : [tickedOption(options)].filter(Boolean);
    const right = green.length ? green : ticked;
    if (right.length) key.set(qno, [...new Set(right)].sort().map((n) => "ABCDE"[n - 1]).join(","));

    if (currentSection) sections[qno] = currentSection;
    if (label !== null) labels[qno] = label;
    options = [];
    label = null;
  }

  const scheme = parseMarkingNote(lines.map((l) => l.text).join("\n"));
  if (qno) scheme.total = qno;
  return { responses, key, sections, labels, scheme, meta };
}

const NOTHING = {
  responses: new Map(),
  key: new Map(),
  sections: {},
  labels: {},
  scheme: {},
  meta: {},
};

// Read a dropped/selected file into responses, the key and marking scheme it
// carries, and any section labels.
export async function parseResponseFile(file, onProgress) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  if (isPdf) {
    const lines = await readPdfLines(file, onProgress);
    const parsed = parseAnnotatedSheet(lines);
    if (parsed.responses.size) return { ...parsed, kind: "pdf" };
    // Not a layout we recognise — fall back to the generic list reader.
    const flat = lines.map((l) => l.text).join("\n");
    return { ...NOTHING, responses: parseAnswerList(flat), kind: "pdf" };
  }

  const text = await file.text();
  const isHtml = /\.html?$/i.test(file.name) || /<html|<table/i.test(text.slice(0, 2000));
  if (!isHtml) return { ...NOTHING, responses: parseAnswerList(text), kind: "text" };

  const parsed = parseResponseSheetHtml(text);
  if (parsed.responses.size) {
    const scheme = { ...parseMarkingNote(text.replace(/<[^>]+>/g, " ")), total: parsed.responses.size };
    return { ...NOTHING, ...parsed, scheme, kind: "html" };
  }
  // HTML we didn't recognise — strip tags and try the plain-text reader.
  return {
    ...NOTHING,
    responses: parseAnswerList(text.replace(/<[^>]+>/g, "\n")),
    kind: "html",
  };
}

export function isCorrect(mine, key) {
  if (!mine || !key) return false;
  if (key === "*") return true; // dropped question: full credit
  const myOpts = mine.split(",");
  if (myOpts.length > 1) return false; // multi-marked response
  return key.split(",").includes(myOpts[0]);
}

// Score every question from 1..total. Returns per-question rows plus totals.
// `labels` maps a question's position to the number printed on the sheet, which
// is what the report shows — they differ only when one file holds two papers.
export function scoreAll({ responses, key, sections = {}, labels = {}, scheme, total }) {
  const questionCount = Math.max(
    total || 0,
    responses.size ? Math.max(...responses.keys()) : 0,
    key.size ? Math.max(...key.keys()) : 0,
  );

  const rows = [];
  let score = 0;
  let correct = 0;
  let incorrect = 0;
  let skipped = 0;
  let unkeyed = 0;

  for (let q = 1; q <= questionCount; q++) {
    const mine = responses.get(q) ?? "";
    const right = key.get(q) ?? "";
    let status;
    let impact;

    if (!right) {
      status = "unkeyed";
      impact = 0;
      unkeyed++;
    } else if (!mine) {
      status = "skipped";
      impact = scheme.skipped;
      skipped++;
      score += scheme.skipped;
    } else if (isCorrect(mine, right)) {
      status = "correct";
      impact = scheme.correct;
      correct++;
      score += scheme.correct;
    } else {
      status = "incorrect";
      impact = -scheme.wrong;
      incorrect++;
      score -= scheme.wrong;
    }

    rows.push({
      q,
      label: labels[q] || String(q),
      section: sections[q] || "—",
      mine,
      right,
      status,
      impact,
    });
  }

  const attempted = correct + incorrect;
  return {
    rows,
    score,
    correct,
    incorrect,
    skipped,
    unkeyed,
    attempted,
    total: questionCount,
    maxScore: (questionCount - unkeyed) * scheme.correct,
    accuracy: attempted ? (correct / attempted) * 100 : 0,
  };
}

export const round = (n) => (Math.round(n * 100) / 100).toString();

export function toCsv(rows) {
  const header = "Question,Section,Your Answer,Correct Answer,Status,Impact";
  const body = rows.map((r) =>
    [
      r.label,
      `"${r.section.replace(/"/g, '""')}"`,
      r.mine || "-",
      r.right || "-",
      r.status,
      r.status === "unkeyed" ? "" : round(r.impact),
    ].join(","),
  );
  return [header, ...body].join("\n");
}
