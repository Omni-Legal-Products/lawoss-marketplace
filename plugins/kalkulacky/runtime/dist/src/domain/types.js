import { CalcError } from "./errors.js";
/**
 * Vráti poslednú sadzbu ECB s `from <= iso`. Zoznam `entries` nemusí byť
 * vopred zoradený. Ak `iso` predchádza prvému záznamu, vyhodí CalcError
 * s kódom "NO_RATE" — nikdy nevracia nesprávnu/predvolenú sadzbu potichu.
 */
export function ecbRateAt(entries, iso) {
    const sorted = [...entries].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    let result;
    for (const entry of sorted) {
        if (entry.from <= iso) {
            result = entry.rate;
        }
        else {
            break;
        }
    }
    if (result === undefined) {
        throw new CalcError(`Dátum "${iso}" predchádza prvému záznamu sadzby ECB (${sorted[0]?.from ?? "?"}).`, "NO_RATE");
    }
    return result;
}
//# sourceMappingURL=types.js.map