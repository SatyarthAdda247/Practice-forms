// Answer Key Checker — pure parsing and scoring. No React, no DOM writes.
//
// Accepted response formats
//   1. Saved response-sheet HTML (NTA-style "Question ID" / "Chosen Option"
//      tables, or a flat Q.No / Chosen Option grid).
//   2. Plain text / CSV: "1 B" per line, "1,B", or one run "BCAD-".

// EDIT ME: default marking scheme per exam. `null` leaves the inputs alone.
export const SCHEMES = {
  jee:    { correct: 4, wrong: 1,    skipped: 0, total: 75 },
  neet:   { correct: 4, wrong: 1,    skipped: 0, total: 180 },
  upsc:   { correct: 2, wrong: 0.66, skipped: 0, total: 100 },
  ssc:    { correct: 2, wrong: 0.5,  skipped: 0, total: 100 },
  custom: null,
};

export const EXAM_OPTIONS = [
  { value: "jee", label: "Engineering (JEE Main)" },
  { value: "neet", label: "Medical (NEET)" },
  { value: "upsc", label: "Civil Services (UPSC Prelims)" },
  { value: "ssc", label: "Staff Selection (SSC CGL)" },
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

// Characters used to flag the right answer on an annotated sheet. Only present
// when the marks were rendered as glyphs rather than images — see parsePdfText.
const TICK = /[✔✓☑]/;
const CROSS = /[✘✗✕✖×]/;

/* -------------------------------------------------------------------------- *
 * PDF
 *
 * Candidates usually hand over a browser "print to PDF" of the digialm/TCS iON
 * response sheet, so the text layout mirrors the HTML one: a per-question block
 * of "Label : value" pairs ending in "Chosen Option : N".
 *
 * pdf.js is loaded on demand — it is ~1MB, and the portal must not pay for it.
 * -------------------------------------------------------------------------- */
export async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist");
  // Vite resolves this to a bundled asset URL at build time.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;

  // Keep the loading task: teardown lives on it, not on the document proxy.
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    // Group items into visual lines by their y position, so "Chosen Option"
    // and its value stay on one line the way they appear on the page.
    const lines = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      (lines.get(y) ?? lines.set(y, []).get(y)).push({ x: item.transform[4], s: item.str });
    }
    const ordered = [...lines.entries()]
      .sort((a, b) => b[0] - a[0]) // top of the page downwards
      .map(([, parts]) =>
        parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim(),
      )
      .filter(Boolean);
    pages.push(ordered.join("\n"));
  }
  await task.destroy();
  return pages.join("\n");
}

// Parse the flattened text of a response-sheet PDF.
//
// Returns responses and — when the sheet is an annotated copy whose tick marks
// survived as characters — the answer key it carries. Most sheets render those
// marks as images, which carry no text at all; then `key` comes back empty and
// the candidate still pastes the key by hand.
export function parsePdfText(text) {
  const lines = text.split("\n");
  const responses = new Map();
  const key = new Map();
  const sections = {};

  let qno = 0;
  let currentSection = "";
  let marked = null; // option number ticked since the last question block

  for (const line of lines) {
    const sec = line.match(/^(?:Section|Subject)\s*[:\-]\s*(.{2,40})$/i);
    if (sec) {
      currentSection = sec[1].trim();
      continue;
    }

    // An option row on an annotated sheet, e.g. "✔ 2. Satnam Singh Sandhu".
    const opt = line.match(/^\s*([✔✓☑✘✗✕✖×])\s*(\d)\s*[.)]/);
    if (opt && TICK.test(opt[1])) marked = +opt[2];
    else if (opt && CROSS.test(opt[1])) {
      /* wrong-answer marker: carries no information we need */
    }

    const chosen = line.match(/Chosen\s*Option\s*:?\s*(\d+|-{1,2})/i);
    if (!chosen) continue;

    qno++;
    const raw = chosen[1];
    responses.set(qno, /^-+$/.test(raw) ? "" : normalizeAnswer(raw));
    if (marked >= 1 && marked <= 5) key.set(qno, "ABCDE"[marked - 1]);
    if (currentSection) sections[qno] = currentSection;
    marked = null;
  }

  return { responses, key, sections };
}

// Read a dropped/selected file into a response map, any section labels, and —
// only for annotated sheets that expose it — the answer key.
export async function parseResponseFile(file) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  if (isPdf) {
    const text = await extractPdfText(file);
    const parsed = parsePdfText(text);
    if (parsed.responses.size) return parsed;
    // Not a layout we recognise — fall back to the generic list reader.
    return { responses: parseAnswerList(text), key: new Map(), sections: {} };
  }

  const text = await file.text();
  const isHtml = /\.html?$/i.test(file.name) || /<html|<table/i.test(text.slice(0, 2000));
  if (!isHtml) return { responses: parseAnswerList(text), key: new Map(), sections: {} };

  const parsed = parseResponseSheetHtml(text);
  if (parsed.responses.size) return { ...parsed, key: new Map() };
  // HTML we didn't recognise — strip tags and try the plain-text reader.
  return {
    responses: parseAnswerList(text.replace(/<[^>]+>/g, "\n")),
    key: new Map(),
    sections: {},
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
export function scoreAll({ responses, key, sections = {}, scheme, total }) {
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

    rows.push({ q, section: sections[q] || "—", mine, right, status, impact });
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
      r.q,
      `"${r.section.replace(/"/g, '""')}"`,
      r.mine || "-",
      r.right || "-",
      r.status,
      r.status === "unkeyed" ? "" : round(r.impact),
    ].join(","),
  );
  return [header, ...body].join("\n");
}
