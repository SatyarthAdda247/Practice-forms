// ─── src/pages/exam-forms/ExamFormsAdmin.jsx ─────────────────────────────
// Admin dashboard for tracking practice form entries, total website visitors,
// portal sign-ins, and verifying genuine users by cross-matching initial login
// credentials (Name, Mobile No, Email ID) against form basic details.

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { getVisitorCount, getPortalLoginsHistory } from "../../practiceUser.js";
import { practiceStore } from "../../tools/lib/practiceStore.js";

export default function ExamFormsAdmin() {
  const [visitorCount, setVisitorCount] = useState(0);
  const [loginsHistory, setLoginsHistory] = useState([]);
  const [formEntries, setFormEntries] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [examFilter, setExamFilter] = useState("ALL");
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  function loadData() {
    setVisitorCount(getVisitorCount());
    const logins = getPortalLoginsHistory();
    setLoginsHistory(logins);

    // Read stored form entries from practiceStore + localStorage keys
    const entries = practiceStore.getAllEntries();
    setFormEntries(entries);
  }

  // Cross-reference initial login credentials with form basic details
  function getCandidateRecords() {
    const recordsMap = new Map();

    // 1. Process portal initial sign-ins
    loginsHistory.forEach((login) => {
      const key = (login.phone || login.email || login.id).toLowerCase();
      recordsMap.set(key, {
        id: login.id || "REG-" + Math.floor(100000 + Math.random() * 900000),
        loginName: login.name || "-",
        loginPhone: login.phone || "-",
        loginEmail: login.email || "-",
        loginTimestamp: login.timestamp || new Date().toISOString(),
        basicName: "-",
        basicPhone: "-",
        basicEmail: "-",
        examId: "-",
        state: "-",
        category: "-",
        currentStep: "Portal Login",
        isSubmitted: false,
        nameMatch: false,
        phoneMatch: false,
        emailMatch: false,
        verificationStatus: "PENDING",
      });
    });

    // 2. Read direct form storage keys (examform:IBPS-PO & examform:IBPS-CLERK)
    ["IBPS-PO", "IBPS-CLERK"].forEach((examId) => {
      try {
        const prefix = `examform:${examId}:`;
        let fn = localStorage.getItem(prefix + "id:txtfirstname") || "";
        let mn = localStorage.getItem(prefix + "id:txtmiddlename") || "";
        let ln = localStorage.getItem(prefix + "id:txtlastname") || "";
        let mobile = localStorage.getItem(prefix + "id:txtmobile") || "";
        let email = localStorage.getItem(prefix + "id:txtemail") || "";
        let dom = localStorage.getItem(prefix + "id:seldomain") || "";
        let state = localStorage.getItem(prefix + "id:selExamState") || localStorage.getItem(prefix + "id:selVacancyState") || "";
        let category = localStorage.getItem(prefix + "name:category") || "";

        let fullEmail = email ? (email.includes("@") ? email : email + "@" + dom) : "";
        let fullName = [fn, mn, ln].filter(Boolean).join(" ");

        if (fullName || mobile || fullEmail) {
          const key = (mobile || fullEmail || "form-" + examId).toLowerCase();
          const existing = recordsMap.get(key) || {
            id: "REG-" + Math.floor(100000 + Math.random() * 900000),
            loginName: fullName || "Anonymous User",
            loginPhone: mobile || "-",
            loginEmail: fullEmail || "-",
            loginTimestamp: new Date().toISOString(),
          };

          recordsMap.set(key, {
            ...existing,
            basicName: fullName || existing.basicName || "-",
            basicPhone: mobile || existing.basicPhone || "-",
            basicEmail: fullEmail || existing.basicEmail || "-",
            examId: examId,
            state: state || existing.state || "-",
            category: category || existing.category || "-",
            currentStep: "Form Filling",
          });
        }
      } catch (e) {
        console.error("Error reading exam storage keys:", e);
      }
    });

    // 3. Process practiceStore entries
    formEntries.forEach((entry) => {
      const stepData = entry.stepData || {};
      const mobile = stepData.mobile || stepData.txtmobile || entry.PK?.replace("STUDENT#", "") || "";
      const email = stepData.email || stepData.txtemail || "";
      const fn = stepData.txtfirstname || stepData.first_name || "";
      const ln = stepData.txtlastname || stepData.last_name || "";
      const fullName = [fn, ln].filter(Boolean).join(" ") || stepData.fullName || "";
      const examId = entry.SK?.replace("EXAM#", "") || "IBPS-PO";

      const key = (mobile || email || entry.PK).toLowerCase();
      const existing = recordsMap.get(key) || {
        id: "REG-" + Math.floor(100000 + Math.random() * 900000),
        loginName: fullName || "Candidate",
        loginPhone: mobile || "-",
        loginEmail: email || "-",
        loginTimestamp: entry.createdAt || new Date().toISOString(),
      };

      recordsMap.set(key, {
        ...existing,
        basicName: fullName || existing.basicName || "-",
        basicPhone: mobile || existing.basicPhone || "-",
        basicEmail: email || existing.basicEmail || "-",
        examId: examId,
        currentStep: entry.isSubmitted ? "Submitted (Completed)" : `Step ${entry.currentStep || 1}`,
        isSubmitted: Boolean(entry.isSubmitted),
      });
    });

    // 4. Compute verification & match flags for each record
    const records = Array.from(recordsMap.values()).map((rec) => {
      if (rec.basicName === "-" && rec.basicPhone === "-" && rec.basicEmail === "-") {
        return { ...rec, verificationStatus: "PENDING" };
      }

      const lName = rec.loginName.toLowerCase().replace(/[^a-z]/g, "");
      const bName = rec.basicName.toLowerCase().replace(/[^a-z]/g, "");
      const nameMatch = lName && bName && (lName.includes(bName) || bName.includes(lName));

      const lPhone = rec.loginPhone.replace(/\D/g, "");
      const bPhone = rec.basicPhone.replace(/\D/g, "");
      const phoneMatch = lPhone && bPhone && lPhone === bPhone;

      const lEmail = rec.loginEmail.toLowerCase().trim();
      const bEmail = rec.basicEmail.toLowerCase().trim();
      const emailMatch = lEmail && bEmail && lEmail === bEmail;

      const matchesCount = [nameMatch, phoneMatch, emailMatch].filter(Boolean).length;

      let verificationStatus = "MISMATCH";
      if (matchesCount === 3 || (nameMatch && phoneMatch) || (phoneMatch && emailMatch)) {
        verificationStatus = "GENUINE";
      } else if (matchesCount >= 1) {
        verificationStatus = "PARTIAL";
      }

      return {
        ...rec,
        nameMatch,
        phoneMatch,
        emailMatch,
        verificationStatus,
      };
    });

    return records;
  }

  const records = getCandidateRecords();

  // Filter records
  const filteredRecords = records.filter((rec) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      rec.loginName.toLowerCase().includes(q) ||
      rec.loginPhone.includes(q) ||
      rec.loginEmail.toLowerCase().includes(q) ||
      rec.basicName.toLowerCase().includes(q) ||
      rec.id.toLowerCase().includes(q);

    const matchesStatus =
      statusFilter === "ALL" ||
      rec.verificationStatus === statusFilter;

    const matchesExam =
      examFilter === "ALL" ||
      rec.examId === examFilter;

    return matchesSearch && matchesStatus && matchesExam;
  });

  const genuineCount = records.filter((r) => r.verificationStatus === "GENUINE").length;
  const mismatchCount = records.filter((r) => r.verificationStatus === "MISMATCH").length;
  const pendingCount = records.filter((r) => r.verificationStatus === "PENDING").length;

  function exportCSV() {
    const headers = [
      "Candidate ID",
      "Initial Login Name",
      "Initial Login Mobile",
      "Initial Login Email",
      "Form Basic Name",
      "Form Basic Mobile",
      "Form Basic Email",
      "Exam Form",
      "State",
      "Category",
      "Form Step",
      "Verification Status",
      "Timestamp"
    ];

    const rows = filteredRecords.map((r) => [
      r.id,
      `"${r.loginName}"`,
      `"${r.loginPhone}"`,
      `"${r.loginEmail}"`,
      `"${r.basicName}"`,
      `"${r.basicPhone}"`,
      `"${r.basicEmail}"`,
      `"${r.examId}"`,
      `"${r.state}"`,
      `"${r.category}"`,
      `"${r.currentStep}"`,
      `"${r.verificationStatus}"`,
      `"${r.loginTimestamp}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `candidate_tracking_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function clearAllData() {
    if (window.confirm("Are you sure you want to clear all candidate tracking and visitor analytics data?")) {
      localStorage.removeItem("adda_portal_logins_history");
      localStorage.removeItem("adda_website_visitor_count");
      localStorage.removeItem("adda247_practice_entries_v1");
      sessionStorage.clear();
      loadData();
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col font-sans antialiased">
      {/* Navbar Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-50 px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center text-white font-extrabold text-lg shadow-md">
            A
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
              Adda247 Form Practice — Admin Tracking Panel
              <span className="bg-red-500/20 text-red-400 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border border-red-500/30">
                Live Data
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Track website visitors, candidate sign-ins, and verify genuine users across application forms.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Icon name="refresh" size={14} /> Refresh
          </button>
          <Link
            to="/exam-forms"
            className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Icon name="arrow_back" size={14} /> Back to Portal
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-8 py-8 space-y-8">
        {/* Metric Cards Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Total Visitors */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Total Website Visitors
              </p>
              <h3 className="text-3xl font-black text-slate-900">{visitorCount}</h3>
              <p className="text-[11px] text-emerald-600 font-semibold mt-1 flex items-center gap-1">
                <Icon name="trending_up" size={12} /> Total portal hits recorded
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Icon name="visibility" size={24} />
            </div>
          </div>

          {/* Portal Logins */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Portal Sign-Ins
              </p>
              <h3 className="text-3xl font-black text-slate-900">{loginsHistory.length}</h3>
              <p className="text-[11px] text-slate-500 font-medium mt-1">
                Name + Mobile + Email logged
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Icon name="assignment_ind" size={24} />
            </div>
          </div>

          {/* Genuine Verified Users */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Verified Genuine Users
              </p>
              <h3 className="text-3xl font-black text-emerald-600">{genuineCount}</h3>
              <p className="text-[11px] text-emerald-600 font-semibold mt-1">
                {records.length > 0 ? Math.round((genuineCount / records.length) * 100) : 0}% Initial vs Basic Match
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Icon name="verified" size={24} />
            </div>
          </div>

          {/* Mismatch / Unverified */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Mismatched / Pending
              </p>
              <h3 className="text-3xl font-black text-amber-600">{mismatchCount + pendingCount}</h3>
              <p className="text-[11px] text-amber-600 font-semibold mt-1">
                {mismatchCount} mismatched • {pendingCount} incomplete
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Icon name="warning" size={24} />
            </div>
          </div>
        </div>

        {/* Candidate Tracking Table & Filter Toolbar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Table Header & Controls */}
          <div className="p-6 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <Icon name="group" size={20} className="text-red-600" /> Candidate Data & Verification Records
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Validates whether Name, Mobile No, and Email ID match between initial sign-in and form basic details.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={exportCSV}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Icon name="download" size={14} /> Export CSV
              </button>
              <button
                onClick={clearAllData}
                className="bg-slate-200 hover:bg-red-100 hover:text-red-700 text-slate-700 text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Icon name="delete" size={14} /> Clear Records
              </button>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="p-4 bg-white border-b border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Search */}
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Candidate Name, Mobile, Email, Reg ID..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
              />
            </div>

            {/* Verification Status Filter */}
            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-red-200"
              >
                <option value="ALL">All Verification Statuses</option>
                <option value="GENUINE">✅ Genuine Users Only</option>
                <option value="MISMATCH">❌ Mismatches Only</option>
                <option value="PENDING">⏳ Form Incomplete / Pending</option>
              </select>
            </div>

            {/* Exam Filter */}
            <div>
              <select
                value={examFilter}
                onChange={(e) => setExamFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-red-200"
              >
                <option value="ALL">All Exam Forms</option>
                <option value="IBPS-PO">IBPS PO</option>
                <option value="IBPS-CLERK">IBPS Clerk</option>
              </select>
            </div>
          </div>

          {/* Data Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                  <th className="py-3 px-4">Candidate ID</th>
                  <th className="py-3 px-4">Initial Sign-In Data</th>
                  <th className="py-3 px-4">Form Basic Details</th>
                  <th className="py-3 px-4">Exam & State</th>
                  <th className="py-3 px-4">Verification Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredRecords.length > 0 ? (
                  filteredRecords.map((rec, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      {/* ID */}
                      <td className="py-3.5 px-4 font-mono text-slate-500 font-semibold">
                        {rec.id}
                        <div className="text-[10px] text-slate-400 font-sans">
                          {new Date(rec.loginTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      {/* Initial Sign-In */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{rec.loginName}</div>
                        <div className="text-[11px] text-slate-600">📱 +91 {rec.loginPhone}</div>
                        <div className="text-[11px] text-slate-500">✉️ {rec.loginEmail}</div>
                      </td>

                      {/* Form Basic Details */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800">{rec.basicName}</div>
                        <div className="text-[11px] text-slate-600">📱 {rec.basicPhone !== "-" ? `+91 ${rec.basicPhone}` : "-"}</div>
                        <div className="text-[11px] text-slate-500">✉️ {rec.basicEmail}</div>
                      </td>

                      {/* Exam & State */}
                      <td className="py-3.5 px-4">
                        <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 font-extrabold rounded text-[10px]">
                          {rec.examId}
                        </span>
                        <div className="text-[11px] text-slate-500 mt-1">
                          📍 {rec.state !== "-" ? rec.state : "State Unselected"}
                        </div>
                      </td>

                      {/* Verification Status */}
                      <td className="py-3.5 px-4">
                        {rec.verificationStatus === "GENUINE" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <Icon name="check_circle" size={13} /> Genuine User
                          </span>
                        )}
                        {rec.verificationStatus === "PARTIAL" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                            <Icon name="error_outline" size={13} /> Partial Match
                          </span>
                        )}
                        {rec.verificationStatus === "MISMATCH" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-red-100 text-red-800 border border-red-300">
                            <Icon name="cancel" size={13} /> Mismatched Data
                          </span>
                        )}
                        {rec.verificationStatus === "PENDING" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-300">
                            <Icon name="hourglass_empty" size={13} /> Form Pending
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => setSelectedCandidate(rec)}
                          className="px-2.5 py-1 text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        >
                          Inspect Details
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <Icon name="search_off" size={32} className="mx-auto mb-2 text-slate-300" />
                      <p className="font-semibold text-slate-600">No candidate records found</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Try searching for a different name, phone, or email.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Candidate Inspect Modal */}
      {selectedCandidate && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                <Icon name="account_box" size={20} className="text-red-600" />
                Candidate Verification Details ({selectedCandidate.id})
              </h3>
              <button
                onClick={() => setSelectedCandidate(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                <h4 className="font-bold text-slate-700 border-b pb-1 mb-2">Initial Portal Sign-In</h4>
                <p><strong>Name:</strong> {selectedCandidate.loginName}</p>
                <p><strong>Mobile:</strong> {selectedCandidate.loginPhone}</p>
                <p><strong>Email:</strong> {selectedCandidate.loginEmail}</p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                <h4 className="font-bold text-slate-700 border-b pb-1 mb-2">Form Basic Details Filled</h4>
                <p><strong>Name:</strong> {selectedCandidate.basicName}</p>
                <p><strong>Mobile:</strong> {selectedCandidate.basicPhone}</p>
                <p><strong>Email:</strong> {selectedCandidate.basicEmail}</p>
              </div>
            </div>

            <div className="bg-slate-100 p-3 rounded-xl text-xs space-y-1">
              <p><strong>Exam Form:</strong> {selectedCandidate.examId}</p>
              <p><strong>State / UT:</strong> {selectedCandidate.state}</p>
              <p><strong>Category:</strong> {selectedCandidate.category}</p>
              <p><strong>Form Status:</strong> {selectedCandidate.currentStep}</p>
              <p className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
                <strong>Verification Summary:</strong>
                {selectedCandidate.verificationStatus === "GENUINE" ? (
                  <span className="text-emerald-700 font-bold">✅ Genuine User (Name, Mobile & Email Match)</span>
                ) : (
                  <span className="text-amber-700 font-bold">⚠️ Data Mismatch Detected</span>
                )}
              </p>
            </div>

            <div className="text-right pt-2">
              <button
                onClick={() => setSelectedCandidate(null)}
                className="bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
