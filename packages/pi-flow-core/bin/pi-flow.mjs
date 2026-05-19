#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [subcommand, ...rest] = process.argv.slice(2);

function parseId(id) {
  if (!id) return null;
  if (id.startsWith('/')) return null;
  const parts = id.split('/');
  if (parts.length !== 2) return null;
  const [location, name] = parts;
  if (!location || !name) return null;
  if (location === '..' || name === '..') return null;
  return { location, name };
}

function usageHint() {
  return 'Usage: pi-flow <helper|template|--help|-h>\n';
}

function helpText() {
  return `Usage: pi-flow <subcommand> [args]

Subcommands:
  helper <id> [args...]   Run a Python helper script by resource ID
  template <id>           Print the absolute path to a markdown template
  --help, -h              Show this help message

Resource ID format: <location>/<name>
  _shared/<name>          Shared helpers/templates across all skills
  <skill>/<name>          Skill-specific helpers/templates

Examples:
  pi-flow helper _shared/utils foo bar
  pi-flow template fastlane/agent-template

Fallback invocation (when bin entry is not on PATH):
  node node_modules/pi-flow-core/bin/pi-flow.mjs <args>
`;
}

if (subcommand === '--help' || subcommand === '-h') {
  process.stdout.write(helpText());
  process.exit(0);
}

if (subcommand === 'helper') {
  const id = rest[0];
  if (!id) {
    process.stderr.write(JSON.stringify({ failure: 'missing resource id' }) + '\n');
    process.exit(2);
  }
  const parsed = parseId(id);
  if (!parsed) {
    process.stderr.write(JSON.stringify({ failure: 'invalid resource id', id }) + '\n');
    process.exit(2);
  }
  const { location, name } = parsed;
  const scriptPath = location === '_shared'
    ? resolve(PACKAGE_ROOT, 'skills', '_shared', 'scripts', `${name}.py`)
    : resolve(PACKAGE_ROOT, 'skills', location, 'scripts', `${name}.py`);

  if (!existsSync(scriptPath)) {
    process.stderr.write(JSON.stringify({ failure: 'unknown helper', id, searched: scriptPath }) + '\n');
    process.exit(2);
  }

  const child = spawnSync('python3', [scriptPath, ...rest.slice(1)], { stdio: 'inherit' });
  process.exit(child.status ?? 1);
}

if (subcommand === 'template') {
  const id = rest[0];
  if (!id) {
    process.stderr.write(JSON.stringify({ failure: 'missing resource id' }) + '\n');
    process.exit(2);
  }
  const parsed = parseId(id);
  if (!parsed) {
    process.stderr.write(JSON.stringify({ failure: 'invalid resource id', id }) + '\n');
    process.exit(2);
  }
  const { location, name } = parsed;
  const mdPath = location === '_shared'
    ? resolve(PACKAGE_ROOT, 'skills', '_shared', `${name}.md`)
    : resolve(PACKAGE_ROOT, 'skills', location, `${name}.md`);

  if (!existsSync(mdPath)) {
    process.stderr.write(JSON.stringify({ failure: 'unknown template', id, searched: mdPath }) + '\n');
    process.exit(2);
  }

  process.stdout.write(mdPath + '\n');
  process.exit(0);
}

process.stderr.write(`Unknown subcommand: ${subcommand ?? '(none)'}\n${usageHint()}`);
process.exit(2);
