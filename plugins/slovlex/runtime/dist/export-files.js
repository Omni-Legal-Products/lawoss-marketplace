import path from "node:path";
import { mkdir, open } from "node:fs/promises";
import fs from "node:fs";
export function resolveConfiguredExportRoot(env, cwd = process.cwd()) {
    return path.resolve(env.MCP_EXPORT_ROOT?.trim() || path.join(cwd, "exports"));
}
export function safeResolveExportPath(outputPath, root) {
    if (path.isAbsolute(outputPath))
        throw new Error("Export path must be relative to the configured export root");
    const finalPath = outputPath.endsWith(".md") ? outputPath : `${outputPath}.md`;
    const rootAbs = path.resolve(root);
    try {
        if (fs.lstatSync(rootAbs).isSymbolicLink())
            throw new Error("Export root must not be a symlink");
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    const candidate = path.resolve(rootAbs, finalPath);
    if (candidate !== rootAbs && !candidate.startsWith(`${rootAbs}${path.sep}`)) {
        throw new Error("Export path escapes the configured export root boundary");
    }
    let current = rootAbs;
    for (const part of path.relative(rootAbs, candidate).split(path.sep)) {
        current = path.join(current, part);
        try {
            if (fs.lstatSync(current).isSymbolicLink())
                throw new Error("Export path contains a symlink escape");
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
    return candidate;
}
export function resolveMarkdownPath(outputPath, cwd = process.cwd(), exportRoot) {
    if (exportRoot)
        return safeResolveExportPath(outputPath, exportRoot);
    const finalPath = outputPath.endsWith(".md") ? outputPath : `${outputPath}.md`;
    return path.isAbsolute(finalPath) ? finalPath : path.resolve(cwd, finalPath);
}
export async function writeMarkdownFile(content, outputPath, cwd = process.cwd(), exportRoot) {
    const abs = resolveMarkdownPath(outputPath, cwd, exportRoot);
    await mkdir(path.dirname(abs), { recursive: true });
    const handle = await open(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
    try {
        await handle.writeFile(content, "utf8");
    }
    finally {
        await handle.close();
    }
    return abs;
}
export function formatSavedMarkdownResult({ absPath, serverCwd = process.cwd(), sourceKind, sourceRef, sourceDate, sourceCategory, totalChars, savedChars, truncated, }) {
    return [
        "Markdown ulozeny na filesystem servera.",
        `MCP_SERVER_FILE_PATH: ${absPath}`,
        "MCP_FILE_SCOPE: server-local",
        `MCP_SERVER_CWD: ${serverCwd}`,
        `MCP_SOURCE_KIND: ${sourceKind}`,
        `MCP_SOURCE_REF: ${sourceRef}`,
        sourceDate ? `MCP_SOURCE_DATE: ${sourceDate}` : null,
        sourceCategory ? `MCP_SOURCE_CATEGORY: ${sourceCategory}` : null,
        `MCP_TEXT_TOTAL_CHARS: ${totalChars}`,
        `MCP_TEXT_SAVED_CHARS: ${savedChars}`,
        `MCP_TEXT_TRUNCATED: ${truncated ? "true" : "false"}`,
        "POZOR: Ak tvoj shell bezi inde ako MCP server, tato cesta tam nemusi existovat.",
        "Na citanie exportu pouzi read_saved_markdown alebo povodne obsahove tooly.",
    ]
        .filter(Boolean)
        .join("\n");
}
export async function readMarkdownFileWindow(filePath, options = {}) {
    const absPath = resolveMarkdownPath(filePath, options.cwd, options.exportRoot);
    const handle = await open(absPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let fullText;
    try {
        fullText = await handle.readFile("utf8");
    }
    finally {
        await handle.close();
    }
    const maxChars = options.maxChars ?? 20_000;
    const offsetChars = Math.max(0, Math.min(options.offsetChars ?? 0, fullText.length));
    const text = fullText.slice(offsetChars, offsetChars + maxChars);
    const returnedChars = text.length;
    const hasMore = offsetChars + returnedChars < fullText.length;
    return {
        absPath,
        totalChars: fullText.length,
        offsetChars,
        returnedChars,
        hasMore,
        text,
    };
}
export function formatReadMarkdownWindowResult(result) {
    const windowEnd = result.offsetChars + result.returnedChars;
    return [
        "Markdown z filesystemu servera.",
        `MCP_SERVER_FILE_PATH: ${result.absPath}`,
        "MCP_FILE_SCOPE: server-local",
        `MCP_WINDOW_COMPLETE: ${result.hasMore ? "false" : "true"}`,
        `MCP_TOTAL_CHARS: ${result.totalChars}`,
        `MCP_RETURNED_CHARS: ${result.returnedChars}`,
        `Text window: ${result.offsetChars}-${windowEnd} / ${result.totalChars} chars`,
        result.hasMore ? `MCP_NEXT_OFFSET: ${windowEnd}` : "MCP_NEXT_OFFSET: none",
        result.hasMore ? "POZOR: Toto je iba vyrez ulozeneho markdownu." : null,
        "",
        result.text,
    ]
        .filter(Boolean)
        .join("\n");
}
