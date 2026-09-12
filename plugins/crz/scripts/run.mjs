#!/usr/bin/env node
// Local stdio and CLI share the same integrity-locked runtime.
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'mcp';
const help = 'Usage: node scripts/run.mjs [mcp|doctor|tools|call TOOL JSON|--help]\nRequires Node >=22.13 and npm for the first run. No global CLI installation.\n';

async function main() {
  if (mode === '--help') { process.stdout.write(help); return; }
  if (!['mcp', 'doctor', 'tools', 'call'].includes(mode)) throw new Error(help);
  let args;
  if (mode === 'call') {
    if (!process.argv[3] || process.argv.length !== 5) throw new Error(help);
    args = JSON.parse(process.argv[4]);
    if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('Tool arguments must be a JSON object.');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('Install Node.js >=22.13 with npm, then retry.');
  const runtime = join(root, 'runtime');
  const provenance = await readFile(join(runtime, 'provenance.json'), 'utf8');
  const manifest = JSON.parse(provenance);
  for (const [name, expected] of Object.entries(manifest.files)) {
    const path = resolve(runtime, name);
    const rel = relative(runtime, path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Runtime path escapes plugin.');
    const digest = createHash('sha256').update(await readFile(path)).digest('hex');
    if (digest !== expected) throw new Error(`Runtime integrity check failed: ${name}`);
  }
  const digest = createHash('sha256').update(provenance).digest('hex').slice(0, 24);
  const base = resolve(process.env.LAWOSS_CACHE_DIR || join(homedir(), '.cache', 'lawoss'), 'crz');
  const cache = join(base, `${digest}-${process.platform}-${process.arch}-${process.versions.modules}`);
  let ready = false;
  try { ready = (await readFile(join(cache, '.ready'), 'utf8')) === digest; } catch {}
  if (ready) {
    for (const [name, expected] of Object.entries(manifest.files)) {
      const bytes = await readFile(join(cache, name)).catch(() => null);
      if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected)
        throw new Error(`Cached runtime integrity check failed: ${name}. Remove this version's cache and retry: ${cache}`);
    }
  }
  if (mode === 'doctor') {
    process.stdout.write(JSON.stringify({node: process.versions.node, runtime: 'crz', commit: manifest.commit, cached: ready, cache}) + '\n');
    return;
  }
  if (!ready) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const probe = spawnSync(npm, ['--version'], {stdio: 'ignore'});
    if (probe.status !== 0) throw new Error('npm is required for the first run; install Node.js with npm.');
    await mkdir(base, {recursive: true, mode: 0o700});
    const staging = await mkdtemp(join(base, '.install-'));
    try {
      await cp(runtime, staging, {recursive: true});
      process.stderr.write('[LAWOSS CRZ] Installing locked local dependencies for this runtime version…\n');
      const installed = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
        {cwd: staging, stdio: ['ignore', 2, 2], timeout: 240000});
      if (installed.status !== 0) throw new Error('Dependency installation failed; check npm/network access and retry.');
      const {writeFile} = await import('node:fs/promises');
      await writeFile(join(staging, '.ready'), digest);
      try { await rename(staging, cache); }
      catch (error) {
        // Another process may have completed the identical installation first.
        if ((await readFile(join(cache, '.ready'), 'utf8').catch(() => '')) !== digest) throw error;
      }
    } finally { await rm(staging, {recursive: true, force: true}); }
  }
  if (mode === 'mcp') {
    const child = spawn(process.execPath, [join(cache, 'dist/index.js')], {stdio: 'inherit', cwd: cache});
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    return;
  }
  const {Client} = await import(pathToFileURL(join(cache, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
  const {StdioClientTransport} = await import(pathToFileURL(join(cache, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')));
  const client = new Client({name: 'lawoss-crz-cli', version: '1.0.0'});
  try {
    await client.connect(new StdioClientTransport({command: process.execPath, args: [join(cache, 'dist/index.js')], cwd: cache, stderr: 'inherit', env: process.env}));
    const result = mode === 'tools' ? await client.listTools() : await client.callTool({name: process.argv[3], arguments: args});
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.isError) process.exitCode = 1;
  } finally { await client.close(); }
}

main().catch(error => { process.stderr.write(`[LAWOSS CRZ] ${error.message}\n`); process.exitCode = 1; });
