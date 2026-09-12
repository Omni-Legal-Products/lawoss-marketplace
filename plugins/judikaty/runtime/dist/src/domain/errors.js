import { classifyCourtType, courtNamesMatch } from "./court-name-match.js";
export class ProviderUnavailableError extends Error {
    constructor(provider, message = "Provider is not available.") {
        super(`${provider}: ${message}`);
        this.name = "ProviderUnavailableError";
    }
}
export class ProviderSchemaChangedError extends Error {
    constructor(provider, message = "Provider response schema changed.") {
        super(`${provider}: ${message}`);
        this.name = "ProviderSchemaChangedError";
    }
}
export class DecisionNotFoundError extends Error {
    constructor(id) {
        super(`Decision '${id}' was not found.`);
        this.name = "DecisionNotFoundError";
    }
}
export class UnsupportedProviderError extends Error {
    constructor(provider) {
        super(`Provider '${provider}' is not supported by this operation.`);
        this.name = "UnsupportedProviderError";
    }
}
export class DocumentUnavailableError extends Error {
    constructor(id) {
        super(`Document for decision '${id}' is not available.`);
        this.name = "DocumentUnavailableError";
    }
}
/**
 * `courtName` did not resolve to exactly one court: either it matched more
 * than one (e.g. "Najvyšší" matches both "Najvyšší súd Slovenskej
 * republiky" and "Najvyšší správny súd Slovenskej republiky"), or it
 * matched only partially against exactly one court -- e.g. "Okresný súd
 * Bratislava" partially matches only "Okresný súd Bratislava V" (Bratislava
 * I-IV became Mestské súdy in the 2023 reorg), which must still be
 * rejected rather than silently narrowed to a court the caller never named.
 * Guessing which one the caller meant would risk silently searching the
 * wrong court, so this is a request-side error instead; `candidates` always
 * names every option so the caller (or a model acting on their behalf) can
 * pick the exact one without another round trip.
 */
export class AmbiguousCourtNameError extends Error {
    constructor(courtName, candidates) {
        const description = candidates.length === 1
            ? `did not match any court exactly, but is close to "${candidates[0]}"`
            : `matches more than one court (${candidates.join(", ")})`;
        super(`courtName "${courtName}" ${description}. ` +
            "Pass the exact court name, or call search_courts to find the exact name first.");
        this.name = "AmbiguousCourtNameError";
    }
}
/** The one court name `provider="ustavny"`'s own `courtName` filter actually matches (exact, see `USTAVNY_COURT_NAME` in `providers/ustavny/mapper.ts`). Duplicated here as a literal, not imported, to keep this domain module independent of the provider layer -- see the module doc comment on `court-name-match.ts` for why the two layers stay decoupled. */
const USTAVNY_SUD_CANONICAL_NAME = "Ústavný súd Slovenskej republiky";
/**
 * `Ústavný súd` (the Constitutional Court) is a separate constitutional
 * body, never present in the ministry-run general-court registry this
 * error otherwise reports against -- so "not found" there is expected, not
 * a data problem, and the honest answer is a redirect, not a suggestion.
 *
 * The redirect must not just name `provider="ustavny"` -- it must actually
 * work when followed. `UstavnyProvider.searchDecisions` rejects with 0
 * results unless `courtName` is omitted or matches `USTAVNY_SUD_CANONICAL_NAME`
 * exactly (see `providers/ustavny/provider.ts`'s `courtNamesMatch` check),
 * so telling the caller "it honours this exact court name" was false for
 * every shorthand a caller is likely to have on hand (e.g. "Ústavný súd
 * SR", or bare "Ústavný súd") -- live-verified, both return total 0. The
 * only advice that is true for *every* input is to omit `courtName`
 * entirely: `provider="ustavny"` already searches exactly one court, so no
 * filter is needed at all. The shorthand-specific warning only fires when
 * `courtName` is not already the canonical string, so the advice never
 * contradicts itself by calling the one correct input "not honoured".
 */
function buildUstavnySudRedirectMessage(courtName) {
    const isCanonical = courtNamesMatch(courtName, USTAVNY_SUD_CANONICAL_NAME);
    const shorthandWarning = isCanonical
        ? ""
        : ` Note that the shorthand "${courtName}" itself is not honoured there -- only the exact registry string ` +
            `"${USTAVNY_SUD_CANONICAL_NAME}" is -- but omitting courtName sidesteps that distinction entirely.`;
    return (`courtName "${courtName}" names the Constitutional Court (${USTAVNY_SUD_CANONICAL_NAME}), which is not ` +
        "part of the general-court registry this provider searches. Call search_decisions with " +
        'provider="ustavny" and omit courtName instead -- provider="ustavny" already searches only the ' +
        `Constitutional Court, so no court filter is needed.${shorthandWarning}`);
}
/**
 * Builds the "looks similar to" clause(s) of `CourtNameNotFoundError`,
 * splitting `suggestions` into two groups and framing each on its own
 * merits instead of applying one blanket reason to the whole list:
 *
 *  - same-instance-level suggestions are plausibly the very same court
 *    under a different grammatical form (Slovak place names decline, e.g.
 *    "Krajský súd Žilina" (nominative, what a caller naturally writes) vs
 *    the registry's "Krajský súd v Žiline" (locative)) when they are the
 *    *only* suggestions -- not a rename, and must not be called one;
 *  - a different (but compatible) type can only be the genuine Okresný <->
 *    Mestský 2023 court-reorganization rename (see
 *    `courtTypesAreCompatible`) -- the "may have been renamed" wording is
 *    accurate there and stays.
 *
 * The two groups are never merged into one clause when both are present.
 * Doing so used to mislabel same-type siblings as plausible renames too --
 * e.g. for "Okresný súd Košice I", the broadened lookup surfaces "Mestský
 * súd Košice" (the genuine 2023-reorg rename) *alongside* "Okresný súd
 * Košice II" and "Okresný súd Košice okolie" (different, still-existing
 * courts that happen to share the "Košice" locality, not the court that
 * was renamed). A model picking blindly from a single "may have been
 * renamed" list could silently search the wrong one of those -- the exact
 * failure mode this whole error type exists to prevent, just moved one
 * level down from cross-instance-type guessing to same-type identity
 * guessing. So when a cross-type (rename) candidate is present, any
 * same-type siblings get their own clause instead, explicitly labelled as
 * different courts, not a rename.
 *
 * `suggestions` only ever contains compatible-level candidates (enforced by
 * `court-resolver.ts`'s `suggestCourtCandidates`), so this never has to
 * decide what to do with a suggestion of an unrelated instance level --
 * those are filtered out long before they would reach this constructor.
 */
function buildSuggestionClause(courtName, suggestions) {
    if (suggestions.length === 0) {
        return "";
    }
    const inputType = classifyCourtType(courtName)?.type ?? null;
    const crossTypeSuggestions = [];
    const sameTypeSuggestions = [];
    for (const suggestion of suggestions) {
        const suggestionType = classifyCourtType(suggestion)?.type ?? null;
        const isCrossType = inputType !== null && suggestionType !== null && suggestionType !== inputType;
        (isCrossType ? crossTypeSuggestions : sameTypeSuggestions).push(suggestion);
    }
    const clauses = [];
    if (crossTypeSuggestions.length > 0) {
        clauses.push(` This looks similar to: ${crossTypeSuggestions.join(", ")} -- the court may have been renamed ` +
            "(e.g. in the 2023 court reorganization); pass one of these exact names if one of them is the court " +
            "you meant.");
    }
    if (sameTypeSuggestions.length > 0) {
        if (crossTypeSuggestions.length > 0) {
            // Mixed list: the same-type names here are siblings, not a rename of
            // the court above -- say so explicitly rather than reusing the
            // rename wording for them too.
            clauses.push(` Separately: ${sameTypeSuggestions.join(", ")} -- different, still-existing courts in the same ` +
                "locality, not a rename of the one you searched for; pass one of these exact names only if one of " +
                "them is the court you actually meant.");
        }
        else {
            clauses.push(` This looks similar to: ${sameTypeSuggestions.join(", ")} -- the registry may simply write the name ` +
                'differently (Slovak place names decline, and abbreviations such as "SR" are written out in full); ' +
                "pass one of these exact names if one of them is the court you meant.");
        }
    }
    return clauses.join("");
}
/**
 * `courtName` matched no known court at all. `suggestions` (possibly
 * empty) come from a broadened fallback lookup restricted to a compatible
 * court-instance level (see `court-resolver.ts`'s `suggestCourtCandidates`
 * for why cross-level suggestions -- e.g. offering a district court for a
 * regional-court query -- never reach here), aimed squarely at the
 * round-trip case where the caller copied a `courtName` out of this
 * server's own earlier output and the court has since been renamed (e.g.
 * the 2023 reorg) or the registry simply spells it differently (Slovak
 * locative forms) -- so the error names the current registry string
 * instead of being a dead end. `Ústavný súd` is a special case: it is never
 * in this registry at all, so it gets a provider redirect instead of a
 * suggestion (see `buildUstavnySudRedirectMessage`).
 */
export class CourtNameNotFoundError extends Error {
    constructor(courtName, suggestions = []) {
        const isUstavnySud = classifyCourtType(courtName)?.type === "Ústavný súd";
        super(isUstavnySud
            ? buildUstavnySudRedirectMessage(courtName)
            : `courtName "${courtName}" did not match any known court. ` +
                "Pass the exact court name, or call search_courts to find the exact name first." +
                buildSuggestionClause(courtName, suggestions));
        this.name = "CourtNameNotFoundError";
    }
}
/**
 * Both `courtId` and `courtName` were given and they resolve to two
 * different courts. Silently preferring one over the other would risk
 * searching a court the caller did not ask for.
 */
export class CourtFilterMismatchError extends Error {
    constructor(courtName, courtId, resolvedGuidForCourtName) {
        super(`courtId "${courtId}" and courtName "${courtName}" (resolves to court id ` +
            `"${resolvedGuidForCourtName}") name two different courts. Pass only one of them, or make sure ` +
            "both identify the same court.");
        this.name = "CourtFilterMismatchError";
    }
}
//# sourceMappingURL=errors.js.map