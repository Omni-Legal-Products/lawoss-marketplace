export const FORM_RULE_VERSION = "form-decision-v1";
export const FORM_PARSER_VERSION = "form-decision-parser-v1";
export const FORM_NORMALIZATION_VERSION = "form-decision-normalization-v1";
const TEXT_CAP = 2_000_000;
const OPENING_MAX_START = 3_000;
const ALLOWED_FORMS = new Set([
    "trestny rozkaz",
    "platobny rozkaz",
    "zmenkovy platobny rozkaz",
    "sekovy platobny rozkaz",
    "europsky platobny rozkaz",
    "rozkaz na plnenie",
    "opravne uznesenie"
]);
const GENERIC_HEADINGS = new Set(["rozsudok", "uznesenie", "nalez"]);
const FORM_HEADINGS = new Set([...ALLOWED_FORMS, ...GENERIC_HEADINGS]);
const OPENINGS = new Set([
    "rozhodol",
    "rozhodol takto",
    "takto rozhodol",
    "rozhodla",
    "rozhodla takto",
    "takto rozhodla",
    "rozhodli",
    "rozhodli takto",
    "takto rozhodli",
    "vyrok"
]);
const NO_REASONING_SENTENCES = new Set([
    "rozsudok neobsahuje odovodnenie",
    "tento rozsudok neobsahuje odovodnenie",
    "pisomne vyhotovenie rozsudku neobsahuje odovodnenie"
]);
const REAL_ONE_LETTER_WORDS = new Set(["a", "i", "o", "s", "k", "v", "u", "z"]);
function deterministicDecision(status, reasons, evidence = []) {
    return {
        status,
        ruleVersion: FORM_RULE_VERSION,
        source: "deterministic",
        reasons,
        evidence
    };
}
export function unknownFormDecision(reason) {
    return {
        status: "unknown",
        ruleVersion: null,
        source: null,
        reasons: [reason],
        evidence: []
    };
}
function isWhitespace(value) {
    return /\s/u.test(value);
}
function isLetter(value) {
    return /^\p{L}$/u.test(value);
}
/**
 * Fold one line while retaining a UTF-16 source position for every output
 * character. This keeps literal evidence anchored to the original document
 * despite Unicode folding and letter-spacing repair.
 */
function normalizeLine(value, offset) {
    const units = [];
    for (let index = 0; index < value.length;) {
        const codePoint = value.codePointAt(index);
        if (codePoint === undefined)
            break;
        const char = String.fromCodePoint(codePoint);
        const width = char.length;
        const start = offset + index;
        const end = start + width;
        index += width;
        if (isWhitespace(char)) {
            units.push({ value: " ", start, end });
            continue;
        }
        for (const folded of char.normalize("NFD").toLowerCase()) {
            if (/\p{M}/u.test(folded))
                continue;
            units.push({ value: folded, start, end });
        }
    }
    const compactWhitespace = [];
    for (const unit of units) {
        const previous = compactWhitespace.at(-1);
        if (unit.value === " " && previous?.value === " ") {
            previous.end = unit.end;
        }
        else {
            compactWhitespace.push({ ...unit });
        }
    }
    while (compactWhitespace[0]?.value === " ")
        compactWhitespace.shift();
    while (compactWhitespace.at(-1)?.value === " ")
        compactWhitespace.pop();
    const repaired = collapseLetterSpacingWithOffsets(compactWhitespace);
    return {
        value: repaired.units.map((unit) => unit.value).join(""),
        offsets: repaired.units.map(({ start, end }) => ({ start, end })),
        collapsedLetterSpacing: repaired.collapsed
    };
}
function collapseLetterSpacingWithOffsets(units) {
    const out = [];
    let collapsed = false;
    for (let index = 0; index < units.length;) {
        const run = [];
        let cursor = index;
        while (isSingleLetterToken(units, cursor)) {
            run.push(cursor);
            const separator = cursor + 1;
            const next = cursor + 2;
            if (!isCollapsibleSeparator(units[separator]) || !isSingleLetterToken(units, next))
                break;
            cursor = next;
        }
        if (run.length >= 3 && !run.every((position) => REAL_ONE_LETTER_WORDS.has(units[position].value))) {
            for (const position of run)
                out.push({ ...units[position] });
            collapsed = true;
            index = run.at(-1) + 1;
            continue;
        }
        out.push({ ...units[index] });
        index += 1;
    }
    return { units: out, collapsed };
}
function isCollapsibleSeparator(unit) {
    return unit?.value === " " && unit.end - unit.start === 1;
}
function isSingleLetterToken(units, index) {
    if (!isLetter(units[index]?.value ?? ""))
        return false;
    const before = units[index - 1]?.value;
    const after = units[index + 1]?.value;
    return !isLetter(before ?? "") && !isLetter(after ?? "");
}
function splitLines(text) {
    const lines = [];
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== "\n" && text[index] !== "\r")
            continue;
        const end = index;
        lines.push({ start, end, text: text.slice(start, end), normalized: normalizeLine(text.slice(start, end), start) });
        if (text[index] === "\r" && text[index + 1] === "\n")
            index += 1;
        start = index + 1;
    }
    lines.push({ start, end: text.length, text: text.slice(start), normalized: normalizeLine(text.slice(start), start) });
    return lines;
}
function normalizedMarker(line) {
    return line.normalized.value.replace(/\s*:\s*$/u, "");
}
function isOpening(line) {
    return matchesLiteral(line, OPENINGS);
}
function isReasoningHeading(line) {
    return matchesLiteral(line, new Set(["odovodnenie"]));
}
function isInstructionHeading(line) {
    return matchesLiteral(line, new Set(["poucenie"]));
}
function headerName(line) {
    const marker = line.normalized.value;
    if (FORM_HEADINGS.has(marker))
        return marker;
    if (!line.normalized.collapsedLetterSpacing)
        return null;
    const compactMarker = marker.replaceAll(" ", "");
    return [...FORM_HEADINGS].find((candidate) => candidate.replaceAll(" ", "") === compactMarker) ?? null;
}
function matchesLiteral(line, candidates) {
    const marker = normalizedMarker(line);
    if (candidates.has(marker))
        return true;
    if (!line.normalized.collapsedLetterSpacing)
        return false;
    const compactMarker = marker.replaceAll(" ", "");
    return [...candidates].some((candidate) => candidate.replaceAll(" ", "") === compactMarker);
}
function trimmedSpan(line) {
    const first = line.normalized.offsets[0];
    const last = line.normalized.offsets.at(-1);
    return first && last ? { start: first.start, end: last.end } : null;
}
function isBlank(line) {
    return line.normalized.value.length === 0;
}
function blockNormalized(lines) {
    return lines
        .filter((line) => !isBlank(line))
        .map((line) => line.normalized.value)
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
}
function isNoReasoningLiteral(lines) {
    return NO_REASONING_SENTENCES.has(blockNormalized(lines).replace(/\s*\.$/u, ""));
}
function literalEvidence(lines) {
    const first = lines.find((line) => !isBlank(line));
    let last;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (!isBlank(lines[index])) {
            last = lines[index];
            break;
        }
    }
    if (!first || !last)
        return null;
    const firstSpan = trimmedSpan(first);
    const lastSpan = trimmedSpan(last);
    if (!firstSpan || !lastSpan)
        return null;
    return {
        kind: "literal_marker",
        rule: "explicit_no_reasoning",
        start: firstSpan.start,
        end: lastSpan.end
    };
}
function extractTrailingLiteral(verdict) {
    let end = verdict.length;
    while (end > 0 && isBlank(verdict[end - 1]))
        end -= 1;
    let start = end;
    while (start > 0 && !isBlank(verdict[start - 1]))
        start -= 1;
    if (start === 0 || !isNoReasoningLiteral(verdict.slice(start, end)))
        return null;
    const evidence = literalEvidence(verdict.slice(start, end));
    if (!evidence || !verdict.slice(0, start).some((line) => !isBlank(line)))
        return null;
    return { verdict: verdict.slice(0, start), evidence };
}
function parseStructure(text) {
    const lines = splitLines(text);
    const openings = lines.filter(isOpening);
    const reasonings = lines.filter(isReasoningHeading);
    const instructions = lines.filter(isInstructionHeading);
    if (openings.length !== 1 || reasonings.length > 1 || instructions.length !== 1)
        return null;
    const opening = openings[0];
    const instruction = instructions[0];
    const reasoning = reasonings[0] ?? null;
    if (opening.start > OPENING_MAX_START ||
        instruction.start <= opening.start ||
        (reasoning !== null && (reasoning.start <= opening.start || reasoning.start >= instruction.start))) {
        return null;
    }
    const headers = lines.filter((line) => line.start < opening.start && headerName(line) !== null);
    if (headers.length !== 1)
        return null;
    const header = headers[0];
    const openingIndex = lines.indexOf(opening);
    const reasoningIndex = reasoning === null ? -1 : lines.indexOf(reasoning);
    const instructionIndex = lines.indexOf(instruction);
    const verdictEnd = reasoningIndex >= 0 ? reasoningIndex : instructionIndex;
    let verdict = lines.slice(openingIndex + 1, verdictEnd);
    if (!verdict.some((line) => !isBlank(line)))
        return null;
    if (reasoning === null) {
        const trailingLiteral = extractTrailingLiteral(verdict);
        if (!trailingLiteral)
            return { header, opening, verdict, reasoning: { kind: "absent" } };
        verdict = trailingLiteral.verdict;
        return { header, opening, verdict, reasoning: { kind: "literal", evidence: trailingLiteral.evidence } };
    }
    const reasoningBlock = lines.slice(reasoningIndex + 1, instructionIndex);
    if (!reasoningBlock.some((line) => !isBlank(line)))
        return { header, opening, verdict, reasoning: { kind: "empty" } };
    const evidence = literalEvidence(reasoningBlock);
    if (evidence && isNoReasoningLiteral(reasoningBlock)) {
        return { header, opening, verdict, reasoning: { kind: "literal", evidence } };
    }
    return { header, opening, verdict, reasoning: { kind: "other" } };
}
function metadataIsValid(metadata) {
    switch (metadata.status) {
        case "absent":
            return metadata.value === null && metadata.field === null;
        case "explicit_null":
            return metadata.value === null && (metadata.field === null || metadata.field.trim().length > 0);
        case "value":
            return (typeof metadata.value === "string" &&
                metadata.value.trim().length > 0 &&
                typeof metadata.field === "string" &&
                metadata.field.trim().length > 0);
        case "conflict":
            return true;
    }
}
function directMetadataName(metadata) {
    if (metadata.status !== "value" || metadata.value === null)
        return null;
    return normalizeLine(metadata.value, 0).value;
}
function allowedMetadataName(metadata) {
    const normalized = directMetadataName(metadata);
    return normalized !== null && ALLOWED_FORMS.has(normalized) ? normalized : null;
}
function ownExecutionRegister(lines) {
    const register = /^(?:sp\.?\s*zn\.?\s*)?\d{0,4}\s*(?:er|ex|ek|exe)\s*(?:[/.-]\s*\d+|\d+\s*[/.-]\s*\d+)/u;
    return lines.some((line) => register.test(line.normalized.value));
}
function verdictHasScopeVeto(lines) {
    return /zastav|exekuc/u.test(blockNormalized(lines));
}
export function assessFormDecision(input) {
    if (input.provider === "nsud")
        return deterministicDecision("unknown", ["unverified_completeness"]);
    if (!input.complete)
        return deterministicDecision("unknown", ["incomplete_text"]);
    if (input.text.length > TEXT_CAP)
        return deterministicDecision("unknown", ["text_too_large"]);
    if (!metadataIsValid(input.metadata))
        return deterministicDecision("unknown", ["invalid_metadata"]);
    const parsed = parseStructure(input.text);
    if (!parsed)
        return deterministicDecision("unknown", ["ambiguous_structure"]);
    if (verdictHasScopeVeto(parsed.verdict) || ownExecutionRegister(splitLines(input.text).filter((line) => line.start < parsed.opening.start))) {
        return deterministicDecision("excluded", ["scope_veto"]);
    }
    if (input.metadata.status === "conflict")
        return deterministicDecision("unknown", ["metadata_conflict"]);
    if (parsed.reasoning.kind === "empty")
        return deterministicDecision("unknown", ["ambiguous_structure"]);
    if (parsed.reasoning.kind === "other")
        return deterministicDecision("unknown", ["substantive_reasoning"]);
    const heading = headerName(parsed.header);
    const directMetadata = directMetadataName(input.metadata);
    const metadataName = allowedMetadataName(input.metadata);
    if (directMetadata && directMetadata !== heading) {
        return deterministicDecision("unknown", ["metadata_heading_conflict"]);
    }
    const reasons = [];
    const evidence = [];
    if (metadataName && input.metadata.status === "value" && input.metadata.field !== null && input.metadata.value !== null) {
        reasons.push("metadata_form");
        evidence.push({ kind: "source_metadata", field: input.metadata.field, value: input.metadata.value });
    }
    if (heading === "trestny rozkaz") {
        const span = trimmedSpan(parsed.header);
        if (span) {
            reasons.push("own_criminal_order_heading");
            evidence.push({ kind: "literal_marker", rule: "own_criminal_order_heading", ...span });
        }
    }
    if (parsed.reasoning.kind === "literal") {
        reasons.push("explicit_no_reasoning");
        evidence.push(parsed.reasoning.evidence);
    }
    return reasons.length > 0
        ? deterministicDecision("detected", reasons, evidence.slice(0, 3))
        : deterministicDecision("not_detected", []);
}
//# sourceMappingURL=form-decision.js.map