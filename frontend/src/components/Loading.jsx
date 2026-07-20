// Centered loading indicator: a spinner + label, vertically centered in the
// available content area (rather than a bare text line in a list/row).
export default function Loading({ label = "Loading…", className = "min-h-[55vh]" }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-md text-on-surface-variant ${className}`}
    >
      <div className="w-10 h-10 rounded-full border-[3px] border-outline-variant border-t-primary animate-spin" />
      <p className="font-body-md text-body-md">{label}</p>
    </div>
  );
}
