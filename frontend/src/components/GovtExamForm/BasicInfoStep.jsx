import { useState, useEffect } from "react";
import Icon from "../Icon.jsx";

const CAPTCHA_CODES = ["7K92M", "X4P9Q", "3M8NW", "9L2TY", "5B8VR", "W6K1Z"];

export default function BasicInfoStep({ formData, updateFormData, onNext }) {
  const [captchaIndex, setCaptchaIndex] = useState(0);
  const [errors, setErrors] = useState({});

  const captchaCode = CAPTCHA_CODES[captchaIndex];

  const refreshCaptcha = () => {
    setCaptchaIndex((prev) => (prev + 1) % CAPTCHA_CODES.length);
  };

  const handleChange = (field, value) => {
    // Upper case text inputs as per standard IBPS convention
    const uppercaseFields = ["firstName", "cFirstName", "middleName", "cMiddleName", "lastName", "cLastName"];
    const formattedValue = uppercaseFields.includes(field) ? value.toUpperCase() : value;

    updateFormData({ [field]: formattedValue });

    // Clear specific error on edit
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  // Compute full name preview dynamically
  const computedFullName = [formData.firstName, formData.middleName, formData.lastName]
    .filter(Boolean)
    .join(" ");

  const validate = () => {
    const errs = {};
    if (!formData.firstName?.trim()) errs.firstName = "First Name is required";
    if (!formData.cFirstName?.trim()) errs.cFirstName = "Confirm First Name is required";
    if (formData.firstName?.trim() && formData.cFirstName?.trim() && formData.firstName.trim() !== formData.cFirstName.trim()) {
      errs.cFirstName = "First Name and Confirm First Name do not match";
    }

    if (formData.middleName?.trim() !== formData.cMiddleName?.trim()) {
      errs.cMiddleName = "Middle Name and Confirm Middle Name do not match";
    }

    if (formData.lastName?.trim() !== formData.cLastName?.trim()) {
      errs.cLastName = "Last Name and Confirm Last Name do not match";
    }

    if (!formData.mobile?.trim()) {
      errs.mobile = "Mobile Number is required";
    } else if (!/^[6-9]\d{9}$/.test(formData.mobile.trim())) {
      errs.mobile = "Enter a valid 10-digit mobile number";
    }

    if (!formData.cMobile?.trim()) {
      errs.cMobile = "Confirm Mobile Number is required";
    } else if (formData.mobile?.trim() !== formData.cMobile?.trim()) {
      errs.cMobile = "Mobile Number and Confirm Mobile Number do not match";
    }

    if (!formData.email?.trim()) {
      errs.email = "Email ID is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errs.email = "Enter a valid email address";
    }

    if (!formData.cEmail?.trim()) {
      errs.cEmail = "Confirm Email ID is required";
    } else if (formData.email?.trim().toLowerCase() !== formData.cEmail?.trim().toLowerCase()) {
      errs.cEmail = "Email ID and Confirm Email ID do not match";
    }

    if (!formData.captcha?.trim()) {
      errs.captcha = "Security code is required";
    } else if (formData.captcha.trim().toUpperCase() !== captchaCode) {
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
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-amber-900 dark:text-amber-200 text-xs leading-relaxed flex items-start gap-3">
        <Icon name="info" className="text-amber-600 shrink-0 mt-0.5" size={20} />
        <div>
          <span className="font-bold">Important Note:</span> The name entered in the application form should match exactly with the ID proof to be produced at the time of examination/interview. Up to 35 characters will be printed on your call letter.
        </div>
      </div>

      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="person" className="text-primary" /> Personal Name Details
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* First Name */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              maxLength={35}
              value={formData.firstName || ""}
              onChange={(e) => handleChange("firstName", e.target.value)}
              placeholder="e.g. AMIT"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none transition-all ${
                errors.firstName ? "border-red-500 focus:ring-2 focus:ring-red-500/20" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>}
          </div>

          {/* Confirm First Name */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Confirm First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              maxLength={35}
              value={formData.cFirstName || ""}
              onChange={(e) => handleChange("cFirstName", e.target.value)}
              placeholder="Confirm First Name"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none transition-all ${
                errors.cFirstName ? "border-red-500 focus:ring-2 focus:ring-red-500/20" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.cFirstName && <p className="text-xs text-red-500 mt-1">{errors.cFirstName}</p>}
          </div>

          {/* Middle Name */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">Middle Name</label>
            <input
              type="text"
              maxLength={35}
              value={formData.middleName || ""}
              onChange={(e) => handleChange("middleName", e.target.value)}
              placeholder="e.g. KUMAR"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface text-sm focus:outline-none focus:border-primary transition-all"
            />
          </div>

          {/* Confirm Middle Name */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">Confirm Middle Name</label>
            <input
              type="text"
              maxLength={35}
              value={formData.cMiddleName || ""}
              onChange={(e) => handleChange("cMiddleName", e.target.value)}
              placeholder="Confirm Middle Name"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none transition-all ${
                errors.cMiddleName ? "border-red-500 focus:ring-2 focus:ring-red-500/20" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.cMiddleName && <p className="text-xs text-red-500 mt-1">{errors.cMiddleName}</p>}
          </div>

          {/* Last Name */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">Last Name</label>
            <input
              type="text"
              maxLength={35}
              value={formData.lastName || ""}
              onChange={(e) => handleChange("lastName", e.target.value)}
              placeholder="e.g. SHARMA"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface text-sm focus:outline-none focus:border-primary transition-all"
            />
          </div>

          {/* Confirm Last Name */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">Confirm Last Name</label>
            <input
              type="text"
              maxLength={35}
              value={formData.cLastName || ""}
              onChange={(e) => handleChange("cLastName", e.target.value)}
              placeholder="Confirm Last Name"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none transition-all ${
                errors.cLastName ? "border-red-500 focus:ring-2 focus:ring-red-500/20" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.cLastName && <p className="text-xs text-red-500 mt-1">{errors.cLastName}</p>}
          </div>
        </div>

        {/* Full Name Preview Box */}
        <div className="bg-surface-container-highest/60 rounded-xl p-4 border border-outline-variant">
          <span className="text-xs text-on-surface-variant font-medium block mb-1">Full Name Preview:</span>
          <span className="text-base font-bold text-primary tracking-wide">
            {computedFullName || "—"}
          </span>
        </div>
      </div>

      {/* Contact Details Card */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="call" className="text-primary" /> Contact Details
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Mobile */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Mobile Number <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-on-surface-variant">
                +91
              </span>
              <input
                type="tel"
                maxLength={10}
                value={formData.mobile || ""}
                onChange={(e) => handleChange("mobile", e.target.value.replace(/\D/g, ""))}
                placeholder="10-digit Mobile Number"
                className={`w-full pl-11 pr-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none transition-all ${
                  errors.mobile ? "border-red-500 focus:ring-2 focus:ring-red-500/20" : "border-outline-variant focus:border-primary"
                }`}
              />
            </div>
            {errors.mobile && <p className="text-xs text-red-500 mt-1">{errors.mobile}</p>}
          </div>

          {/* Confirm Mobile */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Confirm Mobile Number <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-on-surface-variant">
                +91
              </span>
              <input
                type="tel"
                maxLength={10}
                value={formData.cMobile || ""}
                onChange={(e) => handleChange("cMobile", e.target.value.replace(/\D/g, ""))}
                placeholder="Re-enter Mobile Number"
                className={`w-full pl-11 pr-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none transition-all ${
                  errors.cMobile ? "border-red-500 focus:ring-2 focus:ring-red-500/20" : "border-outline-variant focus:border-primary"
                }`}
              />
            </div>
            {errors.cMobile && <p className="text-xs text-red-500 mt-1">{errors.cMobile}</p>}
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Email ID <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={formData.email || ""}
              onChange={(e) => handleChange("email", e.target.value)}
              placeholder="candidate@example.com"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none transition-all ${
                errors.email ? "border-red-500 focus:ring-2 focus:ring-red-500/20" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>

          {/* Confirm Email */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Confirm Email ID <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              onPaste={(e) => e.preventDefault()}
              value={formData.cEmail || ""}
              onChange={(e) => handleChange("cEmail", e.target.value)}
              placeholder="Re-enter Email ID (Paste Disabled)"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none transition-all ${
                errors.cEmail ? "border-red-500 focus:ring-2 focus:ring-red-500/20" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.cEmail && <p className="text-xs text-red-500 mt-1">{errors.cEmail}</p>}
          </div>
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
            onClick={refreshCaptcha}
            className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-highest transition-colors"
            title="Refresh Security Code"
          >
            <Icon name="refresh" size={22} />
          </button>
        </div>

        <div className="w-full md:w-64">
          <input
            type="text"
            maxLength={6}
            value={formData.captcha || ""}
            onChange={(e) => handleChange("captcha", e.target.value)}
            placeholder="Enter Security Code"
            className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm uppercase focus:outline-none ${
              errors.captcha ? "border-red-500" : "border-outline-variant focus:border-primary"
            }`}
          />
          {errors.captcha && <p className="text-xs text-red-500 mt-1">{errors.captcha}</p>}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-2">
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
