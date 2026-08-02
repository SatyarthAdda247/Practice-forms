// ─── src/pages/exam-forms/PracticeGate.jsx ───────────────────────────────────
// Required Name + Phone gate for the Practice Forms portal (replaces Google
// sign-in). Everyone who enters is recorded, so we can trace how many people
// used it and who. Best-effort tracking: a logging failure never blocks entry.

import { useState } from "react";
import Icon from "../../components/Icon.jsx";
import { setPracticeUser } from "../../practiceUser.js";
import { toolsApi } from "../../api.js";

export default function PracticeGate() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState({});
  const [submitting, setSubmitting] = useState(false);

  function validate() {
    const e = {};
    const n = name.trim();
    if (!n) e.name = "Please enter your name.";
    else if (n.length < 2) e.name = "Name is too short.";
    else if (!/^[A-Za-z][A-Za-z .'-]*$/.test(n)) e.name = "Use letters, spaces, and . ' - only.";
    if (!/^[6-9]\d{9}$/.test(phone)) e.phone = "Enter a valid 10-digit mobile number.";
    setErr(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev) {
    ev.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    const user = { name: name.trim(), phone };

    // Record the entry (best-effort — never blocks the user).
    try {
      await toolsApi.logExamFormEntry({
        examId: "PRACTICE-PORTAL",
        identifier: phone,
        step: "portal-entry",
        data: { name: user.name, phone, event: "portal-entry" },
      });
    } catch {
      /* ignore — tracking is best-effort */
    }

    setPracticeUser(user);
    // no navigation needed — the landing re-renders once the user is set
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-red-600 px-6 py-5 text-white">
          <h2 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
            <Icon name="edit_note" size={22} /> Start Practising
          </h2>
          <p className="text-[12px] text-white/85 mt-1">
            Enter your details to access the free government-exam practice forms.
          </p>
        </div>

        <form onSubmit={submit} className="px-6 py-6 space-y-4" noValidate>
          {/* Name */}
          <div>
            <label htmlFor="pg-name" className="block text-xs font-bold text-slate-700 mb-1">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              id="pg-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (err.name) setErr({ ...err, name: undefined }); }}
              placeholder="e.g. Satyarth Prakash"
              autoFocus
              className={`w-full px-3.5 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-all ${
                err.name ? "border-red-400 focus:ring-red-200" : "border-slate-300 focus:ring-red-200 focus:border-red-400"
              }`}
            />
            {err.name && <p className="text-[11px] text-red-600 font-semibold mt-1">{err.name}</p>}
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="pg-phone" className="block text-xs font-bold text-slate-700 mb-1">
              Mobile Number <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center rounded-lg border overflow-hidden focus-within:ring-2 focus-within:ring-red-200 transition-all"
                 style={{ borderColor: err.phone ? "#f87171" : "#cbd5e1" }}>
              <span className="px-3 py-2.5 bg-slate-100 text-slate-600 text-sm font-semibold border-r border-slate-200">+91</span>
              <input
                id="pg-phone"
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setPhone(v);
                  if (err.phone) setErr({ ...err, phone: undefined });
                }}
                placeholder="10-digit mobile number"
                className="flex-1 px-3.5 py-2.5 text-sm focus:outline-none"
              />
            </div>
            {err.phone && <p className="text-[11px] text-red-600 font-semibold mt-1">{err.phone}</p>}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? "Please wait…" : (<>Continue to Practice Forms <Icon name="arrow_forward" size={16} /></>)}
          </button>

          <p className="text-[10px] text-slate-400 text-center leading-relaxed">
            Free practice only — no real application is submitted. Your details are used to save your progress and are never shared.
          </p>
        </form>
      </div>
    </div>
  );
}
