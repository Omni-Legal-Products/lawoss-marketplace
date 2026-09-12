/**
 * IČO (Czech Business ID) validation — MOD11 checksum.
 * Accepts 7-8 digit strings, zero-pads to 8.
 */
export function formatIco(input) {
    const digits = String(input).replace(/\s+/g, '').replace(/^0+/, '');
    if (!/^\d{1,8}$/.test(digits)) {
        throw new Error(`Invalid IČO format: "${input}" (expected 7-8 digits)`);
    }
    return digits.padStart(8, '0');
}
export function isValidIco(input) {
    try {
        const ico = formatIco(input);
        const digits = ico.split('').map(Number);
        // MOD11: sum(digit[i] * (8-i)) for i in 0..6, mod 11
        let sum = 0;
        for (let i = 0; i < 7; i++) {
            sum += digits[i] * (8 - i);
        }
        const rem = sum % 11;
        const expected = rem === 0 ? 1 : rem === 1 ? 0 : 11 - rem;
        return expected === digits[7];
    }
    catch {
        return false;
    }
}
/** Parse + validate, throw on bad input. Use in MCP tool handlers. */
export function validateIcoInput(input) {
    if (typeof input !== 'string' && typeof input !== 'number') {
        throw new Error(`IČO must be string or number, got ${typeof input}`);
    }
    const ico = formatIco(input);
    if (!isValidIco(ico)) {
        throw new Error(`IČO checksum failed for "${ico}" (MOD11)`);
    }
    return ico;
}
//# sourceMappingURL=ico.js.map