/**
 * Shared plumbing for spawning worker threads from either source (tsx) or the
 * compiled `dist` output.
 *
 * Two things bite here. The on-disk sibling is `.ts` under tsx but `.js` after
 * `tsc`, and a worker resolves the bare `tsx` specifier it inherits in
 * `--import` against its *cwd* — which fails whenever the process was started
 * outside the project directory. Resolving tsx against the calling module fixes
 * both dev servers launched from elsewhere and tests that chdir.
 */
export function resolveWorkerEntry(input) {
    const runningFromSource = input.callerUrl.endsWith(".ts");
    const filename = runningFromSource ? `./${input.basename}.ts` : `./${input.basename}.js`;
    const url = new URL(filename, input.callerUrl);
    if (!runningFromSource)
        return { url, options: {} };
    try {
        return { url, options: { execArgv: ["--import", import.meta.resolve("tsx")] } };
    }
    catch {
        // tsx not resolvable from here — fall back to whatever the process inherited.
        return { url, options: {} };
    }
}
//# sourceMappingURL=worker-support.js.map