// Small "Beta" pill shown beside the product name while the app is in beta.
export default function BetaBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center font-label-md text-[10px] font-semibold uppercase tracking-wider px-sm py-[2px] rounded-full bg-tertiary-fixed-dim/30 text-primary border border-primary/30 ${className}`}
    >
      Beta
    </span>
  );
}
