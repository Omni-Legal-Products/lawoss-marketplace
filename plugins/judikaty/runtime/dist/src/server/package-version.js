import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const PACKAGE_NAME = "slovak-judiciary-mcp";
const MAX_LEVELS = 6;
/**
 * The version of the package this code was shipped in.
 *
 * Searched upwards from this module, because the depth differs between a source
 * checkout (src/server), a build (dist/src/server) and the packaged plugin runtime
 * (runtime/dist/src/server). Only this server's own package.json counts. Returns
 * "unknown" rather than inventing a version.
 */
export function readPackageVersion(startDir = path.dirname(fileURLToPath(import.meta.url))) {
    let dir = startDir;
    for (let level = 0; level <= MAX_LEVELS; level += 1) {
        try {
            const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
            if (pkg.name === PACKAGE_NAME && typeof pkg.version === "string" && pkg.version) {
                return pkg.version;
            }
        }
        catch {
            // No readable package.json here; keep walking up.
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return "unknown";
}
//# sourceMappingURL=package-version.js.map