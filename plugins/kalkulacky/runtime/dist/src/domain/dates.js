import { CalcError } from "./errors.js";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
export function dateToUtc(iso) {
    if (!ISO.test(iso))
        throw new CalcError(`Neplatný dátum "${iso}" — očakávam YYYY-MM-DD.`, "BAD_DATE");
    const t = Date.parse(iso + "T00:00:00Z");
    if (Number.isNaN(t))
        throw new CalcError(`Neplatný dátum "${iso}".`, "BAD_DATE");
    // Verify round-trip to reject non-existent calendar dates (e.g., 2024-02-30, 2024-04-31)
    if (new Date(t).toISOString().slice(0, 10) !== iso) {
        throw new CalcError(`Neplatný dátum "${iso}".`, "BAD_DATE");
    }
    return t;
}
export function daysBetween(fromIso, toIso) {
    return Math.round((dateToUtc(toIso) - dateToUtc(fromIso)) / DAY);
}
export function addDays(iso, n) {
    return new Date(dateToUtc(iso) + n * DAY).toISOString().slice(0, 10);
}
export function halfYearStart(iso) {
    const [, m] = iso.split("-").map(Number);
    return m <= 6 ? `${iso.slice(0, 4)}-01-01` : `${iso.slice(0, 4)}-07-01`;
}
export function todayIso() { return new Date().toISOString().slice(0, 10); }
//# sourceMappingURL=dates.js.map