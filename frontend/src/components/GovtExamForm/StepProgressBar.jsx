import Icon from "../Icon.jsx";

const STEPS = [
  { id: 1, label: "Basic Info", icon: "badge" },
  { id: 2, label: "Photo & Signature", icon: "add_a_photo" },
  { id: 3, label: "Details", icon: "assignment" },
  { id: 4, label: "Preview", icon: "visibility" },
  { id: 5, label: "Uploads", icon: "upload_file" },
  { id: 6, label: "Payment", icon: "payments" },
];

export default function StepProgressBar({ currentStep, onStepClick }) {
  return (
    <div className="w-full bg-surface-container-low border border-outline-variant rounded-2xl p-4 mb-6 shadow-xs">
      <div className="hidden md:flex items-center justify-between relative">
        {/* Connecting line */}
        <div className="absolute left-8 right-8 top-1/2 -translate-y-1/2 h-1 bg-surface-container-highest z-0" />
        
        {STEPS.map((step) => {
          const isCompleted = step.id < currentStep;
          const isActive = step.id === currentStep;

          return (
            <button
              key={step.id}
              onClick={() => isCompleted && onStepClick?.(step.id)}
              disabled={!isCompleted && !isActive}
              className={`relative z-10 flex flex-col items-center gap-1.5 transition-all group ${
                isCompleted ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-200 ${
                  isActive
                    ? "bg-primary text-on-primary ring-4 ring-primary/20 scale-110 shadow-md"
                    : isCompleted
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "bg-surface-container-highest text-on-surface-variant"
                }`}
              >
                {isCompleted ? (
                  <Icon name="check" size={20} />
                ) : (
                  <Icon name={step.icon} size={20} />
                )}
              </div>
              <span
                className={`text-xs font-medium transition-colors ${
                  isActive
                    ? "text-primary font-bold"
                    : isCompleted
                    ? "text-emerald-700 font-semibold"
                    : "text-on-surface-variant/70"
                }`}
              >
                {step.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile Step Bar */}
      <div className="flex md:hidden items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-sm">
            {currentStep}
          </div>
          <div>
            <div className="text-xs text-on-surface-variant font-medium">Step {currentStep} of 6</div>
            <div className="text-sm font-bold text-on-surface">
              {STEPS.find((s) => s.id === currentStep)?.label}
            </div>
          </div>
        </div>
        <div className="text-xs text-on-surface-variant font-mono bg-surface-container-highest px-3 py-1.5 rounded-full">
          {Math.round((currentStep / 6) * 100)}% Complete
        </div>
      </div>
    </div>
  );
}
