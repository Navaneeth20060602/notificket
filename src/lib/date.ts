// Every date shown anywhere in the app goes through this, so the format
// (DD/MM/YYYY) is consistent everywhere instead of relying on the browser's
// locale (toLocaleDateString varies by machine/locale, which is why we don't
// use it directly).
export function formatDate(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Native <input type="date"> always needs YYYY-MM-DD regardless of display
// locale - this converts a Date/ISO string to that for populating form fields.
export function toInputDate(date: Date | string | null | undefined) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  // Use the viewer's calendar date. toISOString() is UTC and can move an
  // Indian showtime to the previous date (for example 18/09 -> 17/09).
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Today's date as YYYY-MM-DD, for use as an <input type="date" min="..."> so
// people can't pick a date in the past (or absurdly far in the past/future).
export function todayInputDate() {
  return toInputDate(new Date());
}

export function maxFutureInputDate(yearsAhead = 2) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + yearsAhead);
  return toInputDate(d);
}
