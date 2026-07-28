// Candidate leads captured by the public tools (name / phone / target exam,
// submitted on the Image Resizer download step).
//
// This is the only personal data the tools collect, so the page is gated: super
// admins always see it, everyone else needs a super admin to approve their
// account. The API enforces that independently — the guard here only keeps an
// unapproved user from staring at an error.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";
import Loading from "../components/Loading.jsx";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const fmtWhen = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export default function Leads() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .leads(days)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  const rows = useMemo(() => {
    const all = data?.rows || [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      [r.name, r.phone, r.exam, r.presetLabel].some((v) =>
        (v || "").toLowerCase().includes(q),
      ),
    );
  }, [data, query]);

  const exportCsv = () => {
    if (!rows.length) return;
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) =>
      [r.createdAt, r.name, r.phone, r.exam, r.tool, r.presetLabel].map(cell).join(","),
    );
    const blob = new Blob(
      [["Captured At,Name,Phone,Target Exam,Tool,Preset", ...lines].join("\n")],
      { type: "text/csv" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tool-leads-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <header className="mb-xl flex flex-wrap gap-md justify-between items-end">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-xs">
            Candidate Leads
          </h1>
          <p className="font-body-lg text-body-lg text-secondary">
            Details submitted on the public tools before download.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
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
          <button
            onClick={exportCsv}
            disabled={!rows.length}
            className="py-2 px-md bg-primary-container text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-xs disabled:opacity-60"
          >
            <Icon name="download" size={18} />
            Export CSV
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-lg p-md rounded-xl bg-error-container text-on-error-container font-body-md flex items-start gap-sm">
          <Icon name="lock" size={20} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : !data ? null : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div className="px-lg py-md border-b border-outline-variant bg-surface-bright flex flex-wrap gap-sm justify-between items-center">
            <h4 className="font-headline-sm text-headline-sm text-on-background">
              {rows.length} {rows.length === 1 ? "lead" : "leads"}
            </h4>
            <div className="relative">
              <Icon
                name="search"
                size={18}
                className="absolute left-sm top-1/2 -translate-y-1/2 text-outline"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name / phone / exam"
                className="bg-surface border border-outline-variant rounded-lg pl-xl pr-sm py-1.5 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="p-lg text-secondary font-body-md">
              No leads captured in this period.
            </p>
          ) : (
            <>
              {/* Mobile: stacked cards — a 6-column table cannot fit a phone. */}
              <ul className="md:hidden divide-y divide-outline-variant max-h-[60vh] overflow-y-auto custom-scrollbar">
                {rows.map((r, i) => (
                  <li key={i} className="p-md">
                    <p className="font-body-lg text-body-lg text-on-background font-semibold">
                      {r.name || "—"}
                    </p>
                    <p className="font-data-mono text-body-md text-on-background">
                      {r.phone || "—"}
                    </p>
                    <p className="font-body-sm text-body-sm text-secondary mt-xs">
                      {r.exam || "—"} · {r.presetLabel || "—"}
                    </p>
                    <p className="font-body-sm text-body-sm text-outline mt-xs">
                      {fmtWhen(r.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="hidden md:block max-h-[60vh] overflow-auto custom-scrollbar">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">
                      {["Captured", "Name", "Phone", "Target Exam", "Preset used"].map((h) => (
                        <th
                          key={h}
                          className="sticky top-0 z-10 bg-surface-bright px-lg py-sm border-b border-outline-variant"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {rows.map((r, i) => (
                      <tr key={i} className="hover:bg-surface-bright transition-colors">
                        <td className="px-lg py-md font-body-sm text-body-sm text-secondary whitespace-nowrap">
                          {fmtWhen(r.createdAt)}
                        </td>
                        <td className="px-lg py-md font-body-md text-body-md text-on-background font-medium">
                          {r.name || "—"}
                        </td>
                        <td className="px-lg py-md font-data-mono text-data-mono text-on-background">
                          {r.phone || "—"}
                        </td>
                        <td className="px-lg py-md font-body-md text-body-md text-on-background">
                          {r.exam || "—"}
                        </td>
                        <td className="px-lg py-md font-body-sm text-body-sm text-secondary">
                          {r.presetLabel || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
