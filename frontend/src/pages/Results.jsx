import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";
import Loading from "../components/Loading.jsx";
import { violationLabel } from "../violations.js";

function StatCard({ icon, label, value, accent = "text-on-background", sub }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="flex items-center gap-sm mb-sm text-on-surface-variant">
        <Icon name={icon} size={20} />
        <span className="font-label-md text-label-md uppercase tracking-wider">{label}</span>
      </div>
      <div className={`font-data-mono text-headline-lg font-bold ${accent}`}>{value}</div>
      {sub && <p className="font-body-sm text-body-sm text-secondary mt-xs">{sub}</p>}
    </div>
  );
}

export default function Results() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState(id || "");
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Inline manual editing of a student's name (OCR is best-effort; this lets a
  // reviewer set/correct it). `editing` holds the sheetId being edited.
  const [editing, setEditing] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = (r) => {
    setEditing(r.sheetId);
    setEditVal(r.studentName || "");
  };
  const cancelEdit = () => {
    setEditing(null);
    setEditVal("");
  };
  const applyName = (sheetId, value) =>
    setData((d) =>
      d
        ? { ...d, rows: d.rows.map((r) => (r.sheetId === sheetId ? { ...r, studentName: value } : r)) }
        : d
    );

  const saveEdit = async (sheetId) => {
    const value = editVal.trim();
    setSaving(true);
    try {
      await api.updateSheet(sheetId, { studentName: value });
      applyName(sheetId, value);
      setEditing(null);
      setEditVal("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // "Who is this?" — view the scanned sheet and set the name in one place.
  const [viewRow, setViewRow] = useState(null);
  const [viewUrl, setViewUrl] = useState("");
  const [viewLoading, setViewLoading] = useState(false);
  const [viewName, setViewName] = useState("");
  // Why the scan wouldn't load, shown inside the dialog rather than on the page
  // banner behind it. The name field still works without the image, so this is
  // an explanation, not a dead end.
  const [viewError, setViewError] = useState("");

  const openView = async (r) => {
    setViewRow(r);
    setViewName(r.studentName || "");
    setViewUrl("");
    setViewError("");
    setViewLoading(true);
    try {
      const url = await api.sheetImageUrl(r.sheetId);
      setViewUrl(url);
    } catch (e) {
      setViewError(e.message);
    } finally {
      setViewLoading(false);
    }
  };
  const closeView = () => {
    if (viewUrl) URL.revokeObjectURL(viewUrl);
    setViewRow(null);
    setViewUrl("");
    setViewName("");
    setViewError("");
  };
  const saveView = async () => {
    const value = viewName.trim();
    const sheetId = viewRow.sheetId;
    setSaving(true);
    try {
      await api.updateSheet(sheetId, { studentName: value });
      applyName(sheetId, value);
      closeView();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    api.listExams().then((list) => {
      setExams(list);
      if (!examId && list.length) setExamId(String(list[0].id));
    });
  }, []);

  useEffect(() => {
    if (!examId) return;
    setLoading(true);
    api
      .results(examId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [examId]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(
      (r) =>
        (r.studentName || "").toLowerCase().includes(q) ||
        (r.filename || "").toLowerCase().includes(q)
    );
  }, [data, query]);

  const exportCsv = () => {
    if (!data) return;
    const header = "Rank,Roll Number,Student Name,File,Correct,Wrong,Unattempted,Score,Max,Percent,Flags";
    const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = data.rows.map((r, i) => {
      const pct = r.maxScore ? ((r.score / r.maxScore) * 100).toFixed(1) : "0";
      const flags = (r.flags || []).map(violationLabel).join("; ");
      return [i + 1, csvCell(r.rollNumber), csvCell(r.studentName), csvCell(r.filename), r.correct, r.wrong, r.unattempted, r.score, r.maxScore, pct, csvCell(flags)].join(",");
    });
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.exam.name.replace(/\s+/g, "_")}_results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = data?.stats;
  const maxScore = data?.rows?.[0]?.maxScore || 0;
  // Questions actually configured in the answer key — only these are graded,
  // which can be fewer than the exam's nominal question count.
  const keyQuestions = data?.exam ? Object.keys(data.exam.answerKey || {}).length : 0;
  const totalQuestions = data?.exam?.numQuestions || 0;

  return (
    <>
      <header className="mb-xl flex flex-wrap gap-md justify-between items-end">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-xs">
            Results Dashboard
          </h1>
          <p className="font-body-lg text-body-lg text-secondary">
            {data?.exam ? data.exam.name : "Graded OMR performance overview."}
          </p>
        </div>
        <div className="flex items-center gap-sm">
          <select
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            className="bg-surface border border-outline-variant rounded-lg px-sm py-2 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
          >
            <option value="">Select exam…</option>
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}
              </option>
            ))}
          </select>
          <button
            onClick={exportCsv}
            disabled={!data?.rows?.length}
            className="py-2 px-md bg-primary-container text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-xs disabled:opacity-60"
          >
            <Icon name="download" size={18} />
            Export CSV
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-lg p-md rounded-xl bg-error-container text-on-error-container font-body-md">
          {error}
        </div>
      )}

      {loading ? (
        <Loading />
      ) : !stats || stats.graded === 0 ? (
        <div className="bg-surface-container-lowest border border-dashed border-outline-variant rounded-xl p-xl text-center text-on-surface-variant">
          <Icon name="analytics" size={40} className="text-outline" />
          <p className="mt-sm font-body-md">
            No graded sheets yet. Upload sheets and run grading to see results.
          </p>
          {examId && (
            <button
              onClick={() => navigate(`/upload/${examId}`)}
              className="mt-md py-sm px-lg bg-primary-container text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors"
            >
              Go to Uploads
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-lg mb-xl">
            <StatCard icon="groups" label="Graded" value={stats.graded} />
            <StatCard
              icon="key"
              label="Key Questions"
              value={keyQuestions}
              sub={totalQuestions ? `of ${totalQuestions}` : ""}
            />
            <StatCard
              icon="functions"
              label="Average"
              value={stats.average}
              sub={maxScore ? `of ${maxScore}` : ""}
            />
            <StatCard icon="trending_up" label="Highest" value={stats.highest} accent="text-[#0d9488]" />
            <StatCard icon="trending_down" label="Lowest" value={stats.lowest} accent="text-error" />
            <StatCard
              icon="verified"
              label="Pass Rate"
              value={`${Math.round(stats.passRate * 100)}%`}
              sub="≥ 40% threshold"
            />
          </div>

          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
            <div className="px-lg py-md border-b border-outline-variant bg-surface-bright flex flex-wrap gap-sm justify-between items-center">
              <h4 className="font-headline-sm text-headline-sm text-on-background">
                Student Scores ({rows.length})
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
                  placeholder="Search name / file"
                  className="bg-surface border border-outline-variant rounded-lg pl-xl pr-sm py-1.5 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            {/* Mobile: stacked roster cards */}
            <ul className="md:hidden divide-y divide-outline-variant">
              {rows.map((r) => {
                const rank = data.rows.indexOf(r) + 1;
                const pct = r.maxScore ? (r.score / r.maxScore) * 100 : 0;
                const violations = r.flags || [];
                const flagged = pct < 40 || violations.length > 0;
                return (
                  <li key={r.sheetId} className="p-md">
                    <div className="flex justify-between items-start mb-sm">
                      <div>
                        {editing === r.sheetId ? (
                          <div className="flex items-center gap-xs mb-xs">
                            <input
                              autoFocus
                              value={editVal}
                              onChange={(e) => setEditVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(r.sheetId);
                                if (e.key === "Escape") cancelEdit();
                              }}
                              placeholder="Student name"
                              className="bg-surface border border-outline-variant rounded-lg px-sm py-1 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary w-40"
                            />
                            <button onClick={() => saveEdit(r.sheetId)} disabled={saving} title="Save" className="text-primary p-xs rounded disabled:opacity-60">
                              <Icon name="check" size={18} />
                            </button>
                            <button onClick={cancelEdit} title="Cancel" className="text-secondary p-xs rounded">
                              <Icon name="close" size={18} />
                            </button>
                          </div>
                        ) : (
                          <p className="font-body-lg text-body-lg text-on-background font-semibold leading-tight inline-flex items-center gap-xs">
                            {r.studentName || "—"}
                            <button onClick={() => startEdit(r)} title="Edit name" className="text-outline hover:text-primary p-xs rounded">
                              <Icon name="edit" size={15} />
                            </button>
                          </p>
                        )}
                        <p className="font-data-mono text-body-sm text-secondary">
                          Rank #{rank}
                        </p>
                        <button
                          onClick={() => openView(r)}
                          className="mt-xs inline-flex items-center gap-xs text-primary font-label-md text-label-md"
                        >
                          <Icon name="image" size={15} />
                          View scan
                        </button>
                      </div>
                      <span
                        className={`font-label-md text-label-md px-sm py-xs rounded-full border shrink-0 ${
                          flagged
                            ? "text-error bg-error-container border-[#f87171]"
                            : "text-[#0d9488] bg-tertiary-fixed-dim/20 border-tertiary-fixed-dim"
                        }`}
                      >
                        {flagged ? "REVIEW REQ" : "VERIFIED"}
                      </span>
                    </div>
                    {violations.length > 0 && (
                      <div className="flex flex-wrap gap-xs mb-sm">
                        {violations.map((code) => (
                          <span
                            key={code}
                            className="inline-flex items-center gap-xs font-label-md text-[11px] px-sm py-[2px] rounded-full bg-error-container/40 text-error border border-[#fca5a5]"
                          >
                            <Icon name="warning" size={12} filled />
                            {violationLabel(code)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-4 gap-sm mb-sm text-center">
                      {[
                        { k: "CORRECT", v: r.correct, c: "text-[#0d9488]" },
                        { k: "WRONG", v: r.wrong, c: "text-error" },
                        { k: "BLANK", v: r.unattempted, c: "text-secondary" },
                        { k: "TOTAL", v: `${r.score}`, c: "text-on-background font-bold" },
                      ].map((cell) => (
                        <div key={cell.k}>
                          <p className="font-label-md text-[10px] text-on-surface-variant tracking-wider">
                            {cell.k}
                          </p>
                          <p className={`font-data-mono text-body-md ${cell.c}`}>{cell.v}</p>
                        </div>
                      ))}
                    </div>
                    <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${flagged ? "bg-error" : "bg-primary"}`}
                        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: results table */}
            <div className="hidden md:block overflow-x-auto custom-scrollbar">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-surface-bright text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">
                    <th className="px-lg py-sm">Rank</th>
                    <th className="px-lg py-sm">Student Name</th>
                    <th className="px-lg py-sm hidden md:table-cell">File</th>
                    <th className="px-lg py-sm text-center">Correct</th>
                    <th className="px-lg py-sm text-center">Wrong</th>
                    <th className="px-lg py-sm text-center hidden sm:table-cell">Blank</th>
                    <th className="px-lg py-sm text-right">Score</th>
                    <th className="px-lg py-sm w-40">Percent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {rows.map((r) => {
                    const rank = data.rows.indexOf(r) + 1;
                    const pct = r.maxScore ? (r.score / r.maxScore) * 100 : 0;
                    return (
                      <tr key={r.sheetId} className="hover:bg-surface-bright transition-colors">
                        <td className="px-lg py-md font-data-mono text-data-mono text-secondary">
                          {rank}
                        </td>
                        <td className="px-lg py-md font-body-md text-body-md text-on-background">
                          {editing === r.sheetId ? (
                            <span className="inline-flex items-center gap-xs">
                              <input
                                autoFocus
                                value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEdit(r.sheetId);
                                  if (e.key === "Escape") cancelEdit();
                                }}
                                placeholder="Student name"
                                className="bg-surface border border-outline-variant rounded-lg px-sm py-1 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary w-40"
                              />
                              <button
                                onClick={() => saveEdit(r.sheetId)}
                                disabled={saving}
                                title="Save"
                                className="text-primary p-xs rounded hover:bg-surface-container transition-colors disabled:opacity-60"
                              >
                                <Icon name="check" size={18} />
                              </button>
                              <button
                                onClick={cancelEdit}
                                title="Cancel"
                                className="text-secondary p-xs rounded hover:bg-surface-container transition-colors"
                              >
                                <Icon name="close" size={18} />
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-xs group">
                              {r.studentName || "—"}
                              {(r.flags || []).length > 0 && !r.studentName && (
                                <span
                                  className="inline-flex items-center text-error"
                                  title={`Filling issues: ${(r.flags || []).map(violationLabel).join(", ")}`}
                                >
                                  <Icon name="warning" size={16} filled />
                                </span>
                              )}
                              <button
                                onClick={() => startEdit(r)}
                                title="Edit name"
                                className="text-outline hover:text-primary p-xs rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                              >
                                <Icon name="edit" size={15} />
                              </button>
                            </span>
                          )}
                        </td>
                        <td className="px-lg py-md font-body-sm text-body-sm text-secondary hidden md:table-cell max-w-[200px]">
                          <button
                            onClick={() => openView(r)}
                            title="View scanned sheet"
                            className="inline-flex items-center gap-xs text-primary hover:underline max-w-full"
                          >
                            <Icon name="image" size={16} className="shrink-0" />
                            <span className="truncate">{r.filename}</span>
                          </button>
                        </td>
                        <td className="px-lg py-md text-center font-data-mono text-data-mono text-[#0d9488]">
                          {r.correct}
                        </td>
                        <td className="px-lg py-md text-center font-data-mono text-data-mono text-error">
                          {r.wrong}
                        </td>
                        <td className="px-lg py-md text-center font-data-mono text-data-mono text-secondary hidden sm:table-cell">
                          {r.unattempted}
                        </td>
                        <td className="px-lg py-md text-right font-data-mono text-data-mono font-bold text-on-background">
                          {r.score}
                          <span className="text-outline">/{r.maxScore}</span>
                        </td>
                        <td className="px-lg py-md">
                          <div className="flex items-center gap-sm">
                            <div className="h-2 flex-1 bg-surface-container rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  pct >= 40 ? "bg-primary" : "bg-error"
                                }`}
                                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                              />
                            </div>
                            <span className="font-data-mono text-body-sm text-secondary w-10 text-right">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* View-scan modal: read the handwritten name off the sheet and set it. */}
      {viewRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-md"
          onClick={closeView}
        >
          <div
            className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-lg py-md border-b border-outline-variant flex items-center justify-between gap-sm">
              <h4 className="font-headline-sm text-headline-sm text-on-background truncate">
                {viewRow.filename}
              </h4>
              <button
                onClick={closeView}
                title="Close"
                className="text-secondary p-xs rounded hover:bg-surface-container transition-colors shrink-0"
              >
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="p-lg overflow-auto custom-scrollbar bg-surface-container flex-1 flex items-center justify-center min-h-[200px]">
              {viewLoading ? (
                <Loading />
              ) : viewUrl ? (
                <img
                  src={viewUrl}
                  alt="Scanned answer sheet"
                  className="max-w-full h-auto rounded border border-outline-variant"
                />
              ) : (
                <div className="text-center max-w-md">
                  <Icon name="broken_image" size={32} className="text-outline mb-sm" />
                  <p className="text-on-surface-variant font-body-md">
                    {viewError || "Could not load the scan."}
                  </p>
                  <p className="text-secondary font-body-sm mt-xs">
                    You can still type the name from your own copy of the sheet.
                  </p>
                </div>
              )}
            </div>

            <div className="px-lg py-md border-t border-outline-variant flex flex-wrap items-end gap-sm">
              <label className="flex-1 min-w-[180px]">
                <span className="block font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs">
                  Student Name
                </span>
                <input
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveView()}
                  placeholder="Type the name from the scan"
                  className="w-full bg-surface border border-outline-variant rounded-lg px-sm py-2 font-body-md text-body-md text-on-surface focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </label>
              <button
                onClick={saveView}
                disabled={saving}
                className="py-2 px-lg bg-primary-container text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save name"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
