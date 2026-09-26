/**
 * Major-bump gate for the release trains.
 *
 * Policy: never auto-publish a major bump. Push-triggered CI must fail closed.
 * Manual `workflow_dispatch` with `confirm_major=true` is the only release path
 * that sets CONFIRM_MAJOR=1 and lets majors through.
 *
 * Modes:
 *   node scripts/gate-major.mjs
 *     Scan pending .changeset/*.md for `major` bump types.
 *
 *   node scripts/gate-major.mjs --save-baseline
 *     Same scan + snapshot current publishable package versions to
 *     .changeset/.major-baseline.json (gitignored sidecar for the same job).
 *
 *   node scripts/gate-major.mjs --check-baseline
 *     After `changeset version`, fail if any package major increased
 *     relative to the snapshot (catches hand-edits / pre-exit jumps too).
 *
 *   node scripts/gate-major.mjs --for-publish
 *     Fail if any publishable package sits at major >= 2 without CONFIRM_MAJOR.
 *     Safety net for "No pending changesets — publish current package.json"
 *     and for hand-edited versions that never went through `changeset version`.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const changesetDir = join(root, '.changeset');
const baselinePath = join(changesetDir, '.major-baseline.json');

const args = process.argv.slice(2);
const saveBaseline = args.includes('--save-baseline');
const checkBaseline = args.includes('--check-baseline');
const forPublish = args.includes('--for-publish');

const confirmed = process.env.CONFIRM_MAJOR === '1' || process.env.CONFIRM_MAJOR === 'true';

/** @returns {Array<{file: string, packages: Array<{name: string, type: string}>}>} */
function readPendingChangesets() {
  if (!existsSync(changesetDir)) return [];
  /** @type {Array<{file: string, packages: Array<{name: string, type: string}>}>} */
  const out = [];
  /**
   * Scan one directory of changeset markdown. Must include `.changeset/pre/`:
   * even after `pre.json` is deleted, `changeset version` still consumes those
   * files and would re-raise majors (observed after the accidental-stable reset).
   */
  const scanDir = (dir, label) => {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
    for (const file of files) {
      const raw = readFileSync(join(dir, file), 'utf8');
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) continue;
      /** @type {Array<{name: string, type: string}>} */
      const packages = [];
      for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^['"]?([^'":]+)['"]?\s*:\s*['"]?(major|minor|patch|premajor|preminor|prepatch|prerelease)['"]?\s*$/i);
        if (kv) packages.push({ name: kv[1], type: kv[2].toLowerCase() });
      }
      if (packages.length) out.push({ file: label ? `${label}/${file}` : file, packages });
    }
  };
  scanDir(changesetDir, '');
  scanDir(join(changesetDir, 'pre'), 'pre');
  return out;
}

function isMajorType(type) {
  return type === 'major' || type === 'premajor';
}

function publishablePackageJsons() {
  const pkgsDir = join(root, 'packages');
  const result = [];
  for (const dir of readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pj = join(pkgsDir, dir.name, 'package.json');
    if (!existsSync(pj)) continue;
    const pkg = JSON.parse(readFileSync(pj, 'utf8'));
    if (pkg.private) continue;
    if (!pkg.name || !pkg.version) continue;
    result.push({ name: pkg.name, version: pkg.version, path: pj });
  }
  return result;
}

function majorOf(version) {
  return parseInt(String(version).split('.')[0], 10) || 0;
}

function fail(messages) {
  for (const line of messages) console.error(`::error::${line}`);
  console.error('');
  console.error('Major version bumps require explicit confirmation.');
  console.error('Re-run via workflow_dispatch with confirm_major=true, or set CONFIRM_MAJOR=1 locally.');
  process.exit(1);
}

// ---- scan pending changesets ----
const pending = readPendingChangesets();
const majors = [];
for (const cs of pending) {
  for (const p of cs.packages) {
    if (isMajorType(p.type)) majors.push(`${p.name} (${p.type}) in .changeset/${cs.file}`);
  }
}

if (majors.length > 0 && !confirmed) {
  fail([
    'Pending changesets contain major bumps, but CONFIRM_MAJOR is not set.',
    ...majors.map((m) => `  - ${m}`),
  ]);
}

if (majors.length > 0 && confirmed) {
  console.log('[gate-major] CONFIRM_MAJOR=1 — allowing major bumps:');
  for (const m of majors) console.log(`  - ${m}`);
}

// ---- baseline snapshot / check ----
if (saveBaseline) {
  const snapshot = publishablePackageJsons().map(({ name, version }) => ({ name, version }));
  writeFileSync(baselinePath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`[gate-major] saved baseline (${snapshot.length} packages) → ${baselinePath}`);
}

if (checkBaseline) {
  if (!existsSync(baselinePath)) {
    console.error('[gate-major] no baseline found; run --save-baseline before changeset version');
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const byName = new Map(baseline.map((b) => [b.name, b.version]));
  const jumps = [];
  for (const pkg of publishablePackageJsons()) {
    const prev = byName.get(pkg.name);
    if (!prev) continue;
    const prevM = majorOf(prev);
    const nextM = majorOf(pkg.version);
    if (nextM > prevM) {
      jumps.push(`${pkg.name}: ${prev} → ${pkg.version}`);
    }
  }
  rmSync(baselinePath, { force: true });
  if (jumps.length > 0 && !confirmed) {
    fail([
      'Versioning would raise a package major without confirmation.',
      ...jumps.map((j) => `  - ${j}`),
    ]);
  }
  if (jumps.length > 0 && confirmed) {
    console.log('[gate-major] CONFIRM_MAJOR=1 — allowing major jumps:');
    for (const j of jumps) console.log(`  - ${j}`);
  }
}

// ---- publish-time ceiling: major >= 2 is never automatic ----
if (forPublish) {
  const elevated = publishablePackageJsons()
    .filter((p) => majorOf(p.version) >= 2)
    .map((p) => `${p.name}@${p.version}`);
  if (elevated.length > 0 && !confirmed) {
    fail([
      'Refusing to publish packages at major >= 2 without CONFIRM_MAJOR.',
      ...elevated.map((e) => `  - ${e}`),
    ]);
  }
  if (elevated.length > 0 && confirmed) {
    console.log('[gate-major] CONFIRM_MAJOR=1 — allowing publish at major >= 2:');
    for (const e of elevated) console.log(`  - ${e}`);
  } else {
    console.log('[gate-major] ok — no major >= 2 in publish set');
  }
}

if (majors.length === 0 && !saveBaseline && !checkBaseline && !forPublish) {
  console.log('[gate-major] ok — no pending major changesets');
} else if (majors.length === 0 && checkBaseline) {
  console.log('[gate-major] ok — no unauthorized major jumps');
}
