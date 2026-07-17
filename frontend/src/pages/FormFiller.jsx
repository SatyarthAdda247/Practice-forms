import { useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";

const BANKS = [
  "Punjab National Bank",
  "Bank of Baroda",
  "Canara Bank",
  "Union Bank of India",
  "Bank of India",
];

const DOCUMENTS = [
  { key: "photo", icon: "photo_camera", label: "Passport Photo", spec: "20kb - 50kb" },
  { key: "signature", icon: "draw", label: "Signature", spec: "10kb - 20kb (Black Ink)" },
  { key: "thumb", icon: "fingerprint", label: "Left Thumb", spec: "20kb - 50kb" },
  { key: "declaration", icon: "edit_document", label: "Hand-written Decl.", spec: "50kb - 100kb" },
];

// Every field that counts toward the readiness percentage.
const TEXT_FIELDS = [
  "fullName",
  "dob",
  "category",
  "gender",
  "aadhar",
  "degree",
  "passingDate",
  "percentage",
  "university",
];

export default function FormFiller() {
  const [fields, setFields] = useState(() =>
    Object.fromEntries(TEXT_FIELDS.map((f) => [f, ""]))
  );
  const [banks, setBanks] = useState(() => Object.fromEntries(BANKS.map((b) => [b, false])));
  const [docs, setDocs] = useState(() => Object.fromEntries(DOCUMENTS.map((d) => [d.key, false])));

  const setField = (name) => (e) => setFields((f) => ({ ...f, [name]: e.target.value }));
  const toggleBank = (name) => () => setBanks((b) => ({ ...b, [name]: !b[name] }));
  const toggleDoc = (key) => () => setDocs((d) => ({ ...d, [key]: !d[key] }));

  const progress = useMemo(() => {
    const values = [
      ...Object.values(fields).map((v) => v.trim() !== ""),
      ...Object.values(banks),
      ...Object.values(docs),
    ];
    const filled = values.filter(Boolean).length;
    return Math.round((filled / values.length) * 100);
  }, [fields, banks, docs]);

  const complete = progress === 100;
  const barColor = complete ? "bg-tertiary" : "bg-primary";
  const pctColor = complete ? "text-tertiary" : "text-primary";

  return (
    <div className="w-full">
      <header className="mb-xl">
        <h1 className="font-headline-lg text-headline-lg text-on-surface">IBPS PO Form Planner</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs">
          Gather and organize your details before the application portal opens.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-gutter">
        {/* Left column — main form */}
        <div className="xl:col-span-2 flex flex-col gap-gutter">
          {/* Progress card */}
          <div className="bg-surface-container-low rounded-xl p-lg">
            <div className="flex justify-between items-end mb-sm">
              <div>
                <h3 className="font-headline-md text-headline-md text-on-surface">Form Readiness</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Track your data gathering progress.
                </p>
              </div>
              <span className={`font-headline-md text-headline-md ${pctColor}`}>{progress}%</span>
            </div>
            <div className="w-full bg-secondary-fixed rounded-full h-2">
              <div
                className={`${barColor} h-2 rounded-full transition-all duration-500 ease-in-out`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Personal details */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg">
            <h3 className="font-headline-md text-headline-md text-on-surface border-b border-outline-variant pb-sm mb-lg">
              Personal Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-lg">
              <Field label="Full Name (As per 10th Certificate)">
                <input
                  className={inputCls}
                  placeholder="E.g., Rahul Kumar"
                  type="text"
                  value={fields.fullName}
                  onChange={setField("fullName")}
                />
              </Field>
              <Field label="Date of Birth">
                <input className={inputCls} type="date" value={fields.dob} onChange={setField("dob")} />
              </Field>
              <Field label="Category">
                <select className={inputCls} value={fields.category} onChange={setField("category")}>
                  <option value="">Select Category</option>
                  <option value="ur">UR / General</option>
                  <option value="obc">OBC</option>
                  <option value="sc">SC</option>
                  <option value="st">ST</option>
                  <option value="ews">EWS</option>
                </select>
              </Field>
              <Field label="Gender">
                <select className={inputCls} value={fields.gender} onChange={setField("gender")}>
                  <option value="">Select Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Aadhar Card Number" className="md:col-span-2">
                <input
                  className={inputCls}
                  placeholder="12-digit number"
                  type="text"
                  value={fields.aadhar}
                  onChange={setField("aadhar")}
                />
              </Field>
            </div>
          </section>

          {/* Education details */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg">
            <h3 className="font-headline-md text-headline-md text-on-surface border-b border-outline-variant pb-sm mb-lg">
              Educational Qualifications
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-lg">
              <Field label="Degree (Graduation)">
                <select className={inputCls} value={fields.degree} onChange={setField("degree")}>
                  <option value="">Select Degree</option>
                  <option value="ba">B.A.</option>
                  <option value="bsc">B.Sc.</option>
                  <option value="bcom">B.Com.</option>
                  <option value="btech">B.Tech / B.E.</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Date of Passing (As on Marksheet)">
                <input
                  className={inputCls}
                  type="date"
                  value={fields.passingDate}
                  onChange={setField("passingDate")}
                />
              </Field>
              <Field label="Percentage of Marks">
                <input
                  className={inputCls}
                  placeholder="E.g., 65.50"
                  step="0.01"
                  type="number"
                  value={fields.percentage}
                  onChange={setField("percentage")}
                />
              </Field>
              <Field label="University / Institute">
                <input
                  className={inputCls}
                  placeholder="Name of University"
                  type="text"
                  value={fields.university}
                  onChange={setField("university")}
                />
              </Field>
            </div>
          </section>
        </div>

        {/* Right column — checklists & actions */}
        <div className="flex flex-col gap-gutter">
          {/* Bank preferences */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg">
            <div className="flex justify-between items-center border-b border-outline-variant pb-sm mb-lg">
              <h3 className="font-headline-md text-headline-md text-on-surface">Bank Preferences</h3>
              <Icon
                name="drag_indicator"
                className="text-primary cursor-pointer"
                title="Drag to reorder (visual only for now)"
              />
            </div>
            <p className="font-label-sm text-label-sm text-on-surface-variant mb-md">
              Plan your preference order before the portal opens.
            </p>
            <div className="flex flex-col gap-sm max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {BANKS.map((bank) => (
                <label
                  key={bank}
                  className="flex items-center gap-3 p-2 hover:bg-surface-container-lowest border border-transparent hover:border-outline-variant rounded transition-colors cursor-pointer"
                >
                  <input
                    className="form-checkbox text-primary rounded w-4 h-4"
                    type="checkbox"
                    checked={banks[bank]}
                    onChange={toggleBank(bank)}
                  />
                  <span className="font-body-sm text-body-sm">{bank}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Document checklist */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg">
            <h3 className="font-headline-md text-headline-md text-on-surface border-b border-outline-variant pb-sm mb-lg">
              Document Checklist
            </h3>
            <div className="flex flex-col gap-md">
              {DOCUMENTS.map((doc) => (
                <label
                  key={doc.key}
                  className="flex items-center justify-between p-3 border border-outline-variant rounded-lg bg-surface-bright cursor-pointer hover:bg-surface-container-lowest transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Icon name={doc.icon} className="text-outline" />
                    <div>
                      <p className="font-label-md text-label-md text-on-surface">{doc.label}</p>
                      <p className="font-label-sm text-label-sm text-outline">{doc.spec}</p>
                    </div>
                  </div>
                  <input
                    className="form-checkbox text-tertiary rounded-full w-5 h-5"
                    type="checkbox"
                    checked={docs[doc.key]}
                    onChange={toggleDoc(doc.key)}
                  />
                </label>
              ))}
            </div>
          </section>

          {/* Export actions */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg flex flex-col gap-md">
            <button className="flex items-center justify-center gap-2 w-full py-sm px-lg bg-primary-container text-on-primary rounded-lg font-label-md text-label-md hover:bg-on-primary-fixed-variant transition-colors">
              <Icon name="content_copy" size={20} />
              Copy All Details
            </button>
            <button className="flex items-center justify-center gap-2 w-full py-sm px-lg border border-primary text-primary rounded-lg font-label-md text-label-md hover:bg-surface-container-low transition-colors">
              <Icon name="download" size={20} />
              Download as PDF
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full border border-outline-variant rounded-lg px-3 py-2 font-body-md text-body-md text-on-surface bg-surface-container-lowest focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all";

function Field({ label, className = "", children }) {
  return (
    <div className={className}>
      <label className="block mb-xs font-label-sm text-label-sm text-on-surface-variant">
        {label}
      </label>
      {children}
    </div>
  );
}
