#!/usr/bin/env node
// Portable LAWOSS local-runtime launcher. Plugin packagers copy this file verbatim.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = 'Usage: node scripts/run.mjs [--server NAME] [mcp|doctor|tools|call TOOL JSON|--help]\nRequires the Node.js version declared by this plugin and npm for the first run. No global CLI installation.\n';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  let index = 0;
  let requestedServer = null;
  if (argv[index] === '--server') {
    if (!argv[index + 1]) throw new Error(help);
    requestedServer = argv[index + 1];
    index += 2;
  }
  const mode = argv[index] ?? 'mcp';
  const rest = argv.slice(index + 1);
  if (!['mcp', 'doctor', 'tools', 'call'].includes(mode)) throw new Error(help);
  if (mode !== 'call' && rest.length !== 0) throw new Error(help);
  if (mode === 'call') {
    if (rest.length !== 2 || !rest[0]) throw new Error(help);
    let args;
    try { args = JSON.parse(rest[1]); }
    catch { throw new Error('Tool arguments must be a JSON object.'); }
    if (!args || Array.isArray(args) || typeof args !== 'object')
      throw new Error('Tool arguments must be a JSON object.');
    return { mode, requestedServer, tool: rest[0], args };
  }
  return { mode, requestedServer };
}

function isObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function requireSlug(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new Error(`${label} must be a lowercase plugin slug.`);
}

function requireRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error(`${label} must be a safe relative runtime path.`);
}

function requireEntrypoint(value, label) {
  requireRelativePath(value, label);
  if (!/\.(?:c|m)?js$/.test(value)) throw new Error(`${label} must be a JavaScript file.`);
}

function parseVersion(value, label) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value))
    throw new Error(`${label} must be a semantic version such as 22.14.0.`);
  return value.split('.').map(Number);
}

function versionBefore(actual, minimum) {
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== minimum[index]) return actual[index] < minimum[index];
  }
  return false;
}

function validateConfig(config) {
  if (!isObject(config)) throw new Error('runtime-config.json must contain an object.');
  const allowed = new Set(['name', 'entrypoint', 'minimumNode', 'servers', 'defaultServer', 'nativeBuilds']);
  const unknown = Object.keys(config).find(key => !allowed.has(key));
  if (unknown) throw new Error(`runtime-config.json has unknown field: ${unknown}`);
  requireSlug(config.name, 'Runtime name');
  requireEntrypoint(config.entrypoint, 'Runtime entrypoint');
  const minimumNode = parseVersion(config.minimumNode, 'minimumNode');
  if (config.servers !== undefined) {
    if (!isObject(config.servers) || Object.keys(config.servers).length === 0)
      throw new Error('servers must be a non-empty object.');
    for (const [name, entrypoint] of Object.entries(config.servers)) {
      requireSlug(name, 'Each server slug');
      requireEntrypoint(entrypoint, `Server ${name} entrypoint`);
    }
  }
  if (config.defaultServer !== undefined) {
    requireSlug(config.defaultServer, 'defaultServer');
    if (!config.servers || !Object.hasOwn(config.servers, config.defaultServer))
      throw new Error('defaultServer must name a configured server.');
  }
  if (config.nativeBuilds !== undefined) {
    if (!Array.isArray(config.nativeBuilds) || config.nativeBuilds.length === 0)
      throw new Error('nativeBuilds must be a non-empty array.');
    if (new Set(config.nativeBuilds).size !== config.nativeBuilds.length ||
        config.nativeBuilds.some(name => name !== 'better-sqlite3'))
      throw new Error('nativeBuilds may contain only the supported native package better-sqlite3.');
  }
  return minimumNode;
}

function selectEntrypoint(config, requestedServer) {
  if (requestedServer !== null) {
    requireSlug(requestedServer, 'Requested server');
    if (!config.servers || !Object.hasOwn(config.servers, requestedServer))
      throw new Error(`Unknown server: ${requestedServer}`);
    return { server: requestedServer, entrypoint: config.servers[requestedServer] };
  }
  if (config.defaultServer !== undefined)
    return { server: config.defaultServer, entrypoint: config.servers[config.defaultServer] };
  return { server: null, entrypoint: config.entrypoint };
}

async function requireRegularFile(path, label) {
  const info = await lstat(path).catch(() => null);
  if (!info) throw new Error(`${label} is missing.`);
  if (info.isSymbolicLink()) throw new Error(`${label} must not use symbolic links.`);
  if (!info.isFile()) throw new Error(`${label} must be a regular file.`);
}

async function requireDirectory(path, label) {
  const info = await lstat(path).catch(() => null);
  if (!info) throw new Error(`${label} is missing.`);
  if (info.isSymbolicLink()) throw new Error(`${label} must not use symbolic links.`);
  if (!info.isDirectory()) throw new Error(`${label} must be a directory.`);
}

async function inventoryRuntime(directory, relative = '') {
  const found = [];
  for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Runtime must not contain symbolic links: ${name}`);
    if (entry.isDirectory()) found.push(...await inventoryRuntime(directory, name));
    else if (entry.isFile()) found.push(name);
    else throw new Error(`Runtime contains a non-regular file: ${name}`);
  }
  return found;
}

function validateManifest(manifest) {
  if (!isObject(manifest) || !isObject(manifest.files) || Object.keys(manifest.files).length === 0)
    throw new Error('Runtime provenance must contain a non-empty files object.');
  if (typeof manifest.configSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.configSha256))
    throw new Error('Runtime provenance must contain configSha256.');
  for (const [name, digest] of Object.entries(manifest.files)) {
    requireRelativePath(name, 'Each provenance file');
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest))
      throw new Error(`Runtime provenance has an invalid SHA-256 digest: ${name}`);
  }
}

async function verifySourceRuntime(runtime, manifest) {
  const actual = (await inventoryRuntime(runtime)).filter(name => name !== 'provenance.json').sort();
  const expected = Object.keys(manifest.files).sort();
  const unlisted = actual.find(name => !Object.hasOwn(manifest.files, name));
  if (unlisted) throw new Error(`Runtime contains an unlisted file: ${unlisted}`);
  const missing = expected.find(name => !actual.includes(name));
  if (missing) throw new Error(`Runtime provenance lists a missing file: ${missing}`);
  for (const [name, expectedDigest] of Object.entries(manifest.files)) {
    const digest = sha256(await readFile(join(runtime, ...name.split('/'))));
    if (digest !== expectedDigest) throw new Error(`Runtime integrity check failed: ${name}`);
  }
}

async function readCachedFile(cache, name) {
  let current = cache;
  const parts = name.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const info = await lstat(current).catch(() => null);
    if (!info || info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      return null;
  }
  return readFile(current);
}

async function verifyCache(cache, manifest) {
  for (const [name, expectedDigest] of Object.entries(manifest.files)) {
    const bytes = await readCachedFile(cache, name);
    if (!bytes || sha256(bytes) !== expectedDigest)
      throw new Error(`Cached runtime integrity check failed: ${name}. Remove this version's cache and retry: ${cache}`);
  }
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) { process.stdout.write(help); return; }

  const configPath = join(root, 'runtime-config.json');
  const runtime = join(root, 'runtime');
  const provenancePath = join(runtime, 'provenance.json');
  await requireRegularFile(configPath, 'runtime-config.json');
  await requireDirectory(runtime, 'Runtime directory');
  await requireRegularFile(provenancePath, 'Runtime provenance');
  const configBytes = await readFile(configPath);
  const provenanceBytes = await readFile(provenancePath);
  const config = JSON.parse(configBytes);
  const minimumNode = validateConfig(config);
  const selected = selectEntrypoint(config, parsed.requestedServer);
  const manifest = JSON.parse(provenanceBytes);
  validateManifest(manifest);
  if (sha256(configBytes) !== manifest.configSha256)
    throw new Error('Runtime configuration integrity check failed.');
  const configuredEntrypoints = [config.entrypoint, ...Object.values(config.servers ?? {})];
  const unlistedEntrypoint = configuredEntrypoints.find(name => !Object.hasOwn(manifest.files, name));
  if (unlistedEntrypoint)
    throw new Error(`Runtime entrypoint must be listed in provenance: ${unlistedEntrypoint}`);
  const actualNode = process.versions.node.split('.').slice(0, 3).map(Number);
  if (versionBefore(actualNode, minimumNode))
    throw new Error(`Install Node.js >=${config.minimumNode} with npm, then retry.`);
  await verifySourceRuntime(runtime, manifest);

  const provenanceDigest = sha256(provenanceBytes).slice(0, 24);
  const cacheKey = `${provenanceDigest}-${process.platform}-${process.arch}-${process.versions.modules}`;
  const cacheBase = resolve(process.env.LAWOSS_CACHE_DIR || join(homedir(), '.cache', 'lawoss'), config.name);
  const cache = join(cacheBase, cacheKey);
  const statePath = process.env.LAWOSS_STATE_DIR ? resolve(process.env.LAWOSS_STATE_DIR, config.name) : join(cacheBase, 'state');
  let ready = false;
  const readyPath = join(cache, '.ready');
  const readyInfo = await lstat(readyPath).catch(() => null);
  if (readyInfo?.isSymbolicLink()) throw new Error(`Cached runtime marker must not be a symbolic link: ${readyPath}`);
  if (readyInfo?.isFile()) ready = (await readFile(readyPath, 'utf8')) === cacheKey;
  if (ready) await verifyCache(cache, manifest);

  if (parsed.mode === 'doctor') {
    process.stdout.write(JSON.stringify({
      node: process.versions.node,
      runtime: config.name,
      server: selected.server,
      entrypoint: selected.entrypoint,
      commit: manifest.commit,
      cached: ready,
      cache,
      cacheKey,
      statePath,
    }) + '\n');
    return;
  }

  if (!ready) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const probe = spawnSync(npm, ['--version'], { stdio: 'ignore' });
    if (probe.status !== 0) throw new Error('npm is required for the first run; install Node.js with npm.');
    await mkdir(cacheBase, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(cacheBase, '.install-'));
    try {
      await cp(runtime, staging, { recursive: true });
      process.stderr.write(`[LAWOSS ${config.name.toUpperCase()}] Installing locked local dependencies for this runtime version…\n`);
      const installed = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: staging,
        stdio: ['ignore', 2, 2],
        timeout: 240000,
      });
      if (installed.status !== 0)
        throw new Error('Dependency installation failed; check npm/network access and retry.');
      for (const nativePackage of config.nativeBuilds ?? []) {
        const rebuilt = spawnSync(npm, ['rebuild', '--foreground-scripts', nativePackage], {
          cwd: staging,
          stdio: ['ignore', 2, 2],
          timeout: 240000,
        });
        if (rebuilt.status !== 0)
          throw new Error(`Native dependency build failed for ${nativePackage}; check prebuilt-binary availability or install a C/C++ compiler toolchain, then retry.`);
      }
      await verifyCache(staging, manifest);
      await writeFile(join(staging, '.ready'), cacheKey, { mode: 0o600 });
      try { await rename(staging, cache); }
      catch (error) {
        const marker = await readFile(join(cache, '.ready'), 'utf8').catch(() => '');
        if (marker !== cacheKey) throw error;
        await verifyCache(cache, manifest);
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  const entrypoint = join(cache, ...selected.entrypoint.split('/'));
  await mkdir(statePath, { recursive: true, mode: 0o700 });
  const policy = config.name === 'cz-agents' ? await import('./runtime-policy.mjs') : null;
  const childEnv = policy ? policy.serverEnvironment(selected.server, process.env) : process.env;
  if (parsed.mode === 'mcp' && !policy) {
    const child = spawn(process.execPath, [entrypoint], { stdio: 'inherit', cwd: statePath, env: process.env });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
    child.on('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    return;
  }

  const sdk = join(cache, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client');
  const { Client } = await import(pathToFileURL(join(sdk, 'index.js')));
  const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'stdio.js')));
  const client = new Client({ name: `lawoss-${config.name}-cli`, version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint],
      cwd: statePath,
      stderr: 'inherit',
      env: childEnv,
    }));
    const inspectSanctions = async path => {
      const { default: Database } = await import(pathToFileURL(join(cache, 'node_modules/better-sqlite3/lib/index.js')));
      const db = new Database(path, { readonly: true, fileMustExist: true });
      try { return db.prepare('SELECT source, refreshed_at, source_count, ok FROM refresh_log').all(); }
      finally { db.close(); }
    };
    const list = async () => {
      const result = await client.listTools();
      const note = policy?.coverageNote(selected.server);
      if (note) result.tools = result.tools.map(tool => ({ ...tool, description: `${tool.description || ''} Coverage: ${note}` }));
      return result;
    };
    const call = async params => {
      const blocked = await policy?.blockedCall(selected.server, params.name, params.arguments || {}, childEnv, inspectSanctions);
      if (blocked) return { isError: true, content: [{type:'text', text:blocked}] };
      const result = await client.callTool(params);
      const note = policy?.coverageNote(selected.server);
      if (note) result.content = [...(result.content || []), {type:'text', text:`Coverage: ${note}`}];
      if (selected.server === 'sanctions' && !result.isError) {
        const rows = await inspectSanctions(childEnv.SANCTIONS_DB);
        result.content.push({type:'text',text:'Verified source coverage: ' + JSON.stringify(rows)});
      }
      return result;
    };
    if (parsed.mode === 'mcp') {
      const { Server } = await import(pathToFileURL(join(cache, 'node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js')));
      const { StdioServerTransport } = await import(pathToFileURL(join(cache, 'node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js')));
      const { ListToolsRequestSchema, CallToolRequestSchema } = await import(pathToFileURL(join(cache, 'node_modules/@modelcontextprotocol/sdk/dist/esm/types.js')));
      const server = new Server({name:`lawoss-${config.name}-${selected.server}`,version:'1.0.0'}, {capabilities:{tools:{}}});
      server.setRequestHandler(ListToolsRequestSchema, list);
      server.setRequestHandler(CallToolRequestSchema, request => call(request.params));
      await server.connect(new StdioServerTransport());
      await new Promise(resolve => { process.stdin.once('end', resolve); for (const signal of ['SIGINT','SIGTERM']) process.once(signal, resolve); });
      await server.close();
    } else {
      const result = parsed.mode === 'tools' ? await list() : await call({ name: parsed.tool, arguments: parsed.args });
      process.stdout.write(JSON.stringify(result) + '\n');
      if (result.isError) process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

main().catch(error => {
  process.stderr.write(`[LAWOSS] ${error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : error.message}\n`);
  process.exitCode = 1;
});
