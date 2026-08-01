import { useState } from "react";
import Icon from "../Icon.jsx";

const CAPTCHA_CODES = ["9P3K7", "L4M8X", "2R9TV", "5Y6BW", "8Z1NC"];

export default function UploadsStep({ formData, updateFormData, onNext, onBack }) {
  const [captchaIndex, setCaptchaIndex] = useState(0);
  const [errors, setErrors] = useState({});
  const [thumbErr, setThumbErr] = useState("");
  const [declErr, setDeclErr] = useState("");
  const [certErr, setCertErr] = useState("");

  const captchaCode = CAPTCHA_CODES[captchaIndex];

  const handleThumbUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fileSizeKB = file.size / 1024;
    if (fileSizeKB < 15 || fileSizeKB > 60) {
      setThumbErr(`File size is ${fileSizeKB.toFixed(1)} KB. Must be between 20 KB and 50 KB.`);
      return;
    }
    setThumbErr("");
    const reader = new FileReader();
    reader.onload = (evt) => updateFormData({ thumbUrl: evt.target.result, thumbName: file.name });
    reader.readAsDataURL(file);
  };

  const handleDeclUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fileSizeKB = file.size / 1024;
    if (fileSizeKB < 40 || fileSizeKB > 110) {
      setDeclErr(`File size is ${fileSizeKB.toFixed(1)} KB. Must be between 50 KB and 100 KB.`);
      return;
    }
    setDeclErr("");
    const reader = new FileReader();
    reader.onload = (evt) => updateFormData({ declUrl: evt.target.result, declName: file.name });
    reader.readAsDataURL(file);
  };

  const handleCertUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fileSizeKB = file.size / 1024;
    if (fileSizeKB < 80 || fileSizeKB > 550) {
      setCertErr(`File size is ${fileSizeKB.toFixed(1)} KB. Must be between 100 KB and 500 KB.`);
      return;
    }
    setCertErr("");
    updateFormData({ certName: file.name, certUploaded: true });
  };

  const validate = () => {
    const errs = {};
    if (!formData.thumbUrl) errs.thumb = "Left thumb impression is required";
    if (!formData.declUrl) errs.decl = "Handwritten declaration is required";
    if (!formData.certUploaded) errs.cert = "10th / SSLC Certificate is required";
    if (!formData.uploadCaptcha?.trim()) {
      errs.captcha = "Security code is required";
    } else if (formData.uploadCaptcha.trim().toUpperCase() !== captchaCode) {
      errs.captcha = "Invalid security code";
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
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="upload_file" className="text-primary" /> Required Documents Upload
        </h2>

        {/* 1. Left Thumb Impression */}
        <div className="border border-outline-variant rounded-xl p-4 bg-surface flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-on-surface">1. Left Thumb Impression</h3>
              <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">20 KB - 50 KB</span>
            </div>
            <p className="text-xs text-on-surface-variant">White paper with blue or black ink. File type: .jpg / .jpeg</p>
            {thumbErr && <p className="text-xs text-red-500 font-medium">{thumbErr}</p>}
            {errors.thumb && <p className="text-xs text-red-500 font-medium">{errors.thumb}</p>}
            {formData.thumbName && <p className="text-xs text-emerald-600 font-bold flex items-center gap-1"><Icon name="check_circle" size={14} /> {formData.thumbName}</p>}
          </div>

          <label className="px-4 py-2 bg-secondary-container text-on-secondary-container rounded-xl font-semibold text-xs cursor-pointer hover:opacity-90 transition-all shrink-0">
            Upload Thumb Impression
            <input type="file" accept="image/jpeg,image/png" onChange={handleThumbUpload} className="hidden" />
          </label>
        </div>

        {/* 2. Hand Written Declaration */}
        <div className="border border-outline-variant rounded-xl p-4 bg-surface flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-on-surface">2. Hand Written Declaration</h3>
              <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">50 KB - 100 KB</span>
            </div>
            <p className="text-xs text-on-surface-variant">Written clearly in English on white paper with black ink. Capital letters text NOT accepted.</p>
            {declErr && <p className="text-xs text-red-500 font-medium">{declErr}</p>}
            {errors.decl && <p className="text-xs text-red-500 font-medium">{errors.decl}</p>}
            {formData.declName && <p className="text-xs text-emerald-600 font-bold flex items-center gap-1"><Icon name="check_circle" size={14} /> {formData.declName}</p>}
          </div>

          <label className="px-4 py-2 bg-secondary-container text-on-secondary-container rounded-xl font-semibold text-xs cursor-pointer hover:opacity-90 transition-all shrink-0">
            Upload Declaration
            <input type="file" accept="image/jpeg,image/png" onChange={handleDeclUpload} className="hidden" />
          </label>
        </div>

        {/* 3. 10th Certificate / Proof of DOB */}
        <div className="border border-outline-variant rounded-xl p-4 bg-surface flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-on-surface">3. 10th / SSLC Certificate (Proof of Date of Birth)</h3>
              <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">100 KB - 500 KB</span>
            </div>
            <p className="text-xs text-on-surface-variant">Self-attested copy of 10th mark sheet showing DOB. File type: .pdf or .jpg</p>
            {certErr && <p className="text-xs text-red-500 font-medium">{certErr}</p>}
            {errors.cert && <p className="text-xs text-red-500 font-medium">{errors.cert}</p>}
            {formData.certName && <p className="text-xs text-emerald-600 font-bold flex items-center gap-1"><Icon name="check_circle" size={14} /> {formData.certName}</p>}
          </div>

          <label className="px-4 py-2 bg-secondary-container text-on-secondary-container rounded-xl font-semibold text-xs cursor-pointer hover:opacity-90 transition-all shrink-0">
            Upload Certificate
            <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={handleCertUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* Security Captcha */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-surface-container-highest text-primary font-mono text-xl font-bold tracking-widest px-4 py-2 rounded-xl border border-outline-variant line-through select-none">
            {captchaCode}
          </div>
          <button
            type="button"
            onClick={() => setCaptchaIndex((prev) => (prev + 1) % CAPTCHA_CODES.length)}
            className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-highest transition-colors"
          >
            <Icon name="refresh" size={22} />
          </button>
        </div>

        <div className="w-full md:w-64">
          <input
            type="text"
            maxLength={6}
            value={formData.uploadCaptcha || ""}
            onChange={(e) => updateFormData({ uploadCaptcha: e.target.value })}
            placeholder="Enter Security Code"
            className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm uppercase focus:outline-none ${
              errors.captcha ? "border-red-500" : "border-outline-variant focus:border-primary"
            }`}
          />
          {errors.captcha && <p className="text-xs text-red-500 mt-1">{errors.captcha}</p>}
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
          Save & Proceed to Payment
          <Icon name="arrow_forward" size={18} />
        </button>
      </div>
    </form>
  );
}
