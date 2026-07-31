import { useState } from "react";
import Icon from "../Icon.jsx";

const CATEGORIES = [
  { id: "UR", label: "General (UR)", fee: 850 },
  { id: "EWS", label: "Economically Weaker Section (EWS)", fee: 850 },
  { id: "OBC", label: "Other Backward Classes (OBC)", fee: 850 },
  { id: "SC", label: "Scheduled Caste (SC)", fee: 175 },
  { id: "ST", label: "Scheduled Tribe (ST)", fee: 175 },
];

const STATES = [
  "Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi (NCR)", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Odisha", "Punjab", "Rajasthan", "Tamil Nadu", "Telangana", "Uttar Pradesh", "West Bengal"
];

export default function DetailsStep({ formData, updateFormData, onNext, onBack }) {
  const [errors, setErrors] = useState({});

  const handleChange = (field, value) => {
    updateFormData({ [field]: value });
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handleCategoryChange = (catId) => {
    const selected = CATEGORIES.find((c) => c.id === catId);
    updateFormData({
      category: catId,
      applicationFee: selected ? selected.fee : 850,
    });
  };

  const handleSameAddress = (e) => {
    const checked = e.target.checked;
    updateFormData({
      sameAddress: checked,
      ...(checked
        ? {
            permAddr1: formData.corrAddr1 || "",
            permAddr2: formData.corrAddr2 || "",
            permState: formData.corrState || "",
            permPincode: formData.corrPincode || "",
          }
        : {}),
    });
  };

  const validate = () => {
    const errs = {};
    if (!formData.category) errs.category = "Category selection is required";
    if (!formData.religion) errs.religion = "Religion is required";
    if (!formData.nationality) errs.nationality = "Nationality is required";
    if (!formData.state) errs.state = "State of exam center is required";
    if (!formData.examCenter) errs.examCenter = "Exam center is required";
    if (!formData.dob) errs.dob = "Date of birth is required";
    if (!formData.gender) errs.gender = "Gender is required";
    if (!formData.fatherName?.trim()) errs.fatherName = "Father's name is required";
    if (!formData.motherName?.trim()) errs.motherName = "Mother's name is required";

    if (!formData.corrAddr1?.trim()) errs.corrAddr1 = "Address Line 1 is required";
    if (!formData.corrState) errs.corrState = "State is required";
    if (!formData.corrPincode?.trim() || !/^\d{6}$/.test(formData.corrPincode.trim())) {
      errs.corrPincode = "Enter a valid 6-digit Pincode";
    }

    if (!formData.degree?.trim()) errs.degree = "Graduation Degree Name is required";
    if (!formData.marksPercentage?.trim()) errs.marksPercentage = "Percentage of marks is required";

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
      {/* Category & Reservation Details */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="category" className="text-primary" /> Category & Reservation Details
        </h2>

        <div>
          <label className="block text-xs font-semibold text-on-surface mb-2">
            Category <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {CATEGORIES.map((cat) => (
              <label
                key={cat.id}
                className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                  formData.category === cat.id
                    ? "border-primary bg-primary/5 text-primary font-bold shadow-xs"
                    : "border-outline-variant bg-surface hover:bg-surface-container-highest"
                }`}
              >
                <input
                  type="radio"
                  name="category"
                  value={cat.id}
                  checked={formData.category === cat.id}
                  onChange={() => handleCategoryChange(cat.id)}
                  className="text-primary focus:ring-primary"
                />
                <div className="text-xs">
                  <div className="font-bold">{cat.label}</div>
                  <div className="text-[11px] text-on-surface-variant font-normal">Fee: ₹{cat.fee}</div>
                </div>
              </label>
            ))}
          </div>
          {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Religion */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Religion <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.religion || ""}
              onChange={(e) => handleChange("religion", e.target.value)}
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.religion ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            >
              <option value="">Select Religion</option>
              <option value="Hindu">Hindu</option>
              <option value="Muslim">Muslim</option>
              <option value="Christian">Christian</option>
              <option value="Sikh">Sikh</option>
              <option value="Buddhist">Buddhist</option>
              <option value="Jain">Jain</option>
              <option value="Others">Others</option>
            </select>
            {errors.religion && <p className="text-xs text-red-500 mt-1">{errors.religion}</p>}
          </div>

          {/* Nationality */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Nationality / Citizenship <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.nationality || "Indian"}
              onChange={(e) => handleChange("nationality", e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface text-sm focus:outline-none focus:border-primary"
            >
              <option value="Indian">Indian</option>
              <option value="Subject of Nepal">Subject of Nepal</option>
              <option value="Subject of Bhutan">Subject of Bhutan</option>
            </select>
          </div>
        </div>
      </div>

      {/* Exam Center Choice */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="location_on" className="text-primary" /> Examination Center Preferences
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              State / UT to which Center belongs <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.state || ""}
              onChange={(e) => handleChange("state", e.target.value)}
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.state ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            >
              <option value="">Select State</option>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {errors.state && <p className="text-xs text-red-500 mt-1">{errors.state}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Center of Preliminary Examination <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.examCenter || ""}
              onChange={(e) => handleChange("examCenter", e.target.value)}
              placeholder="e.g. New Delhi / Noida / Gurgaon"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.examCenter ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.examCenter && <p className="text-xs text-red-500 mt-1">{errors.examCenter}</p>}
          </div>
        </div>
      </div>

      {/* Personal Bio Details */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="badge" className="text-primary" /> Personal Bio Data
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Date of Birth <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={formData.dob || ""}
              onChange={(e) => handleChange("dob", e.target.value)}
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.dob ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.dob && <p className="text-xs text-red-500 mt-1">{errors.dob}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Gender <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.gender || ""}
              onChange={(e) => handleChange("gender", e.target.value)}
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.gender ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            >
              <option value="">Select Gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Transgender">Transgender</option>
            </select>
            {errors.gender && <p className="text-xs text-red-500 mt-1">{errors.gender}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">Marital Status</label>
            <select
              value={formData.maritalStatus || "Unmarried"}
              onChange={(e) => handleChange("maritalStatus", e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface text-sm focus:outline-none focus:border-primary"
            >
              <option value="Unmarried">Unmarried</option>
              <option value="Married">Married</option>
              <option value="Widow">Widow</option>
              <option value="Divorced">Divorced</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Father's Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.fatherName || ""}
              onChange={(e) => handleChange("fatherName", e.target.value.toUpperCase())}
              placeholder="FATHER'S FULL NAME"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm uppercase focus:outline-none ${
                errors.fatherName ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.fatherName && <p className="text-xs text-red-500 mt-1">{errors.fatherName}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Mother's Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.motherName || ""}
              onChange={(e) => handleChange("motherName", e.target.value.toUpperCase())}
              placeholder="MOTHER'S FULL NAME"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm uppercase focus:outline-none ${
                errors.motherName ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.motherName && <p className="text-xs text-red-500 mt-1">{errors.motherName}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">Spouse's Name (if married)</label>
            <input
              type="text"
              value={formData.spouseName || ""}
              onChange={(e) => handleChange("spouseName", e.target.value.toUpperCase())}
              placeholder="SPOUSE'S NAME"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface text-sm uppercase focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>

      {/* Address Details */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="home" className="text-primary" /> Address for Correspondence
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Address Line 1 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.corrAddr1 || ""}
              onChange={(e) => handleChange("corrAddr1", e.target.value)}
              placeholder="House/Flat No, Building Name, Street"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.corrAddr1 ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.corrAddr1 && <p className="text-xs text-red-500 mt-1">{errors.corrAddr1}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">State <span className="text-red-500">*</span></label>
            <select
              value={formData.corrState || ""}
              onChange={(e) => handleChange("corrState", e.target.value)}
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.corrState ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            >
              <option value="">Select State</option>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {errors.corrState && <p className="text-xs text-red-500 mt-1">{errors.corrState}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">Pincode <span className="text-red-500">*</span></label>
            <input
              type="text"
              maxLength={6}
              value={formData.corrPincode || ""}
              onChange={(e) => handleChange("corrPincode", e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit Pincode"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.corrPincode ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.corrPincode && <p className="text-xs text-red-500 mt-1">{errors.corrPincode}</p>}
          </div>
        </div>
      </div>

      {/* Educational Qualification */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="school" className="text-primary" /> Educational Qualification (as on closing date)
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Graduation Degree <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.degree || ""}
              onChange={(e) => handleChange("degree", e.target.value)}
              placeholder="e.g. B.Tech / B.Sc / B.Com / B.A."
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.degree ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.degree && <p className="text-xs text-red-500 mt-1">{errors.degree}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Percentage of Marks (%) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              maxLength={5}
              value={formData.marksPercentage || ""}
              onChange={(e) => handleChange("marksPercentage", e.target.value)}
              placeholder="e.g. 78.50"
              className={`w-full px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface text-sm focus:outline-none ${
                errors.marksPercentage ? "border-red-500" : "border-outline-variant focus:border-primary"
              }`}
            />
            {errors.marksPercentage && <p className="text-xs text-red-500 mt-1">{errors.marksPercentage}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">Class / Grade</label>
            <select
              value={formData.gradeClass || "First Class"}
              onChange={(e) => handleChange("gradeClass", e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface text-sm focus:outline-none focus:border-primary"
            >
              <option value="First Class">First Class</option>
              <option value="Second Class">Second Class</option>
              <option value="Pass Class">Pass Class</option>
            </select>
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
