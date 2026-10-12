import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getJudiciaryDataDir } from "../../infra/data-dir.js";
// v3: "písmeno b)" letter, standalone OSP token, attribution right after the paragraph,
// and two-letter paragraph suffixes (151ma, 59ab).
const CITATION_EXTRACTOR_VERSION = 3;
/** How far past a paragraph citation an abbreviation or law number still counts as "directly following". */
const DIRECT_ATTRIBUTION_CHARS = 60;
const LAW_ALIASES = [
    {
        lawNumber: "40/1964",
        patterns: [/\bOZ\b/iu, /Občiansk(?:y|eho|ého)\s+zákonník(?:a|u)?/iu],
        searchAliases: ["Občiansky zákonník", "OZ"]
    },
    {
        lawNumber: "513/1991",
        patterns: [/\bObZ\b/iu, /Obchodn(?:ý|eho|ého)\s+zákonník(?:a|u)?/iu],
        searchAliases: ["Obchodný zákonník", "ObZ"]
    },
    {
        lawNumber: "160/2015",
        patterns: [/\bCSP\b/iu, /Civiln(?:ý|eho|ého)\s+sporov(?:ý|eho|ého)\s+poriadk(?:u|om)?/iu],
        searchAliases: ["Civilný sporový poriadok", "CSP"]
    },
    {
        lawNumber: "161/2015",
        patterns: [/\bCMP\b/iu, /Civiln(?:ý|eho|ého)\s+mimosporov(?:ý|eho|ého)\s+poriadk(?:u|om)?/iu],
        searchAliases: ["Civilný mimosporový poriadok", "CMP"]
    },
    {
        lawNumber: "162/2015",
        patterns: [/\bSSP\b/iu, /Správn(?:y|eho|ého)\s+súdn(?:y|eho|ého)\s+poriadk(?:u|om)?/iu],
        searchAliases: ["Správny súdny poriadok", "SSP"]
    },
    {
        lawNumber: "99/1963",
        patterns: [
            // OSP, O.s.p., O. s. p. — only as a separate token, never inside e.g. "prospech".
            /(?<![\p{L}\p{N}.])(?:OSP|O\.\s?S\.\s?P\.?)(?![\p{L}\p{N}])/iu,
            /Občiansk(?:y|eho|ého)\s+súdn(?:y|eho|ého)\s+poriadk(?:u|om)?/iu
        ],
        searchAliases: ["Občiansky súdny poriadok", "OSP", "O.s.p."]
    },
    {
        lawNumber: "300/2005",
        patterns: [/\bTZ\b/iu, /Trestn(?:ý|eho|ého)\s+zákon(?:a|e)?/iu],
        searchAliases: ["Trestný zákon", "TZ"]
    },
    {
        lawNumber: "301/2005",
        patterns: [/\bTP\b/iu, /Trestn(?:ý|eho|ého)\s+poriadk(?:u|om)?/iu],
        searchAliases: ["Trestný poriadok", "TP"]
    }
];
export async function extractNsudCitedRegulations(input) {
    const textSha256 = createHash("sha256").update(input.text).digest("hex");
    const cached = await readCitationCache(input.id);
    if (cached?.extractorVersion === CITATION_EXTRACTOR_VERSION &&
        cached.textSha256 === textSha256) {
        return cached.citedRegulations;
    }
    const citedRegulations = extractCitationsFromText(input.text);
    await writeCitationCache(input.id, {
        extractorVersion: CITATION_EXTRACTOR_VERSION,
        textSha256,
        citedRegulations,
        updatedAt: new Date().toISOString()
    });
    return citedRegulations;
}
export function extractCitationsFromText(text) {
    const normalizedText = text.replace(/\s+/g, " ").trim();
    if (!normalizedText) {
        return [];
    }
    const paragraphPattern = /§\s*(\d+[a-z]{0,2})(?![\p{L}])(?:\s*(?:ods?\.?|odsek)\s*(\d+[a-z]?))?(?:\s*(?:písmeno|pismeno|písm\.?|pism\.?)\s*([a-z])(?![\p{L}]))?/giu;
    const seen = new Map();
    for (const match of normalizedText.matchAll(paragraphPattern)) {
        const paragraph = match[1]?.toLowerCase();
        if (!paragraph || match.index == null) {
            continue;
        }
        const odsek = match[2]?.toLowerCase() ?? null;
        const pismeno = match[3]?.toLowerCase() ?? null;
        const context = buildCitationContext(normalizedText, match.index, match[0].length);
        // An abbreviation or law number right after the paragraph names the law it belongs to,
        // so it wins over a law number that merely appears earlier in the surrounding text.
        const lawNumber = detectLawNumber(buildFollowingContext(normalizedText, match.index + match[0].length)) ??
            detectLawNumber(context);
        if (!lawNumber) {
            continue;
        }
        const [number, year] = lawNumber.split("/");
        if (!number || !year) {
            continue;
        }
        let anchor = `paragraf-${paragraph}`;
        if (odsek) {
            anchor += `.odsek-${odsek}`;
        }
        if (pismeno) {
            anchor += `.pismeno-${pismeno}`;
        }
        const slovLexLawId = `/SK/ZZ/${year}/${number}`;
        const url = `https://www.slov-lex.sk/pravne-predpisy${slovLexLawId}/#${anchor}`;
        const key = `${slovLexLawId}#${anchor}`;
        if (!seen.has(key)) {
            seen.set(key, {
                label: `${slovLexLawId}/#${anchor}`,
                url,
                slovLexLawId,
                slovLexAnchor: anchor
            });
        }
    }
    return Array.from(seen.values());
}
function buildCitationContext(text, matchIndex, matchLength) {
    const start = Math.max(0, matchIndex - 80);
    let end = Math.min(text.length, matchIndex + matchLength + 140);
    const nextParagraphIndex = text.indexOf("§", matchIndex + matchLength);
    if (nextParagraphIndex >= 0 && nextParagraphIndex < end) {
        end = nextParagraphIndex;
    }
    return text.slice(start, end);
}
function buildFollowingContext(text, matchEnd) {
    let end = Math.min(text.length, matchEnd + DIRECT_ATTRIBUTION_CHARS);
    const nextParagraphIndex = text.indexOf("§", matchEnd);
    if (nextParagraphIndex >= 0 && nextParagraphIndex < end) {
        end = nextParagraphIndex;
    }
    return text.slice(matchEnd, end);
}
export function buildNsudCitationCandidateQueries(input) {
    return buildNsudCitationCandidateQueryPlan(input).allQueries;
}
export function buildNsudCitationCandidateQueryPlan(input) {
    const lawNumber = extractLawNumber(input.law);
    const paragraph = normalizeParagraph(input.paragraph);
    const aliases = LAW_ALIASES.find((entry) => entry.lawNumber === lawNumber)?.searchAliases ?? [];
    const paragraphQueries = new Set();
    const lawQueries = new Set();
    const combinedQueries = new Set();
    if (paragraph) {
        paragraphQueries.add(paragraph);
        paragraphQueries.add(paragraph.replace("§ ", "§"));
        paragraphQueries.add(paragraph.replace("§ ", "paragraf "));
        if (lawNumber) {
            combinedQueries.add(`${paragraph} ${lawNumber}`);
            combinedQueries.add(`${paragraph} zákon ${lawNumber}`);
            combinedQueries.add(`${paragraph} zákon č. ${lawNumber}`);
        }
        for (const alias of aliases) {
            combinedQueries.add(`${paragraph} ${alias}`);
        }
    }
    if (lawNumber) {
        lawQueries.add(lawNumber);
        lawQueries.add(`${lawNumber} Zb`);
        lawQueries.add(`zákon č. ${lawNumber}`);
    }
    for (const alias of aliases) {
        lawQueries.add(alias);
    }
    return {
        paragraphQueries: Array.from(paragraphQueries),
        lawQueries: Array.from(lawQueries),
        combinedQueries: Array.from(combinedQueries),
        allQueries: [
            ...Array.from(paragraphQueries),
            ...Array.from(combinedQueries),
            ...Array.from(lawQueries)
        ]
    };
}
function detectLawNumber(context) {
    const explicitMatch = context.match(/zák(?:on|ona)?\.?\s*(?:č\.?\s*)?(\d+)\/(\d{4})/iu);
    if (explicitMatch?.[1] && explicitMatch[2]) {
        return `${explicitMatch[1]}/${explicitMatch[2]}`;
    }
    for (const alias of LAW_ALIASES) {
        if (alias.patterns.some((pattern) => pattern.test(context))) {
            return alias.lawNumber;
        }
    }
    const collectionMatch = context.match(/\b(\d+)\/(\d{4})\s*(?:Z\.\s*z\.|Zb\.)/iu);
    if (collectionMatch?.[1] && collectionMatch[2]) {
        return `${collectionMatch[1]}/${collectionMatch[2]}`;
    }
    return null;
}
function extractLawNumber(value) {
    const match = value.trim().match(/(\d+\/\d{4})/);
    return match?.[1] ?? null;
}
function normalizeParagraph(value) {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }
    const match = trimmed.match(/§?\s*(\d+[a-z]?)/i);
    if (!match?.[1]) {
        return null;
    }
    return `§ ${match[1]}`;
}
function getCitationCachePath(id) {
    return path.join(getJudiciaryDataDir(), "nsud", "citations", `${id}.json`);
}
async function readCitationCache(id) {
    try {
        const raw = await readFile(getCitationCachePath(id), "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function writeCitationCache(id, entry) {
    const filePath = getCitationCachePath(id);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(entry, null, 2), "utf-8");
}
//# sourceMappingURL=citations.js.map