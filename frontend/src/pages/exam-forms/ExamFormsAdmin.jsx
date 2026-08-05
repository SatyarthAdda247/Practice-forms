// ─── src/pages/exam-forms/ExamFormsAdmin.jsx ─────────────────────────────
// Admin dashboard for the Adda247 Practice Forms portal.
//
// Architecture:
//   • Reads from THREE data sources in localStorage:
//     1. Portal logins history  (adda_portal_logins_history)
//     2. Form-persist fields    (examform:IBPS-PO:*, examform:IBPS-CLERK:*)
//     3. Practice store entries (adda247_practice_entries_v1)
//   • Cross-references initial sign-in credentials (Name, Phone, Email)
//     against the candidate's filled basic-details fields to verify
//     genuine-user integrity with field-level match/mismatch indicators.
//   • Tracks total unique website sessions via adda_website_visitor_count.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { Adda247Logo } from "../../components/GovtLogos.jsx";
import { getVisitorCount, getPortalLoginsHistory } from "../../practiceUser.js";
import { practiceStore } from "../../tools/lib/practiceStore.js";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Normalise a name for fuzzy comparison: lowercase, only a-z, no spaces. */
function normName(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, "");
}

/** Normalise a phone string to its last 10 digits. */
function normPhone(s) {
  const d = (s || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

/** Normalise an email for comparison. */
function normEmail(s) {
  return (s || "").toLowerCase().trim();
}

/** Read all form-persist localStorage keys for a given exam namespace. */
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
  } catch { /* storage disabled */ }
  return data;
}

/** Format a date string to a human-readable form. */
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

/** Format a relative-time string ("2 hours ago", "just now"). */
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

  // ── Dashboard state (only used when authenticated) ──
  const [visitorCount, setVisitorCount] = useState(0);
  const [loginsHistory, setLoginsHistory] = useState([]);
  const [storeEntries, setStoreEntries] = useState([]);
  const [formPersistPO, setFormPersistPO] = useState({});
  const [formPersistClerk, setFormPersistClerk] = useState({});

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [examFilter, setExamFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("recent"); // recent | name | status
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(new Date().toISOString());

  const loadData = useCallback(() => {
    setVisitorCount(getVisitorCount());
    setLoginsHistory(getPortalLoginsHistory());
    setStoreEntries(practiceStore.getAllEntries());
    setFormPersistPO(readFormPersistKeys("IBPS-PO"));
    setFormPersistClerk(readFormPersistKeys("IBPS-CLERK"));
    setLastRefreshed(new Date().toISOString());
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

    // Stable ID generator — seeded by phone so it doesn't randomise on re-render.
    const stableId = (seed) => "REG-" + Math.abs(
      (seed || "x").split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
    ).toString().slice(0, 6).padStart(6, "0");

    // 1. Portal sign-in entries
    loginsHistory.forEach((login) => {
      const key = normPhone(login.phone) || normEmail(login.email) || login.id || "";
      if (!key) return;
      map.set(key, {
        id: login.id || stableId(key),
        loginName: login.name || "",
        loginPhone: login.phone || "",
        loginEmail: login.email || "",
        loginTimestamp: login.timestamp || login.lastActive || "",
        lastActive: login.lastActive || login.timestamp || "",
        basicName: "",
        basicPhone: "",
        basicEmail: "",
        examId: "",
        state: "",
        category: "",
        currentStep: "Portal Login",
        isSubmitted: false,
      });
    });

    // 2. form-persist localStorage snapshots (IBPS-PO and IBPS-CLERK)
    [
      { ns: "IBPS-PO", snap: formPersistPO },
      { ns: "IBPS-CLERK", snap: formPersistClerk },
    ].forEach(({ ns, snap }) => {
      const fn  = snap["id:txtfirstname"] || "";
      const mn  = snap["id:txtmiddlename"] || "";
      const ln  = snap["id:txtlastname"] || "";
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

      if (!fullName && !mob && !fullEmail) return; // nothing filled

      const key = normPhone(mob) || normEmail(fullEmail) || ("form-" + ns);
      const existing = map.get(key) || {
        id: stableId(key),
        loginName: "",
        loginPhone: "",
        loginEmail: "",
        loginTimestamp: "",
        lastActive: "",
      };

      // Determine form step from the max step counter
      const maxStep = parseInt(snap["__maxstep"] || "0", 10);
      const stepLabels = [
        "Basic Information", "OTP Verification", "Photo & Signature",
        "Details", "Preview", "Uploads", "Payment"
      ];
      const stepLabel = stepLabels[maxStep] || `Step ${maxStep + 1}`;

      map.set(key, {
        ...existing,
        basicName: fullName,
        basicPhone: mob,
        basicEmail: fullEmail,
        examId: ns,
        state,
        category,
        dob,
        gender,
        currentStep: stepLabel,
        lastActive: new Date().toISOString(),
      });
    });

    // 3. practiceStore entries (DynamoDB-modelled localStorage)
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

      const existing = map.get(key) || {
        id: stableId(key),
        loginName: fullName || sd.name || "",
        loginPhone: mob || (/^\d{10}$/.test(identifier) ? identifier : ""),
        loginEmail: email || (identifier.includes("@") ? identifier : ""),
        loginTimestamp: entry.createdAt || "",
        lastActive: entry.updatedAt || entry.createdAt || "",
      };

      map.set(key, {
        ...existing,
        basicName: fullName || existing.basicName || "",
        basicPhone: mob || existing.basicPhone || "",
        basicEmail: email || existing.basicEmail || "",
        examId: examId || existing.examId || "",
        currentStep: entry.isSubmitted ? "Submitted ✓" : `Step ${entry.currentStep || 1}`,
        isSubmitted: Boolean(entry.isSubmitted),
        lastActive: entry.updatedAt || existing.lastActive || "",
      });
    });

    // 4. Compute field-level match flags and overall verification status
    const results = Array.from(map.values()).map((rec) => {
      const hasBasic = rec.basicName || rec.basicPhone || rec.basicEmail;
      const hasLogin = rec.loginName || rec.loginPhone || rec.loginEmail;

      if (!hasBasic || !hasLogin) {
        return { ...rec, nameMatch: null, phoneMatch: null, emailMatch: null, verificationStatus: "PENDING" };
      }

      const nameMatch  = normName(rec.loginName) && normName(rec.basicName) &&
        (normName(rec.loginName).includes(normName(rec.basicName)) ||
         normName(rec.basicName).includes(normName(rec.loginName)));
      const phoneMatch = normPhone(rec.loginPhone) && normPhone(rec.basicPhone) &&
        normPhone(rec.loginPhone) === normPhone(rec.basicPhone);
      const emailMatch = normEmail(rec.loginEmail) && normEmail(rec.basicEmail) &&
        normEmail(rec.loginEmail) === normEmail(rec.basicEmail);

      const matched = [nameMatch, phoneMatch, emailMatch].filter(Boolean).length;
      let verificationStatus = "MISMATCH";
      if (matched === 3)                                    verificationStatus = "GENUINE";
      else if (matched === 2 || (phoneMatch && nameMatch))  verificationStatus = "GENUINE";
      else if (matched === 1)                               verificationStatus = "PARTIAL";

      return { ...rec, nameMatch, phoneMatch, emailMatch, verificationStatus };
    });

    // Sort
    results.sort((a, b) => {
      if (sortBy === "name") return (a.loginName || "").localeCompare(b.loginName || "");
      if (sortBy === "status") {
        const order = { MISMATCH: 0, PARTIAL: 1, PENDING: 2, GENUINE: 3 };
        return (order[a.verificationStatus] || 0) - (order[b.verificationStatus] || 0);
      }
      // recent (default)
      return new Date(b.lastActive || 0) - new Date(a.lastActive || 0);
    });

    return results;
  }, [loginsHistory, formPersistPO, formPersistClerk, storeEntries, sortBy]);

  /* ── Filtering ────────────────────────────────────────────────────────── */

  const filteredRecords = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return records.filter((rec) => {
      const matchSearch = !q ||
        (rec.loginName || "").toLowerCase().includes(q) ||
        (rec.loginPhone || "").includes(q) ||
        (rec.loginEmail || "").toLowerCase().includes(q) ||
        (rec.basicName || "").toLowerCase().includes(q) ||
        (rec.basicPhone || "").includes(q) ||
        (rec.basicEmail || "").toLowerCase().includes(q) ||
        (rec.id || "").toLowerCase().includes(q);
      const matchStatus = statusFilter === "ALL" || rec.verificationStatus === statusFilter;
      const matchExam = examFilter === "ALL" || rec.examId === examFilter || (!rec.examId && examFilter === "ALL");
      return matchSearch && matchStatus && matchExam;
    });
  }, [records, searchQuery, statusFilter, examFilter]);

  /* ── Derived stats ────────────────────────────────────────────────────── */

  const genuineCount = records.filter(r => r.verificationStatus === "GENUINE").length;
  const partialCount = records.filter(r => r.verificationStatus === "PARTIAL").length;
  const mismatchCount = records.filter(r => r.verificationStatus === "MISMATCH").length;
  const pendingCount = records.filter(r => r.verificationStatus === "PENDING").length;
  const submittedCount = records.filter(r => r.isSubmitted).length;

  /* ── Export to CSV ────────────────────────────────────────────────────── */

  function exportCSV() {
    const headers = [
      "Sl.No", "Candidate ID", "Login Name", "Login Mobile", "Login Email",
      "Form Name", "Form Mobile", "Form Email", "Exam Form", "State/UT",
      "Category", "Current Step", "Submitted", "Name Match", "Phone Match",
      "Email Match", "Verification Status", "Login Timestamp", "Last Active"
    ];
    const rows = filteredRecords.map((r, i) => [
      i + 1,
      `"${r.id}"`, `"${r.loginName}"`, `"${r.loginPhone}"`, `"${r.loginEmail}"`,
      `"${r.basicName}"`, `"${r.basicPhone}"`, `"${r.basicEmail}"`,
      `"${r.examId || "-"}"`, `"${r.state || "-"}"`,
      `"${r.category || "-"}"`, `"${r.currentStep}"`,
      r.isSubmitted ? "Yes" : "No",
      r.nameMatch === null ? "N/A" : r.nameMatch ? "Yes" : "No",
      r.phoneMatch === null ? "N/A" : r.phoneMatch ? "Yes" : "No",
      r.emailMatch === null ? "N/A" : r.emailMatch ? "Yes" : "No",
      `"${r.verificationStatus}"`,
      `"${r.loginTimestamp}"`, `"${r.lastActive}"`
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adda247_candidate_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Clear all data ───────────────────────────────────────────────────── */

  function clearAllData() {
    if (!window.confirm(
      "⚠️ This will permanently erase ALL candidate tracking data, visitor analytics, and form entries.\n\nAre you sure?"
    )) return;
    try {
      localStorage.removeItem("adda_portal_logins_history");
      localStorage.removeItem("adda_website_visitor_count");
      localStorage.removeItem("adda247_practice_entries_v1");
      // Clear form-persist keys
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith("examform:")) localStorage.removeItem(k);
      });
    } catch { /* ignore */ }
    sessionStorage.clear();
    loadData();
  }

  /* ── Status badge renderer ────────────────────────────────────────────── */

  function StatusBadge({ status }) {
    const cfg = {
      GENUINE: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800", icon: "verified", label: "Genuine" },
      PARTIAL: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", icon: "error_outline", label: "Partial Match" },
      MISMATCH: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", icon: "gpp_bad", label: "Mismatch" },
      PENDING: { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-600", icon: "hourglass_top", label: "Pending" },
    };
    const c = cfg[status] || cfg.PENDING;
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${c.bg} ${c.text} border ${c.border}`}>
        <Icon name={c.icon} size={13} /> {c.label}
      </span>
    );
  }

  /* ── Field match indicator (for inspect modal) ────────────────────────── */

  function MatchDot({ match }) {
    if (match === null || match === undefined) {
      return <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium"><Icon name="remove" size={12} /> N/A</span>;
    }
    return match
      ? <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-bold"><Icon name="check_circle" size={12} /> Match</span>
      : <span className="inline-flex items-center gap-1 text-[10px] text-red-600 font-bold"><Icon name="cancel" size={12} /> Mismatch</span>;
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100 text-slate-800 flex flex-col font-sans antialiased">

      {/* ═══ Top Navbar ═══ */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-50 shadow-lg">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          {/* Left: Logo + Title */}
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
                  Live
                </span>
              </h1>
              <p className="text-[11px] text-slate-400 truncate hidden sm:block">
                Candidate tracking, data verification & analytics
              </p>
            </div>
          </div>

          {/* Right: Controls */}
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

      {/* ═══ Main ═══ */}
      <main className="flex-1 max-w-[1440px] mx-auto w-full px-4 sm:px-8 py-7 space-y-7">

        {/* ── Metric Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              label: "Website Visitors",
              value: visitorCount,
              sub: "Unique sessions tracked",
              icon: "visibility",
              iconBg: "bg-blue-100 text-blue-600",
              accent: "text-blue-600",
            },
            {
              label: "Portal Sign-Ins",
              value: loginsHistory.length,
              sub: "Name + Phone + Email",
              icon: "person_add",
              iconBg: "bg-violet-100 text-violet-600",
              accent: "text-violet-600",
            },
            {
              label: "Genuine Users",
              value: genuineCount,
              sub: records.length ? `${Math.round((genuineCount / records.length) * 100)}% verified` : "—",
              icon: "verified_user",
              iconBg: "bg-emerald-100 text-emerald-600",
              accent: "text-emerald-600",
            },
            {
              label: "Mismatched",
              value: mismatchCount + partialCount,
              sub: `${mismatchCount} bad · ${partialCount} partial`,
              icon: "gpp_maybe",
              iconBg: "bg-amber-100 text-amber-600",
              accent: "text-amber-600",
            },
            {
              label: "Submissions",
              value: submittedCount,
              sub: `${pendingCount} still in progress`,
              icon: "task_alt",
              iconBg: "bg-teal-100 text-teal-600",
              accent: "text-teal-600",
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

        {/* ── Candidate Table Card ── */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">

          {/* Table Header */}
          <div className="p-5 sm:p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Icon name="group" size={20} className="text-red-600" />
                Candidate Data & Verification
                <span className="text-[11px] font-semibold text-slate-400 ml-1">
                  ({filteredRecords.length}{filteredRecords.length !== records.length ? ` of ${records.length}` : ""})
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Cross-validates initial login credentials against form details to flag discrepancies.
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
                placeholder="Search name, mobile, email, ID…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 transition-all"
              />
            </div>

            {/* Verification Status */}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-200 transition-all">
              <option value="ALL">All Statuses</option>
              <option value="GENUINE">✅ Genuine</option>
              <option value="PARTIAL">⚠️ Partial Match</option>
              <option value="MISMATCH">❌ Mismatch</option>
              <option value="PENDING">⏳ Pending</option>
            </select>

            {/* Exam Filter */}
            <select value={examFilter} onChange={(e) => setExamFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-200 transition-all">
              <option value="ALL">All Exams</option>
              <option value="IBPS-PO">IBPS PO</option>
              <option value="IBPS-CLERK">IBPS Clerk</option>
            </select>

            {/* Sort */}
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-200 transition-all">
              <option value="recent">Sort: Most Recent</option>
              <option value="name">Sort: Name A→Z</option>
              <option value="status">Sort: Issues First</option>
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-slate-100/60 border-b border-slate-200 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4 w-8">#</th>
                  <th className="py-3 px-4">Candidate</th>
                  <th className="py-3 px-4">Initial Sign-In Data</th>
                  <th className="py-3 px-4">Form Basic Details</th>
                  <th className="py-3 px-4">Exam Info</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Step</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.length > 0 ? filteredRecords.map((rec, idx) => (
                  <tr key={rec.id + idx} className="group hover:bg-red-50/30 transition-colors">
                    {/* Sl.No */}
                    <td className="py-3 px-4 text-[11px] text-slate-400 font-mono">{idx + 1}</td>

                    {/* Candidate ID + Avatar */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 uppercase ${
                            rec.verificationStatus === "GENUINE" ? "bg-emerald-100 text-emerald-700" :
                            rec.verificationStatus === "MISMATCH" ? "bg-red-100 text-red-700" :
                            rec.verificationStatus === "PARTIAL" ? "bg-amber-100 text-amber-700" :
                            "bg-slate-200 text-slate-500"
                          }`}
                        >
                          {(rec.loginName || "?").charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate max-w-[120px]">{rec.loginName || "—"}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{rec.id}</div>
                        </div>
                      </div>
                    </td>

                    {/* Initial Sign-In */}
                    <td className="py-3 px-4">
                      <div className="space-y-0.5 text-[11px]">
                        <div className="text-slate-800 font-semibold truncate max-w-[160px]">{rec.loginName || "—"}</div>
                        <div className="text-slate-500 flex items-center gap-1">
                          <Icon name="phone_iphone" size={11} className="text-slate-400" /> {rec.loginPhone || "—"}
                        </div>
                        <div className="text-slate-500 flex items-center gap-1 truncate max-w-[160px]">
                          <Icon name="mail" size={11} className="text-slate-400" /> {rec.loginEmail || "—"}
                        </div>
                      </div>
                    </td>

                    {/* Form Basic Details */}
                    <td className="py-3 px-4">
                      <div className="space-y-0.5 text-[11px]">
                        <div className={`font-semibold truncate max-w-[160px] ${
                          rec.nameMatch === true ? "text-emerald-700" : rec.nameMatch === false ? "text-red-700" : "text-slate-800"
                        }`}>
                          {rec.basicName || "—"}
                        </div>
                        <div className={`flex items-center gap-1 ${
                          rec.phoneMatch === true ? "text-emerald-600" : rec.phoneMatch === false ? "text-red-600" : "text-slate-500"
                        }`}>
                          <Icon name="phone_iphone" size={11} /> {rec.basicPhone || "—"}
                        </div>
                        <div className={`flex items-center gap-1 truncate max-w-[160px] ${
                          rec.emailMatch === true ? "text-emerald-600" : rec.emailMatch === false ? "text-red-600" : "text-slate-500"
                        }`}>
                          <Icon name="mail" size={11} /> {rec.basicEmail || "—"}
                        </div>
                      </div>
                    </td>

                    {/* Exam Info */}
                    <td className="py-3 px-4">
                      {rec.examId ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-extrabold ${
                          rec.examId === "IBPS-PO" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"
                        }`}>
                          {rec.examId}
                        </span>
                      ) : <span className="text-[10px] text-slate-400">—</span>}
                      {rec.state && (
                        <div className="text-[10px] text-slate-500 mt-1 truncate max-w-[100px]">
                          {rec.state}
                        </div>
                      )}
                    </td>

                    {/* Verification Status */}
                    <td className="py-3 px-4 text-center">
                      <StatusBadge status={rec.verificationStatus} />
                    </td>

                    {/* Current Step */}
                    <td className="py-3 px-4 text-center">
                      <span className={`text-[11px] font-semibold ${rec.isSubmitted ? "text-emerald-700" : "text-slate-600"}`}>
                        {rec.currentStep}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedCandidate(rec)}
                        className="px-2.5 py-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors opacity-70 group-hover:opacity-100"
                      >
                        <Icon name="open_in_new" size={13} />
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      <Icon name="inbox" size={40} className="mx-auto mb-3 text-slate-300" />
                      <p className="text-sm font-bold text-slate-500">No candidate records found</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {searchQuery || statusFilter !== "ALL"
                          ? "Try adjusting your search or filters."
                          : "Candidates will appear here once they enter through the portal gate."}
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
                Showing <strong className="text-slate-700">{filteredRecords.length}</strong> of <strong className="text-slate-700">{records.length}</strong> candidates
              </span>
              <span className="flex items-center gap-1">
                <Icon name="schedule" size={12} /> Auto-refreshes every 15s
              </span>
            </div>
          )}
        </div>
      </main>

      {/* ═══ Candidate Inspect Modal ═══ */}
      {selectedCandidate && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedCandidate(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto animate-[modalSlideIn_0.2s_ease-out]">
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold uppercase shrink-0 ${
                    selectedCandidate.verificationStatus === "GENUINE" ? "bg-emerald-100 text-emerald-700" :
                    selectedCandidate.verificationStatus === "MISMATCH" ? "bg-red-100 text-red-700" :
                    "bg-amber-100 text-amber-700"
                  }`}
                >
                  {(selectedCandidate.loginName || "?").charAt(0)}
                </div>
                <div className="min-w-0">
                  <h3 className="font-extrabold text-slate-900 text-sm truncate">
                    {selectedCandidate.loginName || "Candidate"}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">{selectedCandidate.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCandidate(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Overall Verdict */}
              <div className={`p-4 rounded-xl border-2 flex items-center gap-3 ${
                selectedCandidate.verificationStatus === "GENUINE"
                  ? "bg-emerald-50 border-emerald-200"
                  : selectedCandidate.verificationStatus === "MISMATCH"
                  ? "bg-red-50 border-red-200"
                  : selectedCandidate.verificationStatus === "PARTIAL"
                  ? "bg-amber-50 border-amber-200"
                  : "bg-slate-50 border-slate-200"
              }`}>
                <Icon
                  name={
                    selectedCandidate.verificationStatus === "GENUINE" ? "verified_user" :
                    selectedCandidate.verificationStatus === "MISMATCH" ? "gpp_bad" :
                    selectedCandidate.verificationStatus === "PARTIAL" ? "gpp_maybe" :
                    "hourglass_top"
                  }
                  size={28}
                  className={
                    selectedCandidate.verificationStatus === "GENUINE" ? "text-emerald-600" :
                    selectedCandidate.verificationStatus === "MISMATCH" ? "text-red-600" :
                    selectedCandidate.verificationStatus === "PARTIAL" ? "text-amber-600" :
                    "text-slate-500"
                  }
                />
                <div>
                  <div className="text-sm font-extrabold">
                    {selectedCandidate.verificationStatus === "GENUINE" && "✅ Genuine User — Data Verified"}
                    {selectedCandidate.verificationStatus === "PARTIAL" && "⚠️ Partial Match — Review Recommended"}
                    {selectedCandidate.verificationStatus === "MISMATCH" && "❌ Data Mismatch — Inconsistent Entries"}
                    {selectedCandidate.verificationStatus === "PENDING" && "⏳ Verification Pending — Form Not Completed"}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Initial sign-in credentials are compared field-by-field against form basic details.
                  </p>
                </div>
              </div>

              {/* Side-by-Side Data Comparison */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="py-2.5 px-4 text-left font-extrabold">Field</th>
                      <th className="py-2.5 px-4 text-left font-extrabold">Initial Login</th>
                      <th className="py-2.5 px-4 text-left font-extrabold">Form Details</th>
                      <th className="py-2.5 px-4 text-center font-extrabold">Match</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-bold text-slate-700">Full Name</td>
                      <td className="py-2.5 px-4 text-slate-800">{selectedCandidate.loginName || "—"}</td>
                      <td className="py-2.5 px-4 text-slate-800">{selectedCandidate.basicName || "—"}</td>
                      <td className="py-2.5 px-4 text-center"><MatchDot match={selectedCandidate.nameMatch} /></td>
                    </tr>
                    <tr className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-bold text-slate-700">Mobile No.</td>
                      <td className="py-2.5 px-4 text-slate-800">{selectedCandidate.loginPhone ? "+91 " + selectedCandidate.loginPhone : "—"}</td>
                      <td className="py-2.5 px-4 text-slate-800">{selectedCandidate.basicPhone ? "+91 " + selectedCandidate.basicPhone : "—"}</td>
                      <td className="py-2.5 px-4 text-center"><MatchDot match={selectedCandidate.phoneMatch} /></td>
                    </tr>
                    <tr className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-bold text-slate-700">Email ID</td>
                      <td className="py-2.5 px-4 text-slate-800 break-all">{selectedCandidate.loginEmail || "—"}</td>
                      <td className="py-2.5 px-4 text-slate-800 break-all">{selectedCandidate.basicEmail || "—"}</td>
                      <td className="py-2.5 px-4 text-center"><MatchDot match={selectedCandidate.emailMatch} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Additional Info Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { label: "Exam Form", value: selectedCandidate.examId || "—", icon: "description" },
                  { label: "State / UT", value: selectedCandidate.state || "—", icon: "location_on" },
                  { label: "Category", value: selectedCandidate.category || "—", icon: "badge" },
                  { label: "Current Step", value: selectedCandidate.currentStep, icon: "fact_check" },
                  { label: "Login Time", value: fmtDate(selectedCandidate.loginTimestamp), icon: "login" },
                  { label: "Last Active", value: fmtDate(selectedCandidate.lastActive), icon: "schedule" },
                ].map((item) => (
                  <div key={item.label} className="bg-slate-50 rounded-lg p-3 border border-slate-100 flex items-start gap-2">
                    <Icon name={item.icon} size={14} className="text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">{item.label}</div>
                      <div className="font-semibold text-slate-800 mt-0.5">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-3 flex justify-end rounded-b-2xl">
              <button
                onClick={() => setSelectedCandidate(null)}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-5 py-2 rounded-lg transition-colors"
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
