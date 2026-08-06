// ─── src/pages/exam-forms/ExamFormsAdmin.jsx ─────────────────────────────
// Admin dashboard for the Adda247 Practice Forms portal.
//
// Features:
//   • Tracks total website visitors (adda_website_visitor_count)
//   • Tracks every click made on "Start Practice" (adda_start_practice_clicks)
//   • Saves candidate Name, Mobile Number, and Email ID directly from Form Basic Details
//   • Shows where each candidate left the form at or if they fully completed it
//   • Provides search, filter, CSV export, auto-refresh, and inspect candidate modal

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { Adda247Logo } from "../../components/GovtLogos.jsx";
import {
  getVisitorCount,
  getStartPracticeClickCount,
  getPortalLoginsHistory,
} from "../../practiceUser.js";
import { practiceStore } from "../../tools/lib/practiceStore.js";
import { toolsApi } from "../../api.js";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function normName(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, "");
}

function normPhone(s) {
  const d = (s || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

function normEmail(s) {
  return (s || "").toLowerCase().trim();
}

function readFormPersistKeys(examNS) {
  const PREFIX = `examform:${examNS}:`;
  const data = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        data[k.slice(PREFIX.length)] = localStorage.getItem(k);
      }
    }
  } catch { /* ignore */ }
  return data;
}

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    }) + ", " + d.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return iso; }
}

function timeAgo(iso) {
  if (!iso) return "";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
    return Math.floor(diff / 86_400_000) + "d ago";
  } catch { return ""; }
}

async function fetchBackendSubmissions() {
  try {
    const res = await toolsApi.listExamFormSubmissions();
    if (res && res.ok && Array.isArray(res.items)) return res.items;
  } catch { /* best-effort */ }
  return null;
}

/* ── Admin Credentials ───────────────────────────────────────────────────── */
const ADMIN_USER = "admin";
const ADMIN_PASS = "adda247@admin";
const AUTH_KEY   = "adda_admin_authenticated";

/* ── Component ───────────────────────────────────────────────────────────── */

export default function ExamFormsAdmin() {
  const navigate = useNavigate();

  // ── Login gate state ──
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    try { return sessionStorage.getItem(AUTH_KEY) === "true"; } catch { return false; }
  });
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showPass, setShowPass] = useState(false);

  function handleLogin(e) {
    e.preventDefault();
    if (loginUser.trim() === ADMIN_USER && loginPass === ADMIN_PASS) {
      try { sessionStorage.setItem(AUTH_KEY, "true"); } catch { /* ignore */ }
      setIsAuthenticated(true);
      setLoginError("");
    } else {
      setLoginError("Invalid username or password. Please try again.");
    }
  }

  function handleLogout() {
    try { sessionStorage.removeItem(AUTH_KEY); } catch { /* ignore */ }
    setIsAuthenticated(false);
    setLoginUser("");
    setLoginPass("");
  }

  // ── Dashboard state ──
  const [visitorCount, setVisitorCount] = useState(0);
  const [startPracticeClicks, setStartPracticeClicks] = useState(0);
  const [loginsHistory, setLoginsHistory] = useState([]);
  const [storeEntries, setStoreEntries] = useState([]);
  const [formPersistPO, setFormPersistPO] = useState({});
  const [formPersistClerk, setFormPersistClerk] = useState({});

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [examFilter, setExamFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("recent");
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(new Date().toISOString());
  const [backendRows, setBackendRows] = useState([]);

  const loadData = useCallback(() => {
    setVisitorCount(getVisitorCount());
    setStartPracticeClicks(getStartPracticeClickCount());
    setLoginsHistory(getPortalLoginsHistory());
    setStoreEntries(practiceStore.getAllEntries());
    setFormPersistPO(readFormPersistKeys("IBPS-PO"));
    setFormPersistClerk(readFormPersistKeys("IBPS-CLERK"));
    setLastRefreshed(new Date().toISOString());
    fetchBackendSubmissions().then((rows) => { if (rows) setBackendRows(rows); });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const iv = setInterval(loadData, 15_000);
    return () => clearInterval(iv);
  }, [loadData]);

  /* ── Build unified candidate records ──────────────────────────────────── */

  const records = useMemo(() => {
    const map = new Map();

    const stableId = (seed) => "REG-" + Math.abs(
      (seed || "x").split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
    ).toString().slice(0, 6).padStart(6, "0");

    // 1. Process form-persist localStorage snapshots (IBPS-PO and IBPS-CLERK)
    [
      { ns: "IBPS-PO", snap: formPersistPO },
      { ns: "IBPS-CLERK", snap: formPersistClerk },
    ].forEach(({ ns, snap }) => {
      const fn  = snap["id:txtfirstname"] || snap["id:fullname"] || "";
      const mn  = snap["id:txtmiddlename"] || snap["id:middlename"] || "";
      const ln  = snap["id:txtlastname"] || snap["id:lastname"] || "";
      const mob = snap["id:txtmobile"] || "";
      const emailLocal = snap["id:txtemail"] || "";
      const emailDomain = snap["id:seldomain"] || "";
      const otherDomain = snap["id:txtothdomain"] || "";
      const domain = emailDomain === "Others" ? otherDomain : emailDomain;
      const fullEmail = emailLocal
        ? (emailLocal.includes("@") ? emailLocal : emailLocal + (domain ? "@" + domain : ""))
        : "";
      const fullName = [fn, mn, ln].filter(Boolean).join(" ");
      const state = snap["id:selExamState"] || snap["id:selVacancyState"] || "";
      const category = snap["name:category"] || "";
      const dob = snap["id:txtdob"] || "";
      const gender = snap["name:gender"] || "";

      if (!fullName && !mob && !fullEmail) return;

      const key = normPhone(mob) || normEmail(fullEmail) || ("form-" + ns);
      const existing = map.get(key) || {
        id: stableId(key),
        timestamp: new Date().toISOString(),
      };

      const maxStep = parseInt(snap["__maxstep"] || "0", 10);
      const stepLabels = [
        "Basic Information", "OTP Verification", "Photo & Signature",
        "Details", "Preview", "Uploads", "Payment"
      ];
      const stepLabel = stepLabels[maxStep] || `Step ${maxStep + 1}`;
      const isSubmitted = maxStep >= 6 || snap["payment_completed"] === "1";

      map.set(key, {
        ...existing,
        name: fullName || existing.name || "Candidate",
        phone: mob || existing.phone || "-",
        email: fullEmail || existing.email || "-",
        examId: ns,
        state: state || existing.state || "-",
        category: category || existing.category || "-",
        dob: dob || existing.dob || "-",
        gender: gender || existing.gender || "-",
        currentStep: stepLabel,
        stepLeftAt: isSubmitted ? "Payment & Submission" : stepLabel,
        formStatus: isSubmitted ? "COMPLETED" : "IN_PROGRESS",
        isSubmitted: isSubmitted,
        lastActive: new Date().toISOString(),
      });
    });

    // 2. Process practiceStore entries
    storeEntries.forEach((entry) => {
      const sd = entry.stepData || {};
      const mob = sd.mobile || sd.txtmobile || sd.phone || "";
      const email = sd.email || sd.txtemail || "";
      const fn = sd.txtfirstname || sd.first_name || "";
      const ln = sd.txtlastname || sd.last_name || "";
      const fullName = [fn, ln].filter(Boolean).join(" ") || sd.fullName || sd.name || "";
      const examId = entry.SK?.replace("EXAM#", "") || "";
      const identifier = entry.PK?.replace("STUDENT#", "") || "";

      const key = normPhone(mob || identifier) || normEmail(email) || identifier;
      if (!key) return;

      const existing = map.get(key) || {};
      const isSubmitted = Boolean(entry.isSubmitted);

      map.set(key, {
        ...existing,
        id: existing.id || stableId(key),
        name: fullName || existing.name || "Candidate",
        phone: mob || existing.phone || "-",
        email: email || existing.email || "-",
        examId: examId || existing.examId || "-",
        currentStep: isSubmitted ? "Submitted ✓" : `Step ${entry.currentStep || 1}`,
        stepLeftAt: isSubmitted ? "Completed & Submitted" : `Step ${entry.currentStep || 1}`,
        formStatus: isSubmitted ? "COMPLETED" : "IN_PROGRESS",
        isSubmitted: isSubmitted,
        lastActive: entry.updatedAt || existing.lastActive || new Date().toISOString(),
      });
    });

    // 3. Process central backend rows
    backendRows.forEach((row) => {
      const d = row.data || {};
      const phone = normPhone(row.candidatePhone || row.identifier || d["id:txtmobile"] || d.phone || "");
      const email = normEmail(d["id:txtemail"] ? (d["id:txtemail"] + "@" + (d["id:seldomain"] || "")) : "");
      const key = phone || email || row.identifier || "";
      if (!key) return;

      const existing = map.get(key) || {};
      const name = row.candidateName || d.name || [d["id:fullname"], d["id:middlename"], d["id:lastname"]].filter(Boolean).join(" ");
      const isSubmitted = row.step === "payment.html" || row.step === "submitted" || existing.isSubmitted;

      map.set(key, {
        ...existing,
        id: existing.id || stableId(key),
        name: name || existing.name || "Candidate",
        phone: phone || existing.phone || "-",
        email: email || existing.email || "-",
        examId: row.examId || existing.examId || "-",
        currentStep: isSubmitted ? "Submitted ✓" : (row.step || existing.currentStep || "In Progress"),
        stepLeftAt: isSubmitted ? "Completed & Submitted" : (row.step || existing.stepLeftAt || "Basic Info"),
        formStatus: isSubmitted ? "COMPLETED" : "IN_PROGRESS",
        isSubmitted: isSubmitted,
        lastActive: row.updatedAt ? new Date(row.updatedAt * 1000).toISOString() : (existing.lastActive || new Date().toISOString()),
      });
    });

    // 4. Portal sign-ins history fallback
    loginsHistory.forEach((login) => {
      const key = normPhone(login.phone) || normEmail(login.email) || login.id || "";
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, {
          id: login.id || stableId(key),
          name: login.name || "Candidate",
          phone: login.phone || "-",
          email: login.email || "-",
          examId: "-",
          state: "-",
          category: "-",
          currentStep: "Form Not Started",
          stepLeftAt: "Form Not Started",
          formStatus: "NOT_STARTED",
          isSubmitted: false,
          lastActive: login.timestamp || login.lastActive || new Date().toISOString(),
        });
      }
    });

    const results = Array.from(map.values());

    results.sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      if (sortBy === "status") return (a.formStatus || "").localeCompare(b.formStatus || "");
      return new Date(b.lastActive || 0) - new Date(a.lastActive || 0);
    });

    return results;
  }, [formPersistPO, formPersistClerk, storeEntries, backendRows, loginsHistory, sortBy]);

  /* ── Filtering ────────────────────────────────────────────────────────── */

  const filteredRecords = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return records.filter((rec) => {
      const matchSearch = !q ||
        (rec.name || "").toLowerCase().includes(q) ||
        (rec.phone || "").includes(q) ||
        (rec.email || "").toLowerCase().includes(q) ||
        (rec.id || "").toLowerCase().includes(q);
      const matchStatus = statusFilter === "ALL" || rec.formStatus === statusFilter;
      const matchExam = examFilter === "ALL" || rec.examId === examFilter;
      return matchSearch && matchStatus && matchExam;
    });
  }, [records, searchQuery, statusFilter, examFilter]);

  /* ── Derived Stats ────────────────────────────────────────────────────── */

  const inProgressCount = records.filter(r => r.formStatus === "IN_PROGRESS").length;
  const completedCount = records.filter(r => r.formStatus === "COMPLETED").length;

  /* ── Export to CSV ────────────────────────────────────────────────────── */

  function exportCSV() {
    const headers = [
      "Sl.No", "Candidate ID", "Candidate Name", "Mobile Number", "Email ID",
      "Exam Form", "State/UT", "Category", "Step Left At", "Form Status", "Last Active"
    ];
    const rows = filteredRecords.map((r, i) => [
      i + 1,
      `"${r.id}"`, `"${r.name}"`, `"${r.phone}"`, `"${r.email}"`,
      `"${r.examId || "-"}"`, `"${r.state || "-"}"`,
      `"${r.category || "-"}"`, `"${r.stepLeftAt}"`,
      `"${r.formStatus}"`, `"${r.lastActive}"`
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `candidate_tracking_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Clear All Data ───────────────────────────────────────────────────── */

  function clearAllData() {
    if (!window.confirm(
      "⚠️ This will permanently erase ALL candidate tracking data, visitor analytics, and form entries.\n\nAre you sure?"
    )) return;
    try {
      localStorage.removeItem("adda_portal_logins_history");
      localStorage.removeItem("adda_website_visitor_count");
      localStorage.removeItem("adda_start_practice_clicks");
      localStorage.removeItem("adda_start_practice_history");
      localStorage.removeItem("adda247_practice_entries_v1");
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith("examform:")) localStorage.removeItem(k);
      });
    } catch { /* ignore */ }
    sessionStorage.clear();
    loadData();
  }

  /* ── Form Status Badge ────────────────────────────────────────────────── */

  function FormStatusBadge({ status, stepLeftAt }) {
    if (status === "COMPLETED") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
          <Icon name="check_circle" size={13} /> Fully Completed
        </span>
      );
    }
    if (status === "IN_PROGRESS") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200" title={`Left at: ${stepLeftAt}`}>
          <Icon name="hourglass_top" size={13} /> Left at: {stepLeftAt}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
        <Icon name="hourglass_empty" size={13} /> Not Started
      </span>
    );
  }

  /* ── Render Login Screen ──────────────────────────────────────────────── */

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-red-600 px-6 py-8 text-white text-center relative overflow-hidden">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-3 backdrop-blur-md border border-white/20">
              <Icon name="admin_panel_settings" size={32} />
            </div>
            <h2 className="text-2xl font-black tracking-tight">Admin Portal Sign-In</h2>
            <p className="text-xs text-white/80 mt-1">Enter your admin credentials to access the candidate analytics dashboard</p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className="p-6 space-y-4">
            {loginError && (
              <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs font-semibold flex items-center gap-2">
                <Icon name="error" size={16} className="shrink-0 text-red-400" />
                <span>{loginError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                Admin Username
              </label>
              <div className="relative">
                <Icon name="person" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  placeholder="Enter admin username"
                  autoFocus
                  required
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Icon name="lock" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPass ? "text" : "password"}
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  placeholder="Enter admin password"
                  required
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  <Icon name={showPass ? "visibility_off" : "visibility"} size={18} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 text-sm mt-2"
            >
              <Icon name="login" size={18} /> Log In to Dashboard
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => navigate("/exam-forms")}
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors inline-flex items-center gap-1"
              >
                <Icon name="arrow_back" size={14} /> Back to Practice Portal
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  /* ── Render Dashboard ──────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100 text-slate-800 flex flex-col font-sans antialiased">

      {/* Navbar Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-50 shadow-lg">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <button
              onClick={() => navigate("/exam-forms")}
              className="shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-lg"
              aria-label="Back to portal"
            >
              <Adda247Logo className="h-[26px] w-auto brightness-0 invert opacity-90" />
            </button>
            <span className="h-5 w-px bg-slate-700 hidden sm:block shrink-0" aria-hidden />
            <div className="min-w-0">
              <h1 className="text-sm font-extrabold tracking-tight truncate flex items-center gap-2">
                Admin Dashboard
                <span className="bg-emerald-500/20 text-emerald-400 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full border border-emerald-500/30 animate-pulse">
                  Live Analytics
                </span>
              </h1>
              <p className="text-[11px] text-slate-400 truncate hidden sm:block">
                Candidate form progress tracking & website analytics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-slate-500 hidden lg:block mr-1">
              Updated {timeAgo(lastRefreshed)}
            </span>
            <button
              onClick={loadData}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold px-3 py-2 rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <Icon name="refresh" size={14} /> Refresh
            </button>
            <button
              onClick={() => navigate("/exam-forms")}
              className="bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Icon name="arrow_back" size={14} />
              <span className="hidden sm:inline">Portal</span>
            </button>
            <button
              onClick={handleLogout}
              title="Sign out of Admin Portal"
              className="bg-slate-800 hover:bg-red-950 hover:text-red-400 text-slate-300 text-[11px] font-semibold px-3 py-2 rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
            >
              <Icon name="logout" size={14} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] mx-auto w-full px-4 sm:px-8 py-7 space-y-7">

        {/* Metric Cards Row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              label: "Website Visitors",
              value: visitorCount,
              sub: "Unique website sessions",
              icon: "visibility",
              iconBg: "bg-blue-100 text-blue-600",
              accent: "text-blue-600",
            },
            {
              label: "Start Practice Clicks",
              value: startPracticeClicks,
              sub: "Total Start Practice clicks",
              icon: "touch_app",
              iconBg: "bg-purple-100 text-purple-600",
              accent: "text-purple-600",
            },
            {
              label: "Candidates Tracked",
              value: records.length,
              sub: "Filled Basic Details",
              icon: "group",
              iconBg: "bg-violet-100 text-violet-600",
              accent: "text-violet-600",
            },
            {
              label: "In Progress / Drafts",
              value: inProgressCount,
              sub: "Candidates currently filling form",
              icon: "hourglass_top",
              iconBg: "bg-amber-100 text-amber-600",
              accent: "text-amber-600",
            },
            {
              label: "Fully Completed",
              value: completedCount,
              sub: `${records.length ? Math.round((completedCount / records.length) * 100) : 0}% completion rate`,
              icon: "check_circle",
              iconBg: "bg-emerald-100 text-emerald-600",
              accent: "text-emerald-600",
            },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 truncate">
                  {card.label}
                </p>
                <h3 className={`text-3xl font-black ${card.accent} leading-none`}>
                  {card.value.toLocaleString("en-IN")}
                </h3>
                <p className="text-[11px] text-slate-500 mt-1.5 truncate">{card.sub}</p>
              </div>
              <div className={`w-11 h-11 rounded-xl ${card.iconBg} flex items-center justify-center shrink-0`}>
                <Icon name={card.icon} size={22} />
              </div>
            </div>
          ))}
        </div>

        {/* Candidate Tracking Table & Filter Toolbar */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">

          {/* Table Header */}
          <div className="p-5 sm:p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Icon name="assignment" size={20} className="text-red-600" />
                Candidate Data & Form Progression Tracking
                <span className="text-[11px] font-semibold text-slate-400 ml-1">
                  ({filteredRecords.length}{filteredRecords.length !== records.length ? ` of ${records.length}` : ""})
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Displays candidate Name, Mobile Number, and Email ID from basic details, along with step-by-step form progression.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={exportCSV}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                <Icon name="download" size={14} /> Export CSV
              </button>
              <button onClick={clearAllData}
                className="bg-slate-100 hover:bg-red-50 hover:text-red-700 text-slate-600 text-[11px] font-semibold px-3 py-2 rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5">
                <Icon name="delete_sweep" size={14} /> Clear All
              </button>
            </div>
          </div>

          {/* Filter & Sort Bar */}
          <div className="p-4 bg-slate-50/60 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Search */}
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search candidate name, mobile, email, ID…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 transition-all"
              />
            </div>

            {/* Status Filter */}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-200 transition-all">
              <option value="ALL">All Completion Statuses</option>
              <option value="IN_PROGRESS">⏳ In Progress / Drafts</option>
              <option value="COMPLETED">✅ Fully Completed</option>
            </select>

            {/* Exam Filter */}
            <select value={examFilter} onChange={(e) => setExamFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-200 transition-all">
              <option value="ALL">All Exam Forms</option>
              <option value="IBPS-PO">IBPS PO</option>
              <option value="IBPS-CLERK">IBPS Clerk</option>
            </select>

            {/* Sort */}
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-200 transition-all">
              <option value="recent">Sort: Most Recent</option>
              <option value="name">Sort: Name A→Z</option>
              <option value="status">Sort: Status</option>
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-slate-100/60 border-b border-slate-200 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4 w-8">#</th>
                  <th className="py-3 px-4">Candidate ID</th>
                  <th className="py-3 px-4">Candidate Name</th>
                  <th className="py-3 px-4">Mobile Number</th>
                  <th className="py-3 px-4">Email ID</th>
                  <th className="py-3 px-4">Exam & State</th>
                  <th className="py-3 px-4 text-center">Completion Status & Step Left At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.length > 0 ? filteredRecords.map((rec, idx) => (
                  <tr key={rec.id + idx} className="group hover:bg-red-50/30 transition-colors">
                    {/* Sl.No */}
                    <td className="py-3.5 px-4 text-[11px] text-slate-400 font-mono">{idx + 1}</td>

                    {/* Candidate ID */}
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600 font-bold">
                      {rec.id}
                      <div className="text-[10px] text-slate-400 font-sans font-normal mt-0.5">
                        {fmtDate(rec.lastActive)}
                      </div>
                    </td>

                    {/* Candidate Name */}
                    <td className="py-3.5 px-4">
                      <div className="font-extrabold text-slate-900 text-xs">{rec.name || "Candidate"}</div>
                    </td>

                    {/* Mobile Number */}
                    <td className="py-3.5 px-4 text-xs font-semibold text-slate-800">
                      {rec.phone !== "-" ? `+91 ${rec.phone}` : "-"}
                    </td>

                    {/* Email ID */}
                    <td className="py-3.5 px-4 text-xs text-slate-700 truncate max-w-[180px]">
                      {rec.email || "-"}
                    </td>

                    {/* Exam & State */}
                    <td className="py-3.5 px-4">
                      {rec.examId !== "-" ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-extrabold ${
                          rec.examId === "IBPS-PO" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"
                        }`}>
                          {rec.examId}
                        </span>
                      ) : <span className="text-[10px] text-slate-400">—</span>}
                      {rec.state && rec.state !== "-" && (
                        <div className="text-[10px] text-slate-500 mt-1 truncate max-w-[110px]">
                          📍 {rec.state}
                        </div>
                      )}
                    </td>

                    {/* Completion Status & Step Left At */}
                    <td className="py-3.5 px-4 text-center">
                      <FormStatusBadge status={rec.formStatus} stepLeftAt={rec.stepLeftAt} />
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedCandidate(rec)}
                        className="px-2.5 py-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                      >
                        Inspect Details
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      <Icon name="inbox" size={40} className="mx-auto mb-3 text-slate-300" />
                      <p className="text-sm font-bold text-slate-500">No candidate form records found</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {searchQuery || statusFilter !== "ALL"
                          ? "Try adjusting your search or filters."
                          : "Candidate records will appear here as soon as basic details are filled in application forms."}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          {filteredRecords.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Showing <strong className="text-slate-700">{filteredRecords.length}</strong> of <strong className="text-slate-700">{records.length}</strong> candidate form entries
              </span>
              <span className="flex items-center gap-1">
                <Icon name="schedule" size={12} /> Auto-refreshes every 15s
              </span>
            </div>
          )}
        </div>
      </main>

      {/* Inspect Candidate Details Modal */}
      {selectedCandidate && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedCandidate(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 animate-[modalSlideIn_0.2s_ease-out]">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                <Icon name="account_box" size={20} className="text-red-600" />
                Candidate Details ({selectedCandidate.id})
              </h3>
              <button
                onClick={() => setSelectedCandidate(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
              <p><strong>Full Name:</strong> {selectedCandidate.name}</p>
              <p><strong>Mobile Number:</strong> {selectedCandidate.phone !== "-" ? `+91 ${selectedCandidate.phone}` : "-"}</p>
              <p><strong>Email ID:</strong> {selectedCandidate.email}</p>
              <p><strong>Exam Form:</strong> {selectedCandidate.examId}</p>
              <p><strong>State / UT:</strong> {selectedCandidate.state}</p>
              <p><strong>Category:</strong> {selectedCandidate.category}</p>
              <p><strong>Form Status:</strong> {selectedCandidate.formStatus === "COMPLETED" ? "✅ Fully Completed" : "⏳ In Progress"}</p>
              <p><strong>Step Left At:</strong> {selectedCandidate.stepLeftAt}</p>
              <p><strong>Last Active:</strong> {fmtDate(selectedCandidate.lastActive)}</p>
            </div>

            <div className="text-right pt-2">
              <button
                onClick={() => setSelectedCandidate(null)}
                className="bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Animation keyframe for modal */}
      <style>{`
        @keyframes modalSlideIn {
          from { transform: translateY(-16px) scale(0.97); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
