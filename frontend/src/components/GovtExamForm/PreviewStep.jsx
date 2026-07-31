import { useState } from "react";
import Icon from "../Icon.jsx";

export default function PreviewStep({ formData, updateFormData, onNext, onBack }) {
  const [agreed, setAgreed] = useState(formData.agreed || false);
  const [error, setError] = useState("");

  const fullName = [formData.firstName, formData.middleName, formData.lastName]
    .filter(Boolean)
    .join(" ");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!agreed) {
      setError("You must agree to the declaration before proceeding.");
      return;
    }
    setError("");
    updateFormData({ agreed: true });
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Notice Banner */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-blue-900 dark:text-blue-200 text-xs leading-relaxed flex items-start gap-3">
        <Icon name="verified" className="text-blue-600 shrink-0 mt-0.5" size={20} />
        <div>
          <span className="font-bold">Application Preview:</span> Please carefully review all details below. Once submitted, no further changes or edits can be made to your application.
        </div>
      </div>

      {/* Main Preview Card */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-outline-variant pb-4">
          <div>
            <span className="text-xs font-bold text-primary tracking-wider uppercase block">
              Common Recruitment Process (CRP)
            </span>
            <h2 className="text-lg font-bold text-on-surface">Application Preview Copy</h2>
          </div>
          <div className="text-right">
            <span className="text-xs text-on-surface-variant block">Registration No:</span>
            <span className="text-sm font-mono font-bold text-on-surface">2690841209</span>
          </div>
        </div>

        {/* Top Header Section with Photo */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
          <div className="md:col-span-3 space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-on-surface-variant block">Full Name:</span>
                <span className="font-bold text-on-surface text-sm">{fullName || "N/A"}</span>
              </div>
              <div>
                <span className="text-on-surface-variant block">Category:</span>
                <span className="font-bold text-on-surface text-sm">{formData.category || "N/A"}</span>
              </div>
              <div>
                <span className="text-on-surface-variant block">Mobile Number:</span>
                <span className="font-bold text-on-surface">+91 {formData.mobile || "N/A"}</span>
              </div>
              <div>
                <span className="text-on-surface-variant block">Email ID:</span>
                <span className="font-bold text-on-surface">{formData.email || "N/A"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center p-3 border border-outline-variant rounded-xl bg-surface">
            {formData.photoUrl ? (
              <img src={formData.photoUrl} alt="Candidate Photo" className="w-28 h-32 object-cover rounded-lg mb-2" />
            ) : (
              <div className="w-28 h-32 bg-surface-container-highest rounded-lg flex items-center justify-center text-xs text-on-surface-variant mb-2">
                No Photo
              </div>
            )}
            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
              <Icon name="check_circle" size={14} /> Photo Confirmed
            </span>
          </div>
        </div>

        {/* Bio & Family Info */}
        <div className="border-t border-outline-variant pt-4">
          <h3 className="font-bold text-xs text-primary uppercase tracking-wider mb-3">Personal Information</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-xs">
            <div>
              <span className="text-on-surface-variant block">Father's Name:</span>
              <span className="font-medium text-on-surface">{formData.fatherName || "N/A"}</span>
            </div>
            <div>
              <span className="text-on-surface-variant block">Mother's Name:</span>
              <span className="font-medium text-on-surface">{formData.motherName || "N/A"}</span>
            </div>
            <div>
              <span className="text-on-surface-variant block">Date of Birth:</span>
              <span className="font-medium text-on-surface">{formData.dob || "N/A"}</span>
            </div>
            <div>
              <span className="text-on-surface-variant block">Gender:</span>
              <span className="font-medium text-on-surface">{formData.gender || "N/A"}</span>
            </div>
            <div>
              <span className="text-on-surface-variant block">Religion:</span>
              <span className="font-medium text-on-surface">{formData.religion || "N/A"}</span>
            </div>
            <div>
              <span className="text-on-surface-variant block">State of Exam Center:</span>
              <span className="font-medium text-on-surface">{formData.state || "N/A"}</span>
            </div>
            <div>
              <span className="text-on-surface-variant block">Exam Center:</span>
              <span className="font-medium text-on-surface">{formData.examCenter || "N/A"}</span>
            </div>
            <div>
              <span className="text-on-surface-variant block">Marital Status:</span>
              <span className="font-medium text-on-surface">{formData.maritalStatus || "N/A"}</span>
            </div>
          </div>
        </div>

        {/* Correspondence Address & Education */}
        <div className="border-t border-outline-variant pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-bold text-xs text-primary uppercase tracking-wider mb-2">Correspondence Address</h3>
            <p className="text-xs text-on-surface leading-relaxed">
              {formData.corrAddr1 || "N/A"}<br />
              {formData.corrState} — {formData.corrPincode}
            </p>
          </div>

          <div>
            <h3 className="font-bold text-xs text-primary uppercase tracking-wider mb-2">Educational Qualification</h3>
            <div className="text-xs space-y-1">
              <div><span className="text-on-surface-variant">Degree:</span> <span className="font-bold">{formData.degree || "N/A"}</span></div>
              <div><span className="text-on-surface-variant">Percentage Marks:</span> <span className="font-bold">{formData.marksPercentage || "N/A"}%</span></div>
              <div><span className="text-on-surface-variant">Class:</span> <span className="font-bold">{formData.gradeClass || "N/A"}</span></div>
            </div>
          </div>
        </div>

        {/* Signature Preview & Declaration */}
        <div className="border-t border-outline-variant pt-4 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="w-full md:w-2/3 space-y-3">
            <h3 className="font-bold text-xs text-primary uppercase tracking-wider">Declaration</h3>
            <label className="flex items-start gap-3 cursor-pointer p-3 border border-outline-variant rounded-xl bg-surface hover:bg-surface-container-highest transition-all">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 rounded text-primary focus:ring-primary"
              />
              <span className="text-xs text-on-surface leading-relaxed">
                I hereby declare that all statements made in this application are true, complete and correct to the best of my knowledge and belief. I understand that in the event of any information being found untrue, my candidature is liable to be cancelled.
              </span>
            </label>
            {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
          </div>

          <div className="flex flex-col items-center justify-center p-3 border border-outline-variant rounded-xl bg-surface w-44">
            {formData.signatureUrl ? (
              <img src={formData.signatureUrl} alt="Candidate Signature" className="w-36 h-16 object-contain mb-2" />
            ) : (
              <div className="w-36 h-16 bg-surface-container-highest rounded-lg flex items-center justify-center text-xs text-on-surface-variant mb-2">
                No Signature
              </div>
            )}
            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
              <Icon name="check_circle" size={14} /> Signature Confirmed
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 border border-outline-variant text-on-surface rounded-xl font-semibold text-sm hover:bg-surface-container-highest transition-all flex items-center gap-2"
        >
          <Icon name="arrow_back" size={18} />
          Back
        </button>
        <button
          type="submit"
          className="px-6 py-2.5 bg-primary text-on-primary rounded-xl font-semibold text-sm hover:opacity-90 transition-all flex items-center gap-2 shadow-sm"
        >
          Proceed to Uploads
          <Icon name="arrow_forward" size={18} />
        </button>
      </div>
    </form>
  );
}
