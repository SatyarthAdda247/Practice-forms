// Human-readable labels for the filling-rule violation codes returned by the
// backend (see backend/grading.py VIOLATION_CODES). These mirror the printed
// "INSTRUCTIONS FOR FILLING THE SHEET" block on an OMR sheet.
export const VIOLATION_LABELS = {
  MULTIPLE_MARKS: "Multiple options marked",
  INCOMPLETE_FILL: "Circle not fully darkened",
  LIGHT_MARK: "Faint mark (pencil?)",
  STRAY_MARKS: "Stray marks on sheet",
  ERASING: "Erasing / correction fluid",
};

export function violationLabel(code) {
  return VIOLATION_LABELS[code] || code;
}
