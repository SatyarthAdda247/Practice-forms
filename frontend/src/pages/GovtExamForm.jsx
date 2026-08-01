import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { practiceStore } from "../tools/lib/practiceStore.js";

// Renders the static multi-step practice-form iframe for a given exam.
// examId/iframeSrc/label are supplied per-route so the same component
// serves every exam in the catalogue instead of hardcoding IBPS PO.
export default function GovtExamForm({
  examId = "IBPS-PO",
  iframeSrc = "/Exam-forms/index.html",
  label = "Adda247 Rehearsal Engine — IBPS PO (CRP PO/MT-XVI)",
  iframeTitle = "IBPS PO Practice Form Replica",
}) {
  const navigate = useNavigate();
  const iframeRef = useRef(null);
  const [duplicateLock, setDuplicateLock] = useState(false);

  useEffect(() => {
    setDuplicateLock(false);

    // Monitor iframe window for sessionStorage / field changes to auto-save to practiceStore
    const interval = setInterval(() => {
      try {
        if (!iframeRef.current?.contentWindow) return;
        const win = iframeRef.current.contentWindow;
        const mobile = win.sessionStorage?.getItem("ibps_mobile") || win.document?.getElementById("mobile")?.value;
        const email = win.sessionStorage?.getItem("ibps_email") || win.document?.getElementById("email")?.value;
        const identifier = mobile || email;

        if (identifier) {
          // Check for duplicate lock
          const isDup = practiceStore.isDuplicate(examId, identifier);
          if (isDup && !duplicateLock) {
            setDuplicateLock(true);
          }

          // Auto-save current progress
          practiceStore.saveProgress(examId, identifier, {
            mobile,
            email,
            step: win.location?.pathname || "index.html",
          }, 1);
        }
      } catch (e) {
        // Cross-origin fallback ignore
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [examId, duplicateLock]);

  return (
    <div className="w-screen h-screen flex flex-col fixed inset-0 z-[9999] bg-surface">
      {/* Top Bar Navigation */}
      <div className="bg-surface-container-low border-b border-outline-variant px-4 py-2 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/exam-forms")}
            className="px-3 py-1.5 rounded-xl border border-outline-variant bg-surface text-xs font-semibold text-on-surface hover:bg-surface-container-highest transition-all flex items-center gap-1.5"
          >
            <Icon name="arrow_back" size={16} />
            Back to Hub
          </button>
          <span className="text-xs font-bold text-primary border-l border-outline-variant pl-3">
            {label}
          </span>
        </div>

        {duplicateLock && (
          <span className="text-xs font-bold bg-amber-500/10 text-amber-600 px-3 py-1 rounded-full border border-amber-500/20 flex items-center gap-1">
            <Icon name="lock" size={14} /> Unique Entry Registered
          </span>
        )}
      </div>

      {/* Main Form Iframe */}
      <iframe
        key={examId}
        ref={iframeRef}
        src={iframeSrc}
        title={iframeTitle}
        className="w-full flex-1 border-none bg-white"
      />
    </div>
  );
}
