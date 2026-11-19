#!/usr/bin/env node
/**
 * Keep every version number in step with package.json, the single source of
 * truth. `npm version <patch|minor|major>` runs this automatically.
 *
 *   node scripts/sync-version.mjs            update Cargo.toml / Cargo.lock
 *   node scripts/sync-version.mjs --check    fail if anything disagrees
 *   node scripts/sync-version.mjs --check --tag v1.2.3   also compare a git tag
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const tagIdx = args.indexOf('--tag');
const tag = tagIdx >= 0 ? args[tagIdx + 1] : null;

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`package.json version "${version}" is not semantic versioning`);
  process.exit(1);
}

const problems = [];
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
const cargoVersion = /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
const lockPath = join(root, 'src-tauri', 'Cargo.lock');
const lock = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null;
const lockRe = /(\[\[package\]\]\nname = "payeebook"\nversion = ")([^"]+)(")/;
const lockVersion = lock ? lockRe.exec(lock)?.[2] : undefined;
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));

if (check) {
  if (cargoVersion !== version)
    problems.push(`src-tauri/Cargo.toml is ${cargoVersion}, package.json is ${version}`);
  if (lock && lockVersion && lockVersion !== version)
    problems.push(`src-tauri/Cargo.lock is ${lockVersion}, package.json is ${version}`);
  if (conf.version !== '../package.json' && conf.version !== version)
    problems.push(`tauri.conf.json version is ${conf.version}`);
  if (tag && tag.replace(/^refs\/tags\//, '').replace(/^v/, '') !== version)
    problems.push(`tag ${tag} does not match package.json version ${version}`);
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(changelog))
    problems.push(`CHANGELOG.md has no "## [${version}]" section`);
  if (problems.length) {
    console.error(`Version check failed:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`Version ${version} is consistent${tag ? ` with tag ${tag}` : ''}.`);
  process.exit(0);
}

writeFileSync(
  cargoPath,
  cargo.replace(/^(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m, `$1${version}$3`),
);
if (lock && lockVersion) writeFileSync(lockPath, lock.replace(lockRe, `$1${version}$3`));
console.log(`Synced desktop app version to ${version}.`);
