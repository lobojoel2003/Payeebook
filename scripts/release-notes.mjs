#!/usr/bin/env node
/**
 * Print the CHANGELOG.md section for a version, for the GitHub release body.
 *   node scripts/release-notes.mjs 1.2.3
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (
  process.argv[2] ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
).replace(/^v/, '');
const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const start = text.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
if (start < 0) {
  console.error(`No section for ${version} in CHANGELOG.md`);
  process.exit(1);
}
const rest = text.slice(start);
const next = rest.slice(3).search(/^## \[/m);
const section = (next < 0 ? rest : rest.slice(0, next + 3)).replace(/^## .*\n/, '').trim();
process.stdout.write(`${section}\n`);
