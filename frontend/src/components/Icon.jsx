// Material Symbols icon. `filled` toggles the FILL axis; `size` sets px size.
export default function Icon({ name, filled = false, size, className = "", style = {} }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{
        ...(filled ? { fontVariationSettings: "'FILL' 1" } : {}),
        ...(size ? { fontSize: `${size}px` } : {}),
        ...style,
      }}
    >
      {name}
    </span>
  );
}
