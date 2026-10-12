import fs from "fs";
/** Server version, read from package.json so /health and serverInfo never drift from the release. */
export const VERSION = (() => {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
        return pkg.version ?? "unknown";
    }
    catch {
        return "unknown";
    }
})();
//# sourceMappingURL=version.js.map