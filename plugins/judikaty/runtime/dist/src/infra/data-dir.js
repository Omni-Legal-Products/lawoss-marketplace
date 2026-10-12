import path from "node:path";
/** Environment variable that overrides where the local judiciary data (index, caches) lives. */
export const DATA_DIR_ENV = "JUDIKATY_DATA_DIR";
/**
 * Root of the local data directory (SQLite index, PDF and citation caches).
 *
 * `JUDIKATY_DATA_DIR` wins when set and non-empty; otherwise it is
 * `<working directory>/.cache/judiciary`, which is what production (cwd `/app`)
 * has always used. Resolved on every call, never cached: tests chdir into temp
 * directories and the query worker inherits the environment of the main thread.
 */
export function getJudiciaryDataDir() {
    const override = process.env[DATA_DIR_ENV]?.trim();
    if (override) {
        return path.resolve(override);
    }
    return path.resolve(process.cwd(), ".cache", "judiciary");
}
/** Where the data directory comes from, for self-describing diagnostics. */
export function describeDataDirSource() {
    return process.env[DATA_DIR_ENV]?.trim() ? "JUDIKATY_DATA_DIR" : "working directory";
}
/** Pure: describes where the index lives and, when it holds nothing, why that may be a wrong location. */
export function describeIndexLocation(input) {
    const dataDirSource = describeDataDirSource();
    const unusable = !input.existedBeforeOpen || input.empty;
    const resolvedFrom = dataDirSource === "JUDIKATY_DATA_DIR"
        ? "the JUDIKATY_DATA_DIR environment variable"
        : "the working directory of this server process (<cwd>/.cache/judiciary)";
    const note = unusable
        ? `The index is empty or missing. It is read from ${input.indexPath}, resolved from ${resolvedFrom}. ` +
            "A client started from another directory therefore sees a different, empty index. " +
            "Set JUDIKATY_DATA_DIR to the absolute path of the directory that holds nsud/law-index/index.sqlite " +
            "(for example in the env block of the MCP client configuration), or start the server from the directory that contains .cache/judiciary."
        : null;
    return { path: input.indexPath, exists: input.existedBeforeOpen, dataDirSource, note };
}
//# sourceMappingURL=data-dir.js.map