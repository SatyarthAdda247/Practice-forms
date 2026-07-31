import { useState } from "react";
import Icon from "../Icon.jsx";

export default function PhotoSigStep({ formData, updateFormData, onNext, onBack }) {
  const [photoError, setPhotoError] = useState("");
  const [sigError, setSigError] = useState("");
  const [errors, setErrors] = useState({});

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check size (20KB - 50KB)
    const fileSizeKB = file.size / 1024;
    if (fileSizeKB < 15 || fileSizeKB > 60) {
      setPhotoError(`File size is ${fileSizeKB.toFixed(1)} KB. Photo must be between 20 KB and 50 KB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setPhotoError("");
        updateFormData({
          photoUrl: event.target.result,
          photoConfirmed: false,
        });
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleSigUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check size (10KB - 20KB)
    const fileSizeKB = file.size / 1024;
    if (fileSizeKB < 8 || fileSizeKB > 30) {
      setSigError(`File size is ${fileSizeKB.toFixed(1)} KB. Signature must be between 10 KB and 20 KB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setSigError("");
        updateFormData({
          signatureUrl: event.target.result,
          signatureConfirmed: false,
        });
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const validate = () => {
    const errs = {};

    if (!formData.photoUrl) {
      errs.photo = "Please upload candidate photograph";
    } else if (!formData.photoConfirmed) {
      errs.photoConfirmed = "Please confirm that this is your valid photo";
    }

    if (!formData.signatureUrl) {
      errs.signature = "Please upload candidate signature";
    } else if (!formData.signatureConfirmed) {
      errs.signatureConfirmed = "Please confirm that this is your valid signature";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onNext();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Upload Guidelines */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="add_a_photo" className="text-primary" /> Candidate Photo & Signature Upload
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Photo Upload Card */}
          <div className="border border-outline-variant rounded-xl p-5 bg-surface space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm text-on-surface">1. Candidate Photograph</h3>
                <span className="text-[11px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  20 KB - 50 KB
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mb-4">
                Passport size photo against a light background. 200 x 230 pixels recommended.
              </p>

              {/* Photo Preview Box */}
              <div className="w-36 h-44 border-2 border-dashed border-outline-variant rounded-xl mx-auto flex items-center justify-center overflow-hidden bg-surface-container-highest relative">
                {formData.photoUrl ? (
                  <img src={formData.photoUrl} alt="Candidate Photo" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center p-3 text-on-surface-variant/60">
                    <Icon name="person" size={48} className="mx-auto mb-1 opacity-50" />
                    <span className="text-[11px] block">No photo uploaded</span>
                  </div>
                )}
              </div>

              {photoError && <p className="text-xs text-red-500 text-center mt-2 font-medium">{photoError}</p>}
              {errors.photo && <p className="text-xs text-red-500 text-center mt-2 font-medium">{errors.photo}</p>}
            </div>

            <div className="space-y-3 pt-2">
              <label className="block w-full text-center px-4 py-2 bg-secondary-container text-on-secondary-container rounded-xl font-semibold text-xs cursor-pointer hover:opacity-90 transition-all">
                Select Photo File
                <input type="file" accept="image/jpeg,image/png" onChange={handlePhotoUpload} className="hidden" />
              </label>

              {formData.photoUrl && (
                <label className="flex items-start gap-2 cursor-pointer pt-2">
                  <input
                    type="checkbox"
                    checked={formData.photoConfirmed || false}
                    onChange={(e) => updateFormData({ photoConfirmed: e.target.checked })}
                    className="mt-0.5 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-xs text-on-surface">
                    I confirm that this is my valid photograph and it is clear and legible.
                  </span>
                </label>
              )}
              {errors.photoConfirmed && <p className="text-xs text-red-500 font-medium">{errors.photoConfirmed}</p>}
            </div>
          </div>

          {/* Signature Upload Card */}
          <div className="border border-outline-variant rounded-xl p-5 bg-surface space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm text-on-surface">2. Candidate Signature</h3>
                <span className="text-[11px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  10 KB - 20 KB
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mb-4">
                Signature on white paper with black ink pen. Capital letters signature is NOT accepted.
              </p>

              {/* Signature Preview Box */}
              <div className="w-48 h-24 border-2 border-dashed border-outline-variant rounded-xl mx-auto flex items-center justify-center overflow-hidden bg-surface-container-highest relative">
                {formData.signatureUrl ? (
                  <img src={formData.signatureUrl} alt="Candidate Signature" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="text-center p-2 text-on-surface-variant/60">
                    <Icon name="draw" size={36} className="mx-auto mb-1 opacity-50" />
                    <span className="text-[11px] block">No signature uploaded</span>
                  </div>
                )}
              </div>

              {sigError && <p className="text-xs text-red-500 text-center mt-2 font-medium">{sigError}</p>}
              {errors.signature && <p className="text-xs text-red-500 text-center mt-2 font-medium">{errors.signature}</p>}
            </div>

            <div className="space-y-3 pt-2">
              <label className="block w-full text-center px-4 py-2 bg-secondary-container text-on-secondary-container rounded-xl font-semibold text-xs cursor-pointer hover:opacity-90 transition-all">
                Select Signature File
                <input type="file" accept="image/jpeg,image/png" onChange={handleSigUpload} className="hidden" />
              </label>

              {formData.signatureUrl && (
                <label className="flex items-start gap-2 cursor-pointer pt-2">
                  <input
                    type="checkbox"
                    checked={formData.signatureConfirmed || false}
                    onChange={(e) => updateFormData({ signatureConfirmed: e.target.checked })}
                    className="mt-0.5 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-xs text-on-surface">
                    I confirm that this is my valid signature and it is clear and legible.
                  </span>
                </label>
              )}
              {errors.signatureConfirmed && <p className="text-xs text-red-500 font-medium">{errors.signatureConfirmed}</p>}
            </div>
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
          Save & Next
          <Icon name="arrow_forward" size={18} />
        </button>
      </div>
    </form>
  );
}
