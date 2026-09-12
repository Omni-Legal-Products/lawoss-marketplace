/**
 * Czech-aware slugifier. MUST stay identical to the okresSlug derivation
 * used by @czagents/realestate get_district_aggregate, so scraped okres
 * names and the tool's lookup key match exactly.
 */
export function slugifyCs(value) {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
//# sourceMappingURL=slug.js.map