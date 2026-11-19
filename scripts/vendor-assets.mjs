#!/usr/bin/env node
/**
 * Copy the OCR engine (tesseract.js worker + WebAssembly core) and the English
 * language model into public/vendor so receipts are read entirely on-device,
 * with no requests to a CDN. Run automatically before `dev` and `build`.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'vendor', 'tesseract');

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const tesseract = pkgDir('tesseract.js');
const core = pkgDir('tesseract.js-core');
const lang = pkgDir('@tesseract.js-data/eng');

const files = [
  [join(tesseract, 'dist', 'worker.min.js'), join(out, 'worker.min.js')],
  ...[
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
  ].map((f) => [join(core, f), join(out, 'core', f)]),
  [join(lang, '4.0.0_best_int', 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz')],
];

let copied = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.error(`[vendor] missing ${from}. Did you run npm install?`);
    process.exit(1);
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}
console.log(
  `[vendor] OCR assets ready in public/vendor/tesseract (${copied} copied, ${files.length - copied} up to date)`,
);
