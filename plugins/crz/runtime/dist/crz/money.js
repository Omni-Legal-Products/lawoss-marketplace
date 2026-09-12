/**
 * Parse a Slovak-formatted euro amount into a number of euros.
 *
 * CRZ renders prices like `"792,76 €"`, `"498 150,00 €"`, `"3 000,00 €"`,
 * `"0,00 €"` — comma is the decimal separator and (non-breaking) spaces are the
 * thousands separators. Returns `undefined` when no numeric value is present.
 *
 * Heuristic for the decimal separator: the LAST `,` or `.` is treated as the
 * decimal point only when 1–2 digits follow it; otherwise every separator is
 * treated as a thousands separator (so `"1.234"` → 1234, `"1,50"` → 1.5).
 */
export function parseEuroAmount(input) {
    if (input == null)
        return undefined;
    // Keep only digits, separators and a leading minus; drops €, spaces (incl. NBSP), letters.
    const t = input.replace(/[^\d.,-]/g, "");
    if (!/\d/.test(t))
        return undefined;
    const negative = t.trimStart().startsWith("-");
    const digitsAndSeps = t.replace(/-/g, "");
    const lastComma = digitsAndSeps.lastIndexOf(",");
    const lastDot = digitsAndSeps.lastIndexOf(".");
    const decPos = Math.max(lastComma, lastDot);
    let normalized;
    if (decPos === -1) {
        normalized = digitsAndSeps;
    }
    else {
        const tail = digitsAndSeps.slice(decPos + 1).replace(/[.,]/g, "");
        if (tail.length >= 1 && tail.length <= 2) {
            const head = digitsAndSeps.slice(0, decPos).replace(/[.,]/g, "");
            normalized = `${head}.${tail}`;
        }
        else {
            // No plausible decimal part → all separators are thousands separators.
            normalized = digitsAndSeps.replace(/[.,]/g, "");
        }
    }
    const value = Number(normalized);
    if (Number.isNaN(value))
        return undefined;
    return negative ? -value : value;
}
//# sourceMappingURL=money.js.map