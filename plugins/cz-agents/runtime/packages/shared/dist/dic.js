/**
 * DIČ (Czech VAT ID) validation.
 *
 * Format: "CZ" + 8-10 digits.
 * - For legal entities (IČO-based): "CZ" + 8-digit IČO (MOD11 checksum applies).
 * - For individuals: "CZ" + rodné číslo (9-10 digits, separate MOD11 format).
 *
 * This validator checks format + IČO checksum if 8 digits follow "CZ".
 */
import { isValidIco } from './ico.js';
export function formatDic(input) {
    return input.trim().toUpperCase().replace(/\s+/g, '');
}
export function isValidDic(input) {
    const dic = formatDic(input);
    if (!/^CZ\d{8,10}$/.test(dic))
        return false;
    const digits = dic.slice(2);
    // 8-digit tail → validate as IČO
    if (digits.length === 8)
        return isValidIco(digits);
    // 9-10 digit tail → personal rodné číslo, skip strict checksum here (return true on format)
    return true;
}
/** Extract IČO from DIČ if it's the legal-entity format (CZ + 8 digits). */
export function icoFromDic(input) {
    const dic = formatDic(input);
    if (!/^CZ\d{8}$/.test(dic))
        return null;
    return dic.slice(2);
}
//# sourceMappingURL=dic.js.map