export function normalizeLawReference(input) {
    const notes = [];
    const trimmedLaw = input.law.trim();
    const trimmedParagraph = input.paragraph?.trim();
    const extracted = extractLawIdAndAnchor(trimmedLaw);
    let lawId = extracted.lawId;
    let anchor = extracted.anchor;
    if (!lawId) {
        lawId = normalizeLawNumber(trimmedLaw);
    }
    if (!anchor && trimmedParagraph) {
        anchor = normalizeParagraphAnchor(trimmedParagraph);
    }
    if (!lawId) {
        notes.push("Could not normalize the law reference to a Slov-Lex law identifier.");
        return {
            lawId: null,
            anchor: anchor ?? null,
            url: null,
            searchToken: null,
            degraded: true,
            notes
        };
    }
    const path = anchor ? `${lawId}/#${anchor}` : lawId;
    const url = `https://www.slov-lex.sk/pravne-predpisy/${path}`;
    if (!anchor) {
        notes.push("No paragraph anchor was available. Justice API law search will fall back to a broader text query.");
        return {
            lawId,
            anchor: null,
            url,
            searchToken: null,
            degraded: true,
            notes
        };
    }
    return {
        lawId,
        anchor,
        url,
        searchToken: `${lawId}/#${anchor}`,
        degraded: false,
        notes
    };
}
function extractLawIdAndAnchor(value) {
    const urlMatch = value.match(/(SK\/ZZ\/\d{4}\/\d+)(?:\/?#([^?\s]+))?/);
    if (urlMatch) {
        return {
            lawId: `/${urlMatch[1]}`,
            anchor: urlMatch[2] ?? null
        };
    }
    const pathMatch = value.match(/(\/SK\/ZZ\/\d{4}\/\d+)(?:#([^?\s]+))?/);
    if (pathMatch) {
        return {
            lawId: pathMatch[1] ?? null,
            anchor: pathMatch[2] ?? null
        };
    }
    return {
        lawId: null,
        anchor: null
    };
}
function normalizeLawNumber(value) {
    const match = value.match(/^(\d+)\/(\d{4})$/);
    if (!match) {
        return null;
    }
    const number = match[1];
    const year = match[2];
    return `/SK/ZZ/${year}/${number}`;
}
function normalizeParagraphAnchor(value) {
    const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
    const paragraphMatch = normalized.match(/§?\s*(\d+[a-z]?)/);
    if (!paragraphMatch?.[1]) {
        return null;
    }
    let anchor = `paragraf-${paragraphMatch[1]}`;
    const odsekMatch = normalized.match(/(?:ods?\.?|odsek)\s*(\d+[a-z]?)/);
    if (odsekMatch?.[1]) {
        anchor += `.odsek-${odsekMatch[1]}`;
    }
    const pismenoMatch = normalized.match(/(?:pism?\.?|písm?\.?)\s*([a-z])/);
    if (pismenoMatch?.[1]) {
        anchor += `.pismeno-${pismenoMatch[1]}`;
    }
    return anchor;
}
//# sourceMappingURL=slovlex.js.map