import { existsSync, cpSync, copyFileSync, statSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const force = process.env.FORCE === '1';

function copyDirIfNeeded(src, dest, label) {
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

function copyFileIfNeeded(src, dest, label) {
  if (!existsSync(src)) {
    console.warn(`[vendor] skip ${label}: source not found (${src})`);
    return;
  }
  if (!force && existsSync(dest)) {
    console.log(`[vendor] ${label} already present, skipping (set FORCE=1 to overwrite)`);
    return;
  }
  const destDir = dirname(dest);
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  console.log(`[vendor] copied ${label}`);
}

// MathJax es5 is already browser-ready; copy it from node_modules.
copyDirIfNeeded(
  resolve(root, 'node_modules/mathjax/es5'),
  resolve(root, 'public/vendor/mathjax/es5'),
  'mathjax',
);

// Lazy-loaded vendor libs copied from node_modules
copyFileIfNeeded(
  resolve(root, 'node_modules/jszip/dist/jszip.min.js'),
  resolve(root, 'public/vendor/libs/jszip.min.js'),
  'jszip',
);
copyFileIfNeeded(
  resolve(root, 'node_modules/mammoth/mammoth.browser.min.js'),
  resolve(root, 'public/vendor/libs/mammoth.min.js'),
  'mammoth',
);
copyFileIfNeeded(
  resolve(root, 'node_modules/xlsx/dist/xlsx.full.min.js'),
  resolve(root, 'public/vendor/libs/xlsx.full.min.js'),
  'xlsx',
);

// highlight.js theme styles copied from node_modules
copyFileIfNeeded(
  resolve(root, 'node_modules/highlight.js/styles/github-dark.min.css'),
  resolve(root, 'public/vendor/highlight/styles/github-dark.min.css'),
  'highlight styles',
);

console.log('[vendor] done');
