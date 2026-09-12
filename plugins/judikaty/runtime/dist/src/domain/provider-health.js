export function buildProviderHealth(input) {
    return {
        provider: input.provider,
        available: input.available,
        checkedAt: input.checkedAt ?? new Date().toISOString(),
        capabilities: input.capabilities,
        coverage: input.coverage,
        notes: input.notes ?? []
    };
}
export function getProviderCapabilities(provider) {
    switch (provider) {
        case "justice":
            return {
                search: true,
                detail: true,
                text: true,
                document: true,
                lawSearch: true,
                slovlexContext: true,
                recentPolling: true,
                courtSearch: true,
                identityResolution: true,
                autocomplete: true
            };
        case "nsud":
            return {
                search: true,
                detail: true,
                text: true,
                document: true,
                lawSearch: true,
                slovlexContext: true,
                recentPolling: true,
                courtSearch: false,
                identityResolution: true,
                autocomplete: true
            };
        case "ustavny":
            return {
                search: true,
                detail: true,
                text: true,
                document: true,
                lawSearch: false,
                slovlexContext: true,
                recentPolling: false,
                courtSearch: false,
                identityResolution: true,
                autocomplete: true
            };
    }
}
export function getProviderCoverageProfile(provider) {
    switch (provider) {
        case "justice":
            return {
                courts: ["lower courts", "regional courts", "supreme court metadata"],
                textAvailability: "pdf_extract",
                documentAvailability: "partial",
                historicalCoverage: "partial",
                notes: [
                    "Best source for cross-court metadata discovery.",
                    "Lower-court text often requires PDF extraction and is not guaranteed.",
                    "Lower-court lookup is best-effort only because some publicly visible Ministry decisions are not indexed by search."
                ]
            };
        case "nsud":
            return {
                courts: ["Najvyšší súd Slovenskej republiky"],
                textAvailability: "mixed",
                documentAvailability: "common",
                historicalCoverage: "strong",
                notes: [
                    "Best source for Najvyšší súd SR full-text retrieval.",
                    "Search is narrower in court coverage but stronger in inline text availability.",
                    "This is the most reliable provider in the current MCP for direct Supreme Court lookup."
                ]
            };
        case "ustavny":
            return {
                courts: ["Ústavný súd Slovenskej republiky"],
                textAvailability: "mixed",
                documentAvailability: "common",
                historicalCoverage: "strong",
                notes: [
                    "Official Constitutional Court DMS API is reachable behind the public site.",
                    "Older decisions are available, with a separate digitized 1993-2004 workflow noted by the court."
                ]
            };
    }
}
//# sourceMappingURL=provider-health.js.map