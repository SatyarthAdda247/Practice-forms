import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";

export default function ExamsList() {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    api
      .listExams()
      .then(setExams)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (id) => {
    if (!confirm("Delete this exam and all its sheets and results?")) return;
    await api.deleteExam(id);
    load();
  };

  const keyProgress = (exam) =>
    `${Object.keys(exam.answerKey).length}/${exam.numQuestions}`;

  return (
    <>
      <header className="mb-xl flex justify-between items-end">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-xs">Exams</h1>
          <p className="font-body-lg text-body-lg text-secondary">
            Configure answer keys, upload sheets, and view results.
          </p>
        </div>
        <button
          onClick={() => navigate("/exams/new")}
          className="py-sm px-lg bg-primary-container text-on-primary rounded-xl font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors shadow-sm flex items-center gap-sm"
        >
          <Icon name="add" size={18} />
          New Exam
        </button>
      </header>

      {error && (
        <div className="mb-lg p-md rounded-xl bg-error-container text-on-error-container font-body-md">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : exams.length === 0 ? (
        <div className="bg-surface-container-lowest border border-dashed border-outline-variant rounded-xl p-xl text-center text-on-surface-variant">
          <Icon name="assignment" size={40} className="text-outline" />
          <p className="mt-sm font-body-md">No exams yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-lg">
          {exams.map((exam) => (
            <div
              key={exam.id}
              className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg shadow-[0_1px_2px_rgba(0,0,0,0.05)] flex flex-col"
            >
              <div className="flex justify-between items-start mb-sm">
                <h2 className="font-headline-sm text-headline-sm text-on-background">{exam.name}</h2>
                <button
                  onClick={() => remove(exam.id)}
                  className="text-outline hover:text-error transition-colors p-xs rounded-full hover:bg-error-container"
                  title="Delete exam"
                >
                  <Icon name="delete" size={20} />
                </button>
              </div>
              <div className="flex flex-wrap gap-xs mb-md font-body-sm text-body-sm text-on-surface-variant">
                <span className="bg-surface-container px-sm py-xs rounded-full">
                  {exam.numQuestions} questions
                </span>
                <span className="bg-surface-container px-sm py-xs rounded-full">
                  +{exam.marksCorrect} / −{exam.marksPenalty}
                </span>
                <span className="bg-surface-container px-sm py-xs rounded-full">
                  Key {keyProgress(exam)}
                </span>
              </div>
              {exam.date && (
                <p className="font-body-sm text-body-sm text-secondary mb-md flex items-center gap-xs">
                  <Icon name="event" size={16} /> {exam.date}
                </p>
              )}
              <div className="mt-auto flex gap-xs pt-md border-t border-outline-variant">
                <Link
                  to={`/exams/${exam.id}`}
                  className="flex-1 text-center py-2 rounded-lg border border-outline-variant font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors"
                >
                  Answer Key
                </Link>
                <Link
                  to={`/upload/${exam.id}`}
                  className="flex-1 text-center py-2 rounded-lg border border-outline-variant font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors"
                >
                  Upload
                </Link>
                <Link
                  to={`/results/${exam.id}`}
                  className="flex-1 text-center py-2 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors"
                >
                  Results
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
