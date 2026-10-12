// Startup guard for the Node.js version. This module must stay free of
// `node:sqlite` (and of any module that reaches it): the entry points import it
// first and load the rest of the server only after the check passed, because on
// Node 22.12 or older the missing builtin makes the module graph fail with
// ERR_UNKNOWN_BUILTIN_MODULE before any code of ours could print a useful error.
/** First release per major line where `node:sqlite` loads without a flag. */
const SQLITE_WITHOUT_FLAG = [
    { major: 22, minor: 13 },
    { major: 23, minor: 4 }
];
export const MIN_NODE_VERSION_LABEL = "22.13";
export function isSupportedNodeVersion(version) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
    if (!match) {
        return false;
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const firstWithoutFlag = SQLITE_WITHOUT_FLAG.find((entry) => entry.major === major);
    if (firstWithoutFlag) {
        return minor >= firstWithoutFlag.minor;
    }
    return major > SQLITE_WITHOUT_FLAG[SQLITE_WITHOUT_FLAG.length - 1].major;
}
export function unsupportedNodeMessage(version) {
    return `slovak-judiciary MCP requires Node.js ${MIN_NODE_VERSION_LABEL} or newer (found ${version}): node:sqlite is not available without a flag in older releases.`;
}
/** Returns true when the running Node is supported; otherwise logs one line and exits with 1. */
export function enforceSupportedNodeVersion(version = process.versions.node, io = { log: (line) => console.error(line), exit: (code) => process.exit(code) }) {
    if (isSupportedNodeVersion(version)) {
        return true;
    }
    io.log(unsupportedNodeMessage(version));
    io.exit(1);
    return false;
}
//# sourceMappingURL=node-version.js.map