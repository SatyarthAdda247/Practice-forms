// Answer Key Checker — pure parsing and scoring. No React, no DOM writes.
//
// Accepted response formats
//   1. Saved response-sheet HTML (NTA-style "Question ID" / "Chosen Option"
//      tables, or a flat Q.No / Chosen Option grid).
//   2. Plain text / CSV: "1 B" per line, "1,B", or one run "BCAD-".

/* -------------------------------------------------------------------------- *
 * Marking-scheme profiles
 *
 * Deliberately a SHORT list of patterns, not one entry per exam. The authority
 * on how a paper is marked is the marking note printed on the response sheet
 * itself — parseMarkingNote reads it and it overrides whatever is selected here
 * (see parseAnnotatedHtmlSheet). A preset only has to cover the case where
 * somebody types their answers in by hand and the sheet is not available.
 *
 * So a profile is pinned to an exam only where the conducting body's pattern is
 * long-standing and unambiguous. Everywhere else the exam carries NO profile:
 * selecting it leaves the marks inputs alone and the page says the marks need
 * checking. That is the honest outcome — a guessed penalty would silently change
 * the score of every hand-typed paper, and unlike a missing preset it would do
 * so without telling anyone.
 * -------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------- *
 * Exam catalogue
 *
 * One entry per exam, because the exam slug is the *cohort key*: it is what the
 * warehouse groups by, and therefore what "Expected Rank" compares a candidate
 * against. The old nine buckets made RRB NTPC rank against RRB Group D, ALP and
 * JE — different papers, different difficulty, a meaningless comparison. Adding
 * a paper here is how it becomes rankable.
 *
 * Slugs are permanent. Renaming one orphans every row already warehoused under
 * the old name, so add and deprecate rather than rewrite.
 *
 * Shape:  group -> { body, scheme?, exams: [[slug, label, schemeOverride?], …] }
 *   `scheme`          profile every exam in the group inherits (see SCHEMES)
 *   `schemeOverride`  per-exam; pass null where the exam departs from its group
 *   `body`            conducting body, shown beside the exam so two similarly
 *                     named posts from different bodies are told apart
 *
 * Grouping is by conducting body rather than by subject, so each exam appears
 * exactly once. Subject ("nursing", "engineering") is already in the exam name.
 * -------------------------------------------------------------------------- */
const CATALOGUE = {
  "SSC": {
    body: "SSC",
    scheme: "ssc",
    exams: [
      ["ssc-cgl", "SSC CGL"],
      ["ssc-chsl", "SSC CHSL"],
      ["ssc-cpo", "SSC CPO"],
      // MTS and GD are marked differently from the rest of the SSC calendar, and
      // which way round changes by tier and year — so no preset is asserted.
      ["ssc-mts", "SSC MTS", null],
      ["ssc-gd-constable", "SSC GD Constable", null],
      ["ssc-selection-post", "SSC Selection Post"],
      ["ssc-je", "SSC JE", null],
      ["ssc-jht", "SSC JHT"],
      ["ssc-stenographer", "SSC Stenographer"],
      ["ssc-scientific-assistant", "SSC Scientific Assistant (IMD)", null],
    ],
  },
  "Railways (RRB)": {
    body: "RRB",
    scheme: "railway",
    exams: [
      ["rrb-ntpc", "RRB NTPC"],
      ["rrb-group-d", "RRB Group D"],
      ["rrb-alp", "RRB ALP"],
      ["rrb-je", "RRB JE"],
      ["rrb-technician", "RRB Technician"],
      ["rrb-paramedical", "RRB Paramedical"],
      ["rrb-ministerial-isolated", "RRB Ministerial & Isolated"],
      ["rrb-nursing-superintendent", "RRB Nursing Superintendent"],
      ["rrb-pharmacist", "RRB Pharmacist"],
      ["rrb-health-malaria-inspector", "RRB Health & Malaria Inspector"],
    ],
  },
  "DSSSB — Delhi": {
    body: "DSSSB",
    exams: [
      ["dsssb-prt", "DSSSB PRT"],
      ["dsssb-tgt", "DSSSB TGT"],
      ["dsssb-pgt", "DSSSB PGT"],
      ["dsssb-assistant-teacher", "DSSSB Assistant Teacher"],
      ["dsssb-asst-teacher-nursery", "DSSSB Assistant Teacher (Nursery)"],
      ["dsssb-drawing-teacher", "DSSSB Drawing Teacher"],
      ["dsssb-music-teacher", "DSSSB Music Teacher"],
      ["dsssb-pet", "DSSSB Physical Education Teacher (PET)"],
      ["dsssb-domestic-science-teacher", "DSSSB Domestic Science Teacher"],
      ["dsssb-special-educator-primary", "DSSSB Special Educator (Primary)"],
      ["dsssb-special-educator-tgt", "DSSSB Special Educator (TGT)"],
      ["dsssb-librarian", "DSSSB Librarian"],
      ["dsssb-nursing-officer", "DSSSB Nursing Officer (Staff Nurse)"],
      // One entry for all three streams: the sheet lists them together, and a
      // per-stream split would only be worth it if each sat a separate paper —
      // which is an additive change if it turns out they do.
      ["dsssb-pharmacist", "DSSSB Pharmacist (Allopathy / Ayurveda / Homeopathy)"],
      ["dsssb-lab-technician", "DSSSB Laboratory Technician"],
      ["dsssb-ecg-technician", "DSSSB ECG Technician"],
      ["dsssb-ot-assistant", "DSSSB OT Assistant"],
      ["dsssb-radiographer", "DSSSB Radiographer"],
      ["dsssb-dental-hygienist", "DSSSB Dental Hygienist"],
      ["dsssb-anm", "DSSSB Auxiliary Nurse Midwife (ANM)"],
      ["dsssb-warder-matron", "DSSSB Warder / Matron (Medical)"],
      ["dsssb-je-civil", "DSSSB Junior Engineer (Civil)"],
      ["dsssb-je-electrical", "DSSSB Junior Engineer (Electrical)"],
      ["dsssb-assistant-engineer", "DSSSB Assistant Engineer"],
      ["dsssb-section-officer-horticulture", "DSSSB Section Officer (Horticulture)"],
      ["dsssb-junior-scientific-assistant", "DSSSB Junior Scientific Assistant"],
      ["dsssb-scientific-assistant", "DSSSB Scientific Assistant"],
      ["dsssb-laboratory-assistant", "DSSSB Laboratory Assistant"],
      ["dsssb-it-assistant-a", "DSSSB IT Assistant Grade-A"],
      ["dsssb-grade-ii-dass", "DSSSB Grade-II (DASS)"],
      ["dsssb-aso", "DSSSB Assistant Section Officer (ASO)"],
      ["dsssb-personal-assistant", "DSSSB Personal Assistant"],
      ["dsssb-stenographer", "DSSSB Stenographer"],
      ["dsssb-junior-assistant", "DSSSB Junior Assistant"],
      ["dsssb-ldc", "DSSSB Lower Division Clerk (LDC)"],
      ["dsssb-head-clerk", "DSSSB Head Clerk"],
      ["dsssb-junior-clerk", "DSSSB Junior Clerk"],
      ["dsssb-deo", "DSSSB Data Entry Operator (DEO)"],
      ["dsssb-welfare-officer", "DSSSB Welfare Officer"],
      ["dsssb-assistant-superintendent", "DSSSB Assistant Superintendent"],
      ["dsssb-investigator", "DSSSB Investigator"],
      ["dsssb-assistant-archivist", "DSSSB Assistant Archivist"],
      ["dsssb-store-keeper", "DSSSB Store Keeper"],
      ["dsssb-process-server", "DSSSB Process Server"],
      ["dsssb-chauffeur", "DSSSB Chauffeur"],
      ["dsssb-dispatch-rider", "DSSSB Dispatch Rider"],
      ["dsssb-conservation-assistant", "DSSSB Conservation Assistant"],
    ],
  },
  "Teaching boards": {
    body: "State board",
    scheme: "teaching",
    exams: [
      ["bseh-htet", "HTET — Haryana TET (BSEH)"],
      ["bseb-bihar-stet", "Bihar STET (BSEB)"],
    ],
  },
  "AIIMS": {
    body: "AIIMS",
    exams: [
      ["aiims-norcet", "AIIMS NORCET"],
      ["aiims-cre", "AIIMS CRE"],
      ["aiims-bsc-nursing", "AIIMS B.Sc Nursing"],
    ],
  },
  "ESIC": {
    body: "ESIC",
    exams: [
      ["esic-nursing-officer", "ESIC Nursing Officer"],
      ["esic-sso", "ESIC SSO"],
      ["esic-udc", "ESIC UDC"],
      ["esic-mts", "ESIC MTS"],
    ],
  },
  "NTA": {
    body: "NTA",
    exams: [
      ["nta-icar-pg", "ICAR PG"],
      ["nta-icar-phd", "ICAR PhD"],
    ],
  },
  "Madhya Pradesh (MPESB)": {
    body: "MPESB",
    exams: [
      ["mpesb-police-constable", "MP Police Constable"],
      ["mpesb-group-2-sub-4", "MP Group 2 Sub Group 4"],
      ["mpesb-group-3", "MP Group 3"],
      ["mpesb-group-5", "MP Group 5"],
      ["mpesb-forest-guard", "MP Forest Guard"],
      ["mpesb-excise-constable", "MP Excise Constable"],
      ["mpesb-jail-prahari", "MP Jail Prahari"],
      ["mpesb-primary-teacher", "MP Primary Teacher"],
      ["mpesb-nursing-officer", "MP Nursing Officer"],
      ["mpesb-pat", "MP PAT"],
    ],
  },
  "Rajasthan": {
    body: "RSMSSB",
    exams: [
      ["rsmssb-cet-graduate", "Rajasthan CET — Graduate Level"],
      ["rsmssb-cet-12th", "Rajasthan CET — 12th Level"],
      ["rsmssb-informatics-assistant", "Rajasthan Informatics Assistant"],
      ["rsmssb-junior-accountant", "Rajasthan Junior Accountant"],
      ["rsmssb-cho", "Rajasthan CHO"],
      ["rsmssb-lab-assistant", "Rajasthan Lab Assistant"],
      ["rajasthan-jet", "Rajasthan JET (AU Jodhpur)"],
    ],
  },
  "Bihar": {
    body: "Bihar",
    exams: [
      ["bssc-cgl", "BSSC CGL"],
      ["bssc-inter-level", "BSSC Inter Level"],
      ["btsc-staff-nurse", "BTSC Staff Nurse"],
      ["bcece", "BCECE (BCECEB)"],
      ["bcece-agriculture", "BCECE Agriculture (BCECEB)"],
      ["bsphcl-correspondence-clerk", "BSPHCL Correspondence Clerk"],
      ["bsphcl-store-assistant", "BSPHCL Store Assistant"],
      ["bsphcl-junior-accounts-clerk", "BSPHCL Junior Accounts Clerk"],
      ["bsphcl-technician-grade-iii", "BSPHCL Technician Grade III"],
      ["bsphcl-aee", "BSPHCL Assistant Executive Engineer"],
      ["bsphcl-jee", "BSPHCL Junior Electrical Engineer"],
      ["bsphcl-assistant-it-manager", "BSPHCL Assistant IT Manager"],
      ["bsphcl-accounts-officer", "BSPHCL Accounts Officer"],
      ["bsphcl-assistant-law-officer", "BSPHCL Assistant Law Officer"],
    ],
  },
  "Uttar Pradesh": {
    body: "UPSSSC / UPPCL",
    exams: [
      ["upsssc-junior-assistant", "UPSSSC Junior Assistant"],
      ["upsssc-agta", "UPSSSC AGTA"],
      ["uppcl-assistant-engineer", "UPPCL Assistant Engineer"],
    ],
  },
  "Odisha": {
    body: "OSSC / OSSSC / OPSC",
    exams: [
      ["ossc-cgl", "OSSC CGL"],
      ["ossc-chsl", "OSSC CHSL"],
      ["osssc-ri", "OSSSC Revenue Inspector (RI)"],
      ["osssc-ari", "OSSSC Assistant Revenue Inspector (ARI)"],
      ["osssc-amin", "OSSSC Amin"],
      ["osssc-icds-supervisor", "OSSSC ICDS Supervisor"],
      ["osssc-junior-assistant", "OSSSC Junior Assistant"],
      ["osssc-vaw", "OSSSC Village Agriculture Worker (VAW)"],
      ["osssc-sfs", "OSSSC Statistical Field Surveyor (SFS)"],
      ["osssc-forest-guard", "OSSSC Forest Guard"],
      ["osssc-livestock-inspector", "OSSSC Livestock Inspector"],
      ["osssc-nursing-officer", "OSSSC Nursing Officer"],
      ["opsc-aee", "OPSC Assistant Executive Engineer"],
    ],
  },
  "Telangana & Andhra Pradesh": {
    body: "TG / AP",
    exams: [
      ["tghc-junior-assistant", "Telangana High Court Junior Assistant"],
      ["tghc-examiner", "Telangana High Court Examiner"],
      ["tghc-typist", "Telangana High Court Typist"],
      ["tghc-copyist", "Telangana High Court Copyist"],
      ["tghc-office-subordinate", "Telangana High Court Office Subordinate"],
      ["tghc-process-server", "Telangana High Court Process Server"],
      ["tghc-record-assistant", "Telangana High Court Record Assistant"],
      ["tgche-eapcet-agriculture", "TS EAPCET Agriculture"],
      ["apsche-eapcet-agriculture", "AP EAPCET Agriculture"],
      ["tsgenco-ae", "TSGENCO Assistant Engineer"],
      ["tstransco-ae", "TSTRANSCO Assistant Engineer"],
      ["apgenco-ae", "APGENCO Assistant Engineer"],
      ["aptransco-ae", "APTRANSCO Assistant Engineer"],
    ],
  },
  "Other states": {
    body: "State",
    exams: [
      ["cg-vyapam-pat", "CG PAT (CG Vyapam)"],
      ["hppsc-assistant-engineer", "HPPSC Assistant Engineer"],
      ["ukpsc-assistant-engineer", "UKPSC Assistant Engineer"],
      ["tnpsc-combined-engineering", "TNPSC Combined Engineering Services"],
      ["pspcl-assistant-engineer", "PSPCL Assistant Engineer"],
      ["mptransco-assistant-engineer", "MPTRANSCO Assistant Engineer"],
      ["wbsedcl-assistant-engineer", "WBSEDCL Assistant Engineer"],
      ["wbsetcl-assistant-engineer", "WBSETCL Assistant Engineer"],
    ],
  },
  "Central PSU & undertakings": {
    body: "PSU",
    exams: [
      ["aai-je-atc", "AAI Junior Executive (ATC)"],
      ["aai-je-engineering", "AAI Junior Executive (Engineering)"],
      ["aai-non-executive", "AAI Non-Executive"],
      ["dfccil-junior-executive", "DFCCIL Junior Executive"],
      ["dfccil-executive", "DFCCIL Executive / JE"],
      ["fci-category-ii", "FCI Category II"],
      ["fci-category-iii", "FCI Category III"],
      ["dmrc-je", "DMRC Junior Engineer"],
      ["dmrc-assistant-manager", "DMRC Assistant Manager"],
      ["hpcl-engineer", "HPCL Engineer"],
      ["iocl-engineer", "IOCL Engineer / Officer"],
      ["ongc-aee", "ONGC AEE"],
      ["ecil-get", "ECIL Graduate Engineer Trainee (GET)"],
      ["bel-probationary-engineer", "BEL Probationary Engineer"],
      ["bhel-engineer-trainee", "BHEL Engineer Trainee"],
      ["nlc-get", "NLC India GET"],
      ["cil-management-trainee", "CIL Management Trainee (Engineering)"],
      ["nfl-management-trainee", "NFL Management Trainee (Engineering)"],
      ["sail-management-trainee", "SAIL Management Trainee (Technical)"],
      ["gail-executive-trainee", "GAIL Executive Trainee / Engineer"],
      ["nhpc-trainee-engineer", "NHPC Trainee Engineer"],
      ["thdc-engineer-trainee", "THDC Engineer Trainee"],
      ["rvnl-site-engineer", "RVNL Site Engineer / Manager"],
      ["rites-engineer", "RITES Engineer"],
      ["ircon-works-engineer", "IRCON Works Engineer"],
      ["npcil-executive-trainee", "NPCIL Executive Trainee"],
    ],
  },
  // Kept for the hand-typed path and for papers not yet catalogued above. These
  // are marking *patterns*, so they group a whole family together and are a
  // deliberately coarse cohort — pick the named exam instead where one exists.
  "Generic marking patterns": {
    body: "Pattern",
    exams: [
      ["pattern-state", "State commission — generic (+1 / −1⁄3)", "state"],
      ["pattern-defence", "Defence — CDS / AFCAT / Agniveer (+1 / −1⁄3)", "defence"],
      ["pattern-teaching", "Teaching / TET — generic (+1, no penalty)", "teaching"],
      ["pattern-upsc", "Civil Services — UPSC Prelims (+2 / −0.66)", "upsc"],
      ["pattern-jee", "Engineering — JEE Main (+4 / −1)", "jee"],
      ["pattern-neet", "Medical — NEET (+4 / −1)", "neet"],
      ["custom", "Custom marking scheme", "custom"],
    ],
  },
};

// The exam picked when the page first loads: the most-sat paper in the sheet
// that we also hold a sample for.
export const DEFAULT_EXAM = "ssc-cgl";

// Grouped for <optgroup>, so a ~200-entry dropdown stays navigable.
export const EXAM_GROUPS = Object.entries(CATALOGUE).map(([group, spec]) => ({
  group,
  body: spec.body,
  options: spec.exams.map(([value, label, ...override]) => ({
    value,
    label,
    body: spec.body,
    // `override.length` rather than a truthiness test: an explicit null means
    // "this exam departs from its group and pins nothing", which is different
    // from "not specified".
    scheme: override.length ? override[0] : spec.scheme ?? null,
  })),
}));

// Flat list, for lookups and for anything that just wants every exam.
export const EXAM_OPTIONS = EXAM_GROUPS.flatMap((g) => g.options);

const EXAM_BY_VALUE = new Map(EXAM_OPTIONS.map((o) => [o.value, o]));

// The marking profile for an exam, or null when none is pinned — in which case
// the caller must leave the marks inputs as they are. Note the returned object
// is a fresh copy: callers put it straight into component state and edit it.
export function schemeForExam(value) {
  const profile = EXAM_BY_VALUE.get(value)?.scheme;
  const preset = profile ? SCHEMES[profile] : null;
  return preset ? { ...preset } : null;
}

export function examLabel(value) {
  return EXAM_BY_VALUE.get(value)?.label || value || "";
}

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

/* -------------------------------------------------------------------------- *
 * Answer-key URL (TCS iON / digialm annotated response sheet)
 *
 * Commissions hand candidates a *link*, not a file: an email points at
 * cdn<N>.digialm.com, which renders the same annotated sheet the PDF branch
 * above parses — every option printed, the official answer green with a tick,
 * the candidate's own pick stated as "Chosen Option : <n>" in a side table, and
 * "Section : <name>" headings between subjects.
 *
 * Two things make the HTML far easier than the PDF: the correct option is
 * marked by a CSS class (`rightAns`) rather than by a fill colour, and the
 * option letter is printed in the cell ("C. 10.8"). So none of the colour or
 * tick-image forensics needed for the PDF applies here.
 *
 * Why this is not parseResponseSheetHtml: that reader walks *every* table
 * looking for a "Chosen Option" label, and on this layout each question is a
 * table nested inside another table, so every answer is found twice — a
 * 100-question paper reads back as 200 responses. It also has no notion of the
 * official answer, which is the whole point of an annotated sheet. This reader
 * walks question *panels* instead, so each question is visited exactly once.
 *
 * The page cannot be fetched from the browser: digialm sends no
 * Access-Control-Allow-Origin, and answers a non-browser User-Agent with a 400.
 * So the HTML arrives via the backend proxy (POST
 * /api/tools/answerkey-checker/fetch) and is parsed here, in the browser, just
 * like an uploaded file.
 *
 * Nothing identifying the candidate — participant id, name, test centre, the
 * two photographs — is read out of the page. Only answers, section names, the
 * marking note and the paper's own date/time.
 * -------------------------------------------------------------------------- */

// Hosts whose response sheets this tool accepts. Advisory only: the backend
// proxy holds the authoritative allowlist (it is what actually makes the
// request), and this copy exists so an obviously wrong paste is rejected
// without a round-trip. Keep the two in step — see KEYCHECK_URL_HOSTS in
// backend/app.py.
export const KEY_URL_HOSTS = ["digialm.com", "tcsion.com"];

const hostAllowed = (host) =>
  KEY_URL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

/* Validate a pasted response-sheet link, returning { url } or { error }.
 *
 * Deliberately forgiving about how the link arrives — candidates paste it out
 * of an email or a WhatsApp forward, so a missing scheme and surrounding
 * whitespace are normal. A doubled slash in the path is left alone: digialm
 * serves those perfectly well, and rewriting the path risks breaking a link
 * that would have worked.
 */
export function normalizeKeyUrl(raw) {
  const text = String(raw || "").trim().replace(/^<|>$/g, "");
  if (!text) return { error: "Paste your answer key URL first." };

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: "That does not look like a web address." };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { error: "Only http and https links are supported." };
  }
  if (!hostAllowed(url.hostname.toLowerCase())) {
    return {
      error:
        `Only response-sheet links from ${KEY_URL_HOSTS.join(" or ")} are supported. ` +
        "Paste the link the commission emailed you.",
    };
  }
  // The trailing "#" candidates copy along with the link is not part of the
  // request; drop the fragment rather than sending it.
  url.hash = "";
  return { url: url.href };
}

// "A. 10.8" / "B) 12" — the option letter as printed in the cell.
const OPTION_LETTER = /^\s*([A-E])\s*[.)]/;

/* Parse a TCS iON annotated response sheet from its HTML.
 *
 * Returns the same shape as parseAnnotatedSheet (the PDF reader), so the two
 * feed the page identically:
 *   responses  Map<qNo, letter>   the candidate's answers ("" = unattempted)
 *   key        Map<qNo, letter>   the official answer ("A,C" if two were accepted)
 *   sections   {qNo: sectionName}
 *   labels     {qNo: "10"}        the question number as printed
 *   scheme     {correct?, wrong?, total?} as declared in the sheet's own note
 *   meta       {testDate?, testTime?}
 *
 * As in the PDF reader, questions are keyed by *position* rather than by the
 * printed number: a sheet holding two papers restarts at Q.1 half way through,
 * so printed numbers are not unique. They are still reported in `labels`.
 */
export function parseAnnotatedHtmlSheet(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const clean = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

  const responses = new Map();
  const key = new Map();
  const sections = {};
  const labels = {};
  const meta = {};

  let qno = 0;
  let currentSection = "";

  // Headings and question panels in one document-order pass, so each question
  // picks up the section heading that actually precedes it.
  for (const node of doc.querySelectorAll(".section-lbl, .question-pnl")) {
    if (node.classList.contains("section-lbl")) {
      // "Section :" and the name are separate spans, so read the whole heading
      // and strip the prefix — matching a single leaf node finds only the label.
      currentSection = clean(node).replace(/^Section\s*:?\s*/i, "").trim();
      continue;
    }

    // The side table carries the candidate's own answer. "Chosen Option" is
    // sometimes an option number (1-4) and sometimes an option *ID*, so the
    // Option N ID rows are collected to translate it.
    const optionIds = new Map();
    let chosen;
    for (const tr of node.querySelectorAll(".menu-tbl tr")) {
      const cells = [...tr.children].map(clean);
      if (cells.length < 2) continue;
      const label = cells[0].replace(/\s*:\s*$/, "").toLowerCase();
      const opt = label.match(/^option\s*(\d)\s*id$/);
      if (opt) optionIds.set(cells[1], "ABCDE"[+opt[1] - 1]);
      if (/^chosen\s*option$/.test(label)) chosen = cells[1];
    }
    // These sheets close the row before the last pair ("</tr><td>Chosen Option
    // :</td>"), which the HTML parser repairs into a row of its own — but not
    // every generator produces the same repair, so fall back to the panel text.
    if (chosen === undefined) {
      const loose = clean(node).match(/Chosen\s*Option\s*:?\s*(\S+)/i);
      if (loose) chosen = loose[1];
    }

    // Option cells in printed order. The official answer is the one the sheet
    // put in green; `wrngAns` is not "the candidate was wrong", it is simply
    // every option that is not the answer.
    const options = [...node.querySelectorAll(".rightAns, .wrngAns")];
    if (!options.length && chosen === undefined) continue;

    qno++;
    const picked = String(chosen ?? "").trim();
    responses.set(qno, optionIds.get(picked) ?? normalizeAnswer(picked));

    // More than one green option means the commission accepted more than one
    // answer; isCorrect() already treats "A,C" as either being right.
    const right = [];
    options.forEach((cell, i) => {
      if (!cell.classList.contains("rightAns")) return;
      const letter = clean(cell).match(OPTION_LETTER);
      // Image-only options print no letter, so fall back to where the cell sits
      // in the printed list.
      const fallback = "ABCDE"[i] || "";
      right.push(letter ? letter[1] : fallback);
    });
    const answers = [...new Set(right.filter(Boolean))].sort();
    if (answers.length) key.set(qno, answers.join(","));

    if (currentSection) sections[qno] = currentSection;
    const printed = clean(node).match(/^Q\.\s*(\d+)/);
    if (printed) labels[qno] = printed[1];
  }

  // The marking note and the paper's date/time sit outside the question panels,
  // in the header. Read them off the flattened markup the same way the uploaded
  // -file path does, so one sheet scores identically whichever way it arrives.
  const flat = String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
  const scheme = parseMarkingNote(flat);
  if (qno) scheme.total = qno;

  const date = flat.match(/Test\s*Date\s*:?\s*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})/i);
  if (date) meta.testDate = date[1];
  const time = flat.match(
    /Test\s*Time\s*:?\s*(\d{1,2}:\d{2}\s*[AP]\.?M\.?(?:\s*(?:-|–|to)\s*\d{1,2}:\d{2}\s*[AP]\.?M\.?)?)/i,
  );
  if (time) meta.testTime = time[1].replace(/\s+/g, " ").trim();

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

  // An annotated sheet first: plenty of candidates save the page from the link
  // instead of pasting it, and that file must score the same as the link does.
  // parseResponseSheetHtml double-counts this layout (see the note above
  // parseAnnotatedHtmlSheet), so it must not get first refusal on it.
  const annotated = parseAnnotatedHtmlSheet(text);
  if (annotated.responses.size) return { ...annotated, kind: "html" };

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
