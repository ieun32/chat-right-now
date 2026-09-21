/**
 * One command for local development (`npm run dev`):
 *   - builds the renderer in watch mode
 *   - starts the local signaling server
 *   - launches Electron
 *
 * Note: this starts the local WS signaling server regardless of config.json, so
 * it's handy while developing. It does not rewrite your config — if config.json
 * says "supabase", the app still uses Supabase; flip it to "local" to use the
 * server started here.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const node = process.execPath;

const procs = [];
function run(cmd, args, name) {
  const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    shutdown();
  });
  procs.push(p);
  return p;
}

function shutdown() {
  for (const p of procs) { try { p.kill(); } catch {} }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 1) signaling server
run(node, [path.join(root, 'tools/dev-signal-server.mjs')], 'signal');
// 2) renderer watch build
run(node, [path.join(root, 'tools/build.mjs'), '--watch'], 'build');
// 3) electron (give the first build a beat)
setTimeout(() => run(npx, ['electron', '.'], 'electron'), 1500);
