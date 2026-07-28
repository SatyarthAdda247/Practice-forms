// Admin-only usage dashboard: how many student OMR sheets were processed each
// day. One page = one student's sheet, so "sheets" is the student count.
//
// Chart notes: a single-series column chart (magnitude over time), so there is
// no legend — the heading names the series. Bars are capped in width rather
// than filling their slot, carry a rounded data-end and a square baseline, and
// every value is also in the table below, so nothing is reachable only by
// hovering.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";
import Loading from "../components/Loading.jsx";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="flex items-center gap-sm mb-sm text-on-surface-variant">
        <Icon name={icon} size={20} />
        <span className="font-label-md text-label-md uppercase tracking-wider">{label}</span>
      </div>
      <div className="font-data-mono text-headline-lg font-bold text-on-background">{value}</div>
      {sub && <p className="font-body-sm text-body-sm text-secondary mt-xs">{sub}</p>}
    </div>
  );
}

const fmtDay = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// Zero-fill the range so quiet days read as gaps rather than being dropped —
// the API omits them to keep long ranges small.
function fillDays(rows, days) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(byDay.get(key) || { day: key, sheets: 0, validated: 0, failed: 0, graded: 0, exams: 0, named: 0 });
  }
  return out;
}

export default function Usage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    setLoading(true);
    api
      .adminUsage(days)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  const series = useMemo(() => (data ? fillDays(data.rows, days) : []), [data, days]);
  const peak = useMemo(() => Math.max(1, ...series.map((d) => d.sheets)), [series]);
  const busiest = useMemo(
    () => series.reduce((a, b) => (b.sheets > (a?.sheets ?? -1) ? b : a), null),
    [series]
  );
  const totals = data?.totals;
  const perActiveDay =
    totals && totals.activeDays ? Math.round(totals.sheets / totals.activeDays) : 0;

  return (
    <>
      <header className="mb-xl flex flex-wrap gap-md justify-between items-end">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-xs">
            Daily Usage
          </h1>
          <p className="font-body-lg text-body-lg text-secondary">
            Student OMR sheets processed per day.
          </p>
        </div>
        {/* Filters sit in one row above the chart. */}
        <div className="flex items-center gap-xs bg-surface-container rounded-lg p-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              aria-pressed={days === r.days}
              className={`px-md py-1.5 rounded-md font-label-md text-label-md transition-colors ${
                days === r.days
                  ? "bg-surface-container-lowest text-on-background shadow-sm"
                  : "text-on-surface-variant hover:text-on-background"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="mb-lg p-md rounded-xl bg-error-container text-on-error-container font-body-md">
          {error}
        </div>
      )}

      {loading ? (
        <Loading />
      ) : !totals ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-lg mb-xl">
            <StatCard
              icon="description"
              label="Sheets checked"
              value={totals.sheets.toLocaleString()}
              sub={`in the last ${days} days`}
            />
            <StatCard
              icon="task_alt"
              label="Graded"
              value={totals.graded.toLocaleString()}
              sub={totals.failed ? `${totals.failed} failed to read` : "none failed"}
            />
            <StatCard
              icon="badge"
              label="Name detected"
              value={totals.named.toLocaleString()}
              sub={
                totals.sheets
                  ? `${Math.round((totals.named / totals.sheets) * 100)}% of sheets`
                  : "—"
              }
            />
            <StatCard
              icon="calendar_month"
              label="Active days"
              value={totals.activeDays}
              sub={perActiveDay ? `~${perActiveDay} sheets per active day` : "—"}
            />
          </div>

          {/* Column chart — single series, so no legend; the heading names it. */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg mb-xl">
            <div className="flex flex-wrap justify-between items-baseline gap-sm mb-lg">
              <h4 className="font-headline-sm text-headline-sm text-on-background">
                Sheets checked per day
              </h4>
              {busiest && busiest.sheets > 0 && (
                <p className="font-body-sm text-body-sm text-secondary">
                  Peak {busiest.sheets} on {fmtDay(busiest.day)}
                </p>
              )}
            </div>

            <div className="relative">
              {/* Recessive gridlines + y ticks */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                {[peak, Math.round(peak / 2), 0].map((v, i) => (
                  <div key={i} className="flex items-center gap-sm">
                    <span className="font-data-mono text-body-sm text-outline w-8 text-right shrink-0">
                      {v}
                    </span>
                    <span className="flex-1 border-t border-outline-variant/60" />
                  </div>
                ))}
              </div>

              <div className="relative flex items-end gap-[2px] h-48 pl-10">
                {series.map((d) => {
                  const pct = (d.sheets / peak) * 100;
                  return (
                    <div
                      key={d.day}
                      className="relative flex-1 h-full flex items-end justify-center group"
                      onMouseEnter={() => setHover(d)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(d)}
                      onBlur={() => setHover(null)}
                      tabIndex={0}
                      aria-label={`${fmtDay(d.day)}: ${d.sheets} sheets checked`}
                    >
                      <div
                        className="w-full max-w-[24px] rounded-t bg-on-primary-fixed-variant group-hover:bg-primary group-focus:bg-primary transition-colors"
                        style={{ height: `${Math.max(pct, d.sheets ? 2 : 0)}%` }}
                      />
                      {hover?.day === d.day && (
                        <div className="absolute bottom-full mb-sm z-10 whitespace-nowrap rounded-lg border border-outline-variant bg-inverse-surface text-inverse-on-surface px-sm py-xs shadow-lg">
                          <p className="font-data-mono text-body-md font-bold">
                            {d.sheets} sheets
                          </p>
                          <p className="font-body-sm text-body-sm opacity-80">
                            {fmtDay(d.day)} · {d.graded} graded
                            {d.failed ? ` · ${d.failed} failed` : ""}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Only the ends are labelled — a date under every bar is unreadable. */}
            <div className="flex justify-between pl-10 mt-sm font-body-sm text-body-sm text-outline">
              <span>{series.length ? fmtDay(series[0].day) : ""}</span>
              <span>{series.length ? fmtDay(series[series.length - 1].day) : ""}</span>
            </div>
          </div>

          {/* Table view: every value in the chart is also readable here. */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
            <div className="px-lg py-md border-b border-outline-variant bg-surface-bright">
              <h4 className="font-headline-sm text-headline-sm text-on-background">
                Daily breakdown ({data.rows.length} active {data.rows.length === 1 ? "day" : "days"})
              </h4>
            </div>
            {data.rows.length === 0 ? (
              <p className="p-lg text-secondary font-body-md">
                No sheets processed in this period.
              </p>
            ) : (
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-surface-bright text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">
                      <th className="px-lg py-sm">Date</th>
                      <th className="px-lg py-sm text-center">Sheets</th>
                      <th className="px-lg py-sm text-center">Graded</th>
                      <th className="px-lg py-sm text-center">Name found</th>
                      <th className="px-lg py-sm text-center">Failed</th>
                      <th className="px-lg py-sm text-center">Exams</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {data.rows.map((r) => (
                      <tr key={r.day} className="hover:bg-surface-bright transition-colors">
                        <td className="px-lg py-md font-body-md text-body-md text-on-background">
                          {fmtDay(r.day)}
                        </td>
                        <td className="px-lg py-md text-center font-data-mono text-data-mono font-bold text-on-background">
                          {r.sheets}
                        </td>
                        <td className="px-lg py-md text-center font-data-mono text-data-mono text-[#0d9488]">
                          {r.graded}
                        </td>
                        <td className="px-lg py-md text-center font-data-mono text-data-mono text-secondary">
                          {r.named}
                        </td>
                        <td
                          className={`px-lg py-md text-center font-data-mono text-data-mono ${
                            r.failed ? "text-error" : "text-outline"
                          }`}
                        >
                          {r.failed}
                        </td>
                        <td className="px-lg py-md text-center font-data-mono text-data-mono text-secondary">
                          {r.exams}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
