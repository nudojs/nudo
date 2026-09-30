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
 *     Baseline is removed only on success / confirmed runs so a rejected
 *     version keeps its evidence for re-diagnosis.
 *
 *   node scripts/gate-major.mjs --for-publish
 *     Fail if any publishable package sits at major >= 1 without CONFIRM_MAJOR.
 *     Any unconfirmed major elevation (including 0→1) is refused — consistent
 *     with "never auto-publish a major". Safety net for "No pending
 *     changesets — publish current package.json" and for hand-edited versions
 *     that never went through `changeset version`.
 *
 * Test fixtures: GATE_MAJOR_ROOT points at a pseudo-repo root whose
 * packages/<name>/package.json files define the publish set.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAJOR_CEILING = 1;

function repoRoot() {
  return process.env.GATE_MAJOR_ROOT
    ? resolve(process.env.GATE_MAJOR_ROOT)
    : join(dirname(fileURLToPath(import.meta.url)), '..');
}

function changesetDirOf(root) {
  return join(root, '.changeset');
}

function baselinePathOf(root) {
  return join(changesetDirOf(root), '.major-baseline.json');
}

function confirmedFromEnv() {
  return process.env.CONFIRM_MAJOR === '1' || process.env.CONFIRM_MAJOR === 'true';
}

/**
 * @param {string} dir
 * @param {string} label
 * @returns {Array<{file: string, packages: Array<{name: string, type: string}>}>}
 */
function scanChangesetDir(dir, label) {
  if (!existsSync(dir)) return [];
  /** @type {Array<{file: string, packages: Array<{name: string, type: string}>}>} */
  const out = [];
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
  return out;
}

/**
 * Scan one directory of changeset markdown. Must include `.changeset/pre/`:
 * even after `pre.json` is deleted, `changeset version` still consumes those
 * files and would re-raise majors (observed after the accidental-stable reset).
 * @returns {Array<{file: string, packages: Array<{name: string, type: string}>}>}
 */
export function readPendingChangesets(root = repoRoot()) {
  const changesetDir = changesetDirOf(root);
  if (!existsSync(changesetDir)) return [];
  return [
    ...scanChangesetDir(changesetDir, ''),
    ...scanChangesetDir(join(changesetDir, 'pre'), 'pre'),
  ];
}

export function isMajorType(type) {
  return type === 'major' || type === 'premajor';
}

/**
 * @returns {Array<{name: string, version: string, path: string}>}
 */
export function publishablePackageJsons(root = repoRoot()) {
  const pkgsDir = join(root, 'packages');
  const result = [];
  if (!existsSync(pkgsDir)) return result;
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

export function majorOf(version) {
  return parseInt(String(version).split('.')[0], 10) || 0;
}

function fail(messages) {
  for (const line of messages) console.error(`::error::${line}`);
  console.error('');
  console.error('Major version bumps require explicit confirmation.');
  console.error('Re-run via workflow_dispatch with confirm_major=true, or set CONFIRM_MAJOR=1 locally.');
  process.exit(1);
}

/**
 * Major jumps of `packages` relative to a baseline snapshot.
 * @returns {string[]}
 */
export function majorJumps(packages, baseline) {
  const byName = new Map(baseline.map((b) => [b.name, b.version]));
  const jumps = [];
  for (const pkg of packages) {
    const prev = byName.get(pkg.name);
    if (!prev) continue;
    const prevM = majorOf(prev);
    const nextM = majorOf(pkg.version);
    if (nextM > prevM) {
      jumps.push(`${pkg.name}: ${prev} → ${pkg.version}`);
    }
  }
  return jumps;
}

/**
 * Publish-time ceiling: any package at major >= MAJOR_CEILING (1) is an
 * unconfirmed major elevation (including the 0→1 class) and must not auto-publish.
 * @returns {string[]}
 */
export function elevatedForPublish(packages) {
  return packages
    .filter((p) => majorOf(p.version) >= MAJOR_CEILING)
    .map((p) => `${p.name}@${p.version}`);
}

function main() {
  const root = repoRoot();
  const changesetDir = changesetDirOf(root);
  const baselinePath = baselinePathOf(root);

  const args = process.argv.slice(2);
  const saveBaseline = args.includes('--save-baseline');
  const checkBaseline = args.includes('--check-baseline');
  const forPublish = args.includes('--for-publish');

  const confirmed = confirmedFromEnv();

  // ---- scan pending changesets ----
  const pending = readPendingChangesets(root);
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
    const snapshot = publishablePackageJsons(root).map(({ name, version }) => ({ name, version }));
    writeFileSync(baselinePath, JSON.stringify(snapshot, null, 2) + '\n');
    console.log(`[gate-major] saved baseline (${snapshot.length} packages) → ${baselinePath}`);
  }

  if (checkBaseline) {
    if (!existsSync(baselinePath)) {
      console.error('[gate-major] no baseline found; run --save-baseline before changeset version');
      process.exit(1);
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const jumps = majorJumps(publishablePackageJsons(root), baseline);
    if (jumps.length > 0 && !confirmed) {
      // Keep the baseline: it is the evidence of what rose. Re-running
      // --check-baseline must still see the jumps instead of "no baseline".
      fail([
        'Versioning would raise a package major without confirmation.',
        ...jumps.map((j) => `  - ${j}`),
      ]);
    }
    // Success or confirmed — the snapshot has served its purpose.
    rmSync(baselinePath, { force: true });
    if (jumps.length > 0 && confirmed) {
      console.log('[gate-major] CONFIRM_MAJOR=1 — allowing major jumps:');
      for (const j of jumps) console.log(`  - ${j}`);
    }
  }

  // ---- publish-time ceiling: major >= 1 is never automatic ----
  // Any unconfirmed major elevation (including 0→1) is refused, matching
  // "never auto-publish a major". Previously the ceiling was major >= 2,
  // which silently let a hand-edited 0.x → 1.0.0 publish with zero confirmation.
  if (forPublish) {
    const elevated = elevatedForPublish(publishablePackageJsons(root));
    if (elevated.length > 0 && !confirmed) {
      fail([
        `Refusing to publish packages at major >= ${MAJOR_CEILING} without CONFIRM_MAJOR.`,
        ...elevated.map((e) => `  - ${e}`),
      ]);
    }
    if (elevated.length > 0 && confirmed) {
      console.log(`[gate-major] CONFIRM_MAJOR=1 — allowing publish at major >= ${MAJOR_CEILING}:`);
      for (const e of elevated) console.log(`  - ${e}`);
    } else {
      console.log(`[gate-major] ok — no major >= ${MAJOR_CEILING} in publish set`);
    }
  }

  if (majors.length === 0 && !saveBaseline && !checkBaseline && !forPublish) {
    console.log('[gate-major] ok — no pending major changesets');
  } else if (majors.length === 0 && checkBaseline) {
    console.log('[gate-major] ok — no unauthorized major jumps');
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
