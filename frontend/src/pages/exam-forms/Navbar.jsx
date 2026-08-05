// ─── src/pages/exam-forms/Navbar.jsx ─────────────────────────────────────────
// Exam Forms portal navbar: Official Adda247 logo, divider, product name,
// search bar, and user profile (Name + Phone practice user).

import { useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { Adda247Logo } from "../../components/GovtLogos.jsx";
import { usePracticeUser, clearPracticeUser } from "../../practiceUser.js";

/**
 * @param {{ searchQuery: string, onSearchChange: (q: string) => void }} props
 */
export default function ExamFormsNavbar({ searchQuery, onSearchChange }) {
  const navigate = useNavigate();
  const practiceUser = usePracticeUser();

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-4">

        {/* ── Left: Logo + Product Name ── */}
        <div className="flex items-center gap-4 shrink-0">
          <button
            onClick={() => navigate("/exam-forms")}
            className="flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-lg"
            aria-label="Go to Exam Forms home"
          >
            {/* Official Adda247 SVG Logo */}
            <Adda247Logo className="h-[28px] w-auto" />

            {/* Vertical Divider */}
            <span className="h-5 w-px bg-slate-300 hidden sm:block" aria-hidden />

            {/* Product Name */}
            <span className="hidden sm:block text-[13px] font-bold text-slate-600 tracking-tight whitespace-nowrap">
              Practice Forms
            </span>
          </button>

          {/* All Courses pill — decorative, matches Adda247 nav */}
          <button className="hidden lg:flex items-center gap-1 px-3 py-1.5 rounded-full border border-slate-200 text-[11px] font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
            All Courses
            <Icon name="expand_more" size={15} />
          </button>
        </div>

        {/* ── Centre: Search Bar ── */}
        <div className="hidden md:flex items-center relative flex-1 max-w-md">
          <Icon
            name="search"
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="search"
            id="exam-search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search exams — IBPS PO, SBI PO, SSC CGL…"
            className="w-full pl-9 pr-4 py-2 rounded-full border border-slate-200 bg-slate-50 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-red-400 focus:bg-white transition-all"
          />
        </div>

        {/* ── Right: Practice user (Name + Phone identity) ── */}
        <div className="flex items-center gap-3 shrink-0">

          {practiceUser && (
            <div className="flex items-center gap-2.5 bg-slate-100 border border-slate-200 pl-3 pr-2 py-1.5 rounded-full">
              <span className="w-6 h-6 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center uppercase shrink-0">
                {practiceUser.name.trim().charAt(0)}
              </span>
              <div className="hidden sm:flex flex-col leading-tight max-w-[140px]">
                <span className="text-xs font-bold text-slate-800 truncate">{practiceUser.name}</span>
                <span className="text-[10px] text-slate-500">+91 {practiceUser.phone}</span>
              </div>
              <button
                onClick={clearPracticeUser}
                title="Switch user"
                className="p-1 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors focus:outline-none"
              >
                <Icon name="logout" size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
