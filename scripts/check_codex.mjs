#!/usr/bin/env node
// Run with an isolated CODEX_HOME containing the installed CRZ plugin.
import {spawn} from 'node:child_process';
import readline from 'node:readline';
const child = spawn('codex', ['app-server', '--stdio'], {stdio: ['pipe', 'pipe', 'ignore']});
const pending = new Map(); let next = 1;
const lines = readline.createInterface({input: child.stdout});
lines.on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  const waiter = pending.get(message.id); if (!waiter) return;
  clearTimeout(waiter.timer); pending.delete(message.id);
  message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result);
});
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Timeout: ' + method)); }, 60000);
    pending.set(id, {resolve, reject, timer});
    child.stdin.write(JSON.stringify({id, method, params}) + '\n');
  });
}
try {
  await request('initialize', {clientInfo: {name: 'lawoss-install-check', version: '1'}, capabilities: {experimentalApi: true}});
  child.stdin.write(JSON.stringify({method: 'initialized'}) + '\n');
  const result = await request('mcpServerStatus/list', {limit: 100, detail: 'toolsAndAuthOnly'});
  const server = result.data.find(s => Object.hasOwn(s.tools ?? {}, 'crz_recent'));
  if (!server || server.toolsError) throw Error('Installed CRZ did not load: ' + JSON.stringify(result.data.map(s => ({name:s.name,error:s.toolsError}))));
  const thread = await request('thread/start', {ephemeral: true, cwd: process.cwd()});
  const call = await request('mcpServer/tool/call', {threadId: thread.thread.id, server: server.name, tool:'crz_recent', arguments: {limit: 1}});
  if (call.isError) throw Error('CRZ read call failed: ' + JSON.stringify(call));
  const data = JSON.parse(call.content.find(item => item.type === 'text').text);
  if (!(data.count > 0 && data.results?.[0]?.id)) throw Error('CRZ read returned no contract');
  console.log(JSON.stringify({server: server.name, toolCount: Object.keys(server.tools).length, call}));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
  lines.close(); child.kill('SIGTERM');
}
