import { existsSync, cpSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const force = process.env.FORCE === '1';

function copyIfNeeded(src, dest, label) {
  if (!existsSync(src)) {
    console.warn(`[vendor] skip ${label}: source not found (${src})`);
    return;
  }
  if (!force && existsSync(dest) && statSync(dest).isDirectory()) {
    console.log(`[vendor] ${label} already present, skipping (set FORCE=1 to overwrite)`);
    return;
  }
  cpSync(src, dest, { recursive: true, force: true });
  console.log(`[vendor] copied ${label}`);
}

// MathJax es5 is already browser-ready; copy it from node_modules.
copyIfNeeded(
  resolve(root, 'node_modules/mathjax/es5'),
  resolve(root, 'public/vendor/mathjax/es5'),
  'mathjax',
);

// highlight.js assets are vendored (downloaded once) and committed under
// public/vendor/highlight; nothing to copy here.
console.log('[vendor] done');
