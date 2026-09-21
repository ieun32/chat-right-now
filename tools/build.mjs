/**
 * Bundles the renderer (which pulls in @supabase/supabase-js, tweetnacl, and the
 * shared/net modules) into dist/renderer.js, and copies the static shell.
 *
 *   node tools/build.mjs           one-shot build
 *   node tools/build.mjs --watch   rebuild on change
 *
 * The Electron main process and preload run in Node and are NOT bundled — they
 * are loaded straight from src/main and only use built-ins + electron.
 */
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: [path.join(root, 'src/renderer/renderer.js')],
  outfile: path.join(dist, 'renderer.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

async function copyShell() {
  await mkdir(dist, { recursive: true });
  await cp(path.join(root, 'src/renderer/index.html'), path.join(dist, 'index.html'));
  await cp(path.join(root, 'src/renderer/styles.css'), path.join(dist, 'styles.css'));
  // Surface config.json to the renderer without shipping it through the bundle.
  const cfgPath = existsSync(path.join(root, 'config.json'))
    ? path.join(root, 'config.json')
    : path.join(root, 'config.example.json');
  const cfg = await readFile(cfgPath, 'utf8');
  await writeFile(path.join(dist, 'config.json'), cfg);
}

await copyShell();

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log('[build] watching…');
} else {
  await build(buildOptions);
  console.log('[build] done → dist/');
}
