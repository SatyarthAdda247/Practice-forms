// ─── src/pages/ExamFormsLanding.jsx ──────────────────────────────────────────
// Main landing page for the Adda247 Practice Forms portal.
// Composed of: ExamFormsNavbar | CategorySidebar | ExamCard grid | Footer

import { useState, useEffect } from "react";
import Icon from "../components/Icon.jsx";
import { practiceStore } from "../tools/lib/practiceStore.js";

import ExamFormsNavbar from "./exam-forms/Navbar.jsx";
import CategorySidebar from "./exam-forms/CategorySidebar.jsx";
import ExamCard from "./exam-forms/ExamCard.jsx";
import PracticeGate from "./exam-forms/PracticeGate.jsx";
import { EXAMS } from "./exam-forms/data.js";
import { usePracticeUser } from "../practiceUser.js";

export default function ExamFormsLanding() {
  const [activeCategory, setActiveCategory] = useState("Banking");
  const [searchQuery, setSearchQuery] = useState("");
  const [entryCount, setEntryCount] = useState(0);
  const practiceUser = usePracticeUser();

  useEffect(() => {
    setEntryCount(practiceStore.getAllEntries().length);
  }, []);

  // Filter exams by category + search
  const filteredExams = EXAMS.filter((exam) => {
    const matchesCat = exam.category === activeCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      exam.title.toLowerCase().includes(q) ||
      exam.fullName.toLowerCase().includes(q) ||
      exam.orgName.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans antialiased">

      {/* ── Announcement Banner ── */}
      <div
        role="banner"
        className="bg-red-600 text-white text-[11px] font-semibold py-1.5 px-4 text-center"
      >
        <span className="bg-white/20 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase mr-2">
          Free
        </span>
        Practice filling Government exam forms — risk-free, no real submission.
        {entryCount > 0 && (
          <span className="ml-3 bg-white/20 px-2 py-0.5 rounded-full text-[9px]">
            {entryCount} form{entryCount !== 1 ? "s" : ""} practised so far
          </span>
        )}
      </div>

      {/* ── Sticky Navbar ── */}
      <ExamFormsNavbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-8 py-8">

        {/* Page Title */}
        <div className="mb-6 border-b border-slate-200 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-[28px] font-extrabold text-slate-900 tracking-tight leading-tight">
              Explore by <span className="text-red-600">Exams</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1.5 max-w-lg">
              Select an exam below to practice its official application form with
              live validations. Your progress is saved automatically.
            </p>
          </div>

          {/* Mobile search */}
          <div className="md:hidden relative w-full sm:w-72">
            <Icon
              name="search"
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search exams…"
              className="w-full pl-9 pr-4 py-2 rounded-full border border-slate-200 bg-white text-xs focus:outline-none focus:border-red-400 transition-all"
            />
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">

          {/* ── Left: Category Sidebar ── */}
          <aside className="lg:col-span-3">
            <CategorySidebar
              active={activeCategory}
              onChange={setActiveCategory}
            />

            {/* Info card */}
            <div className="mt-4 bg-red-50 border border-red-100 rounded-2xl p-4">
              <p className="text-[11px] font-bold text-red-700 flex items-center gap-1.5 mb-1">
                <Icon name="info" size={14} />
                Why practice forms?
              </p>
              <p className="text-[10px] text-red-600 leading-relaxed">
                A single wrong entry in a government form can cause rejection.
                Practice here before filling the real one.
              </p>
            </div>
          </aside>

          {/* ── Right: Exam Cards Grid ── */}
          <section
            aria-label="Available exam forms"
            className="lg:col-span-9"
          >
            {filteredExams.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {filteredExams.map((exam) => (
                  <ExamCard key={exam.id} exam={exam} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Icon name="search_off" size={40} className="text-slate-300 mb-3" />
                <p className="text-sm font-semibold text-slate-500">
                  No exams found for "{searchQuery}"
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Try a different keyword or select another category.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 bg-white py-4 px-6 text-center text-[11px] text-slate-400">
        © 2026 Adda247 — Official Practice Forms Portal. For educational practice only.
      </footer>
    </div>
  );
}
