import { useState } from "react";
import Icon from "../Icon.jsx";

const CAPTCHA_CODES = ["4K82P", "8M2XQ", "1N9TY", "6B3VR", "7W5Z1"];

export default function PaymentStep({ formData, updateFormData, onBack, onReset }) {
  const [captchaIndex, setCaptchaIndex] = useState(0);
  const [paymentMode, setPaymentMode] = useState("upi");
  const [isCompleted, setIsCompleted] = useState(false);
  const [errors, setErrors] = useState({});

  const captchaCode = CAPTCHA_CODES[captchaIndex];
  const feeAmount = formData.applicationFee || (["SC", "ST"].includes(formData.category) ? 175 : 850);

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!formData.paymentCaptcha?.trim()) {
      errs.captcha = "Security code is required";
    } else if (formData.paymentCaptcha.trim().toUpperCase() !== captchaCode) {
      errs.captcha = "Invalid security code";
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setErrors({});
    setIsCompleted(true);
  };

  const fullName = [formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(" ");

  if (isCompleted) {
    return (
      <div className="bg-surface-container-low border border-emerald-500/30 rounded-2xl p-8 shadow-md space-y-6 text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
          <Icon name="check_circle" size={40} />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-bold text-emerald-600 tracking-wider uppercase">
            Application Submitted Successfully
          </span>
          <h2 className="text-2xl font-bold text-on-surface">Registration Confirmation Receipt</h2>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">
            Your application for CRP PO/MT-XVI Practice Exam has been registered successfully.
          </p>
        </div>

        {/* Credentials Card */}
        <div className="bg-surface-container-highest/60 border border-outline-variant rounded-2xl p-6 max-w-lg mx-auto grid grid-cols-2 gap-4 text-left">
          <div>
            <span className="text-xs text-on-surface-variant block">Registration Number:</span>
            <span className="text-lg font-mono font-bold text-primary">2690841209</span>
          </div>
          <div>
            <span className="text-xs text-on-surface-variant block">Password:</span>
            <span className="text-lg font-mono font-bold text-primary">Xk92#bP</span>
          </div>
          <div>
            <span className="text-xs text-on-surface-variant block">Candidate Name:</span>
            <span className="text-sm font-bold text-on-surface">{fullName || "AMIT KUMAR"}</span>
          </div>
          <div>
            <span className="text-xs text-on-surface-variant block">Transaction ID:</span>
            <span className="text-sm font-mono font-bold text-on-surface">TXN984210984</span>
          </div>
          <div>
            <span className="text-xs text-on-surface-variant block">Amount Paid:</span>
            <span className="text-sm font-bold text-emerald-600">₹{feeAmount}.00</span>
          </div>
          <div>
            <span className="text-xs text-on-surface-variant block">Payment Status:</span>
            <span className="text-sm font-bold text-emerald-600">SUCCESS</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <button
            onClick={() => window.print()}
            className="px-6 py-2.5 bg-secondary-container text-on-secondary-container rounded-xl font-semibold text-sm hover:opacity-90 transition-all flex items-center gap-2"
          >
            <Icon name="print" size={18} />
            Print Application Copy
          </button>
          <button
            onClick={onReset}
            className="px-6 py-2.5 bg-primary text-on-primary rounded-xl font-semibold text-sm hover:opacity-90 transition-all flex items-center gap-2 shadow-sm"
          >
            <Icon name="restart_alt" size={18} />
            Start New Practice Form
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
        <h2 className="text-lg font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
          <Icon name="payments" className="text-primary" /> Application Fee Payment
        </h2>

        {/* Fee Summary */}
        <div className="bg-surface p-4 rounded-xl border border-outline-variant flex items-center justify-between">
          <div>
            <span className="text-xs text-on-surface-variant block">Total Application Fee ({formData.category || "General"} Category):</span>
            <span className="text-xs text-on-surface-variant">Includes Intimation Charges & Payment Gateway Taxes</span>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold text-primary">₹{feeAmount}.00</span>
          </div>
        </div>

        {/* Payment Modes */}
        <div>
          <label className="block text-xs font-semibold text-on-surface mb-3">Select Payment Gateway Mode</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { id: "upi", label: "UPI / QR Code", icon: "qr_code_scanner" },
              { id: "card", label: "Debit / Credit Card", icon: "credit_card" },
              { id: "netbanking", label: "Net Banking", icon: "account_balance" },
            ].map((mode) => (
              <button
                type="button"
                key={mode.id}
                onClick={() => setPaymentMode(mode.id)}
                className={`p-4 rounded-xl border flex flex-col items-center gap-2 text-center transition-all ${
                  paymentMode === mode.id
                    ? "border-primary bg-primary/5 text-primary font-bold shadow-xs"
                    : "border-outline-variant bg-surface hover:bg-surface-container-highest text-on-surface"
                }`}
              >
                <Icon name={mode.icon} size={28} />
                <span className="text-xs">{mode.label}</span>
              </button>
            ))}
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
            value={formData.paymentCaptcha || ""}
            onChange={(e) => updateFormData({ paymentCaptcha: e.target.value })}
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
          className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold text-sm hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-sm"
        >
          Make Payment (₹{feeAmount})
          <Icon name="lock" size={18} />
        </button>
      </div>
    </form>
  );
}
