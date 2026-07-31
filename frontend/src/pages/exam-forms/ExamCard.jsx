// ─── src/pages/exam-forms/ExamCard.jsx ───────────────────────────────────────
// Standalone exam card component — clean, professional, reusable.

import { useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";

/**
 * @param {{ exam: import('./data').EXAMS[0] }} props
 */
export default function ExamCard({ exam }) {
  const navigate = useNavigate();
  const LogoComp = exam.LogoComponent;

  const handleClick = () => {
    if (exam.isAvailable) navigate(exam.route);
  };

  return (
    <article
      role={exam.isAvailable ? "button" : "article"}
      tabIndex={exam.isAvailable ? 0 : -1}
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
      aria-label={`${exam.title} — ${exam.isAvailable ? "Start Practice" : "Coming Soon"}`}
      className={[
        "group bg-white border border-slate-200 rounded-2xl p-5 shadow-sm",
        "flex flex-col items-center text-center transition-all duration-200",
        exam.isAvailable
          ? "hover:shadow-lg hover:border-red-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-500"
          : "opacity-60 cursor-default",
      ].join(" ")}
    >
      {/* Logo Container */}
      <div className="w-16 h-16 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center shadow-sm mb-4 group-hover:scale-105 transition-transform duration-200">
        <LogoComp size={52} />
      </div>

      {/* Exam Title */}
      <h3 className="font-bold text-sm text-slate-900 group-hover:text-red-600 transition-colors leading-tight">
        {exam.title}
      </h3>

      {/* Full Name */}
      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-snug">
        {exam.fullName}
      </p>

      {/* Organisation */}
      <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
        {exam.orgName}
      </p>

      {/* CTA */}
      <div className="mt-4 w-full pt-3 border-t border-slate-100">
        {exam.isAvailable ? (
          <span className="flex items-center justify-center gap-1.5 w-full py-2 bg-red-600 text-white rounded-xl text-xs font-bold group-hover:bg-red-700 transition-colors shadow-sm">
            Start Practice
            <Icon name="arrow_forward" size={13} />
          </span>
        ) : (
          <span className="block text-[11px] font-semibold text-slate-400 bg-slate-100 px-3 py-1.5 rounded-full">
            Coming Soon
          </span>
        )}
      </div>
    </article>
  );
}
