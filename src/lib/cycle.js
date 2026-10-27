// Planning cycle = month + year picked in the widget, stored as text.
import { CYCLE_FORMAT, CYCLE_YEARS_BACK, CYCLE_YEARS_AHEAD } from '../config.js';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** month: 1–12, year: 4 digits → "OCT'26" (or the configured format) */
export function cycleText(month, year, format = CYCLE_FORMAT) {
  const mon = MONTHS[month - 1].slice(0, 3);
  const yy = String(year).slice(-2);
  switch (format) {
    case 'Mon YYYY': return `${mon} ${year}`;
    case 'MM-YYYY': return `${String(month).padStart(2, '0')}-${year}`;
    default: return `${mon.toUpperCase()}'${yy}`;
  }
}

/** Current year ± the configured range, plus any years that already have demand saved. */
export function yearOptions(now = new Date(), extraYears = []) {
  const y = now.getFullYear();
  const set = new Set(extraYears.filter((v) => Number.isInteger(v) && v > 1990 && v < 2200));
  for (let i = y - CYCLE_YEARS_BACK; i <= y + CYCLE_YEARS_AHEAD; i++) set.add(i);
  return [...set].sort((a, b) => a - b);
}

/** "OCT'26" → 2026 · "Oct 2026" → 2026 · "10-2026" → 2026 · anything else → null */
export function yearFromCycle(text) {
  const s = normCycle(text);
  const four = s.match(/(19|20|21)\d{2}$/);
  if (four) return Number(four[0]);
  const two = s.match(/'(\d{2})$/);
  return two ? 2000 + Number(two[1]) : null;
}

/** Same cycle regardless of case/spaces/apostrophe style ("Oct'26" = "OCT’26"). */
export const sameCycle = (a, b) => normCycle(a) === normCycle(b);
export const normCycle = (s) => String(s ?? '').toUpperCase().replace(/[’`´]/g, "'").replace(/\s+/g, '');
