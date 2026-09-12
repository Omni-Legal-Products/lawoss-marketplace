import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDecisionMarkdownWindow } from "./markdown.js";
export async function exportWholeDecisionMarkdown(input) {
    const chunks = [];
    let offsetChars = 0;
    let consumedChars = 0;
    let windowCount = 0;
    let complete = false;
    let continueFromOffset = null;
    let sourceMode = "inline";
    let textSha256 = null;
    while (consumedChars < input.maxCharsTotal) {
        const remainingChars = input.maxCharsTotal - consumedChars;
        const maxChars = Math.min(input.windowChars, remainingChars);
        const textWindow = await input.getTextWindow({
            offsetChars,
            maxChars
        });
        const rendered = buildDecisionMarkdownWindow({
            detail: input.detail,
            textWindow,
            includeMetadata: windowCount === 0
        });
        chunks.push(rendered.markdown);
        windowCount += 1;
        consumedChars += textWindow.text.length;
        sourceMode = textWindow.sourceMode;
        textSha256 = textWindow.textSha256;
        if (textWindow.windowComplete) {
            complete = true;
            continueFromOffset = null;
            break;
        }
        if (textWindow.nextOffset == null) {
            continueFromOffset = null;
            break;
        }
        offsetChars = textWindow.nextOffset;
        continueFromOffset = textWindow.nextOffset;
    }
    let markdown = chunks.join("\n\n");
    if (!complete && continueFromOffset != null) {
        markdown = `${markdown}\n\n---\n\nExport truncated before the full decision text was stitched. Continue from offset ${continueFromOffset} with get_decision_markdown if needed.`;
    }
    let savedPath = null;
    if (input.savePath) {
        await mkdir(dirname(input.savePath), { recursive: true });
        await writeFile(input.savePath, markdown, "utf-8");
        savedPath = input.savePath;
    }
    return {
        provider: input.detail.provider,
        id: input.detail.providerId,
        markdown,
        windowCount,
        complete,
        truncated: !complete,
        continueFromOffset,
        sourceMode,
        textSha256,
        savedPath
    };
}
export function buildDefaultMarkdownExportPath(detail) {
    const label = sanitizePathSegment(detail.spisovaZnacka ?? detail.ecli ?? detail.providerId);
    return resolve(process.cwd(), "exports", "decision-markdown", `${detail.provider}-${label}.md`);
}
function sanitizePathSegment(value) {
    return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}
//# sourceMappingURL=markdown-export.js.map