import { downloadPdfToCache, extractPdfText } from "./pdf.js";
export async function searchDuckDuckGoHtml(input) {
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", input.query);
    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; judikaty-MCP/0.1.0)"
        }
    });
    if (!response.ok) {
        throw new Error(`DuckDuckGo HTML search failed: HTTP ${response.status} for ${url.toString()}`);
    }
    const html = await response.text();
    return parseDuckDuckGoHtmlResults(html).slice(0, input.limit ?? 5);
}
export function parseDuckDuckGoHtmlResults(html) {
    const hits = [];
    const anchorRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(html)) !== null) {
        const rawUrl = match[1] ?? "";
        const titleHtml = match[2] ?? "";
        const searchWindow = html.slice(match.index, match.index + 2500);
        const snippetMatch = searchWindow.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
        const resolvedUrl = resolveDuckDuckGoHref(rawUrl);
        if (!resolvedUrl) {
            continue;
        }
        hits.push({
            title: decodeHtml(stripTags(titleHtml)),
            url: resolvedUrl,
            snippet: decodeHtml(stripTags(snippetMatch?.[1] ?? snippetMatch?.[2] ?? "")).trim() || null
        });
    }
    return dedupeHits(hits);
}
export async function fetchWebPreview(input) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(input.url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; judikaty-MCP/0.1.0)"
            },
            signal: controller.signal
        });
        if (!response.ok) {
            return {
                contentType: response.headers.get("content-type"),
                sourceMode: null,
                textPreview: null
            };
        }
        const contentType = response.headers.get("content-type");
        const maxChars = input.maxChars ?? 1200;
        if (contentType?.toLowerCase().includes("pdf") || /\.pdf(?:$|\?)/i.test(input.url)) {
            const downloaded = await downloadPdfToCache({
                provider: "web-search",
                url: input.url,
                preferredFileName: "web-result.pdf"
            });
            const text = await extractPdfText(downloaded.savedPath);
            return {
                contentType,
                sourceMode: "web_pdf_extract",
                textPreview: normalizeWhitespace(text).slice(0, maxChars) || null
            };
        }
        const html = await response.text();
        const textPreview = extractHtmlPreview(html, maxChars);
        return {
            contentType,
            sourceMode: textPreview ? "web_html" : null,
            textPreview
        };
    }
    catch {
        return {
            contentType: null,
            sourceMode: null,
            textPreview: null
        };
    }
    finally {
        clearTimeout(timeout);
    }
}
function extractHtmlPreview(html, maxChars) {
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
    const withoutNoise = body
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
    const text = normalizeWhitespace(decodeHtml(stripTags(withoutNoise)));
    return text.slice(0, maxChars) || null;
}
function resolveDuckDuckGoHref(rawHref) {
    const normalizedHref = rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;
    try {
        const url = new URL(normalizedHref);
        const uddg = url.searchParams.get("uddg");
        return uddg ? decodeURIComponent(uddg) : normalizedHref;
    }
    catch {
        return null;
    }
}
function dedupeHits(hits) {
    const seen = new Set();
    return hits.filter((hit) => {
        if (seen.has(hit.url)) {
            return false;
        }
        seen.add(hit.url);
        return true;
    });
}
function stripTags(value) {
    return value.replace(/<[^>]+>/g, " ");
}
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
}
function decodeHtml(value) {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
}
//# sourceMappingURL=web-search.js.map