// ─── src/pages/exam-forms/CategorySidebar.jsx ────────────────────────────────
// Left sidebar for exam category navigation.

import Icon from "../../components/Icon.jsx";
import { CATEGORIES } from "./data.js";

/**
 * @param {{ active: string, onChange: (id: string) => void }} props
 */
export default function CategorySidebar({ active, onChange }) {
  return (
    <nav
      aria-label="Exam categories"
      className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1"
    >
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-3">
        Categories
      </p>

      {CATEGORIES.map((cat) => {
        const isActive = active === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => onChange(cat.id)}
            aria-current={isActive ? "page" : undefined}
            className={[
              "w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all",
              isActive
                ? "bg-red-50 text-red-600 border border-red-200 shadow-xs"
                : "text-slate-600 hover:bg-slate-50",
            ].join(" ")}
          >
            <span className="flex items-center gap-2.5">
              <Icon
                name={cat.icon}
                size={17}
                className={isActive ? "text-red-600" : "text-slate-400"}
              />
              {cat.label}
            </span>
            <Icon
              name="chevron_right"
              size={15}
              className={isActive ? "text-red-600" : "text-slate-300"}
            />
          </button>
        );
      })}
    </nav>
  );
}
