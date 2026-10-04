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
 *     Baseline is kept after success / confirmed runs: it is the same-train
 *     evidence consumed by --for-publish later in the same job (the next
 *     ci:version --save-baseline overwrites it, so it never goes stale);
 *     a rejected version also keeps its evidence for re-diagnosis.
 *
 *   node scripts/gate-major.mjs --for-publish
 *     Fail if the publish set contains an unconfirmed major elevation:
 *     - major >= MAJOR_CEILING (2): NEVER auto-publish — entering the line,
 *       riding it (2.0.1 patch included), or any unpublished 2.x+ version
 *       requires CONFIRM_MAJOR
 *     - major jump vs .changeset/.major-baseline.json (0→1 / 1→2 / …)
 *     - exact 1.0.0 with no baseline row: first-major candidate (0→1 shape)
 *     Single exemption: a 2.x+ version that already has its release git tag
 *     (`<name>@<version>`, created by a previous publish). Re-attempting it is
 *     a no-op — "No pending changesets — publish current package.json" pushes
 *     stay green on a train that legitimately reached 2.x, while every
 *     UNPUBLISHED major version stays fail-closed.
 *     Safety net for "No pending changesets — publish current package.json"
 *     and for hand-edited versions that never went through `changeset version`.
 *
 * Test fixtures: GATE_MAJOR_ROOT points at a pseudo-repo root whose
 * packages/<name>/package.json files define the publish set.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Publish ceiling: major >= 2 is NEVER auto-published (any unpublished 2.x+ version needs CONFIRM_MAJOR). Only already-tagged (previously published) versions are exempt as no-ops. */
export const MAJOR_CEILING = 2;

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

/**
 * 该版本是否已有发布 tag（`<name>@<version>`，changesets publish 成功时打）。
 * 用于 --for-publish 的 no-op 豁免：tag 在 = 该版本曾成功发布过，本次 publish
 * 集里只是重复（no-op）——不需要 CONFIRM_MAJOR。任何**未发布过**的 major
 * 版本一律拦截。非 git 目录（测试 fixture 未 init）→ 无 tag → 严格拦截。
 */
function alreadyReleased(root, name, version) {
  const tag = `${name}@${version}`;
  try {
    const out = execFileSync('git', ['-C', root, 'tag', '-l', tag], { encoding: 'utf8' });
    return out.trim() === tag;
  } catch {
    return false;
  }
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
 * Publish-time gate: packages that must not auto-publish without CONFIRM_MAJOR.
 *
 * Flags:
 * - major >= MAJOR_CEILING (2): absolute — no unpublished 2.x+ version is ever
 *   automatic (entering the line, riding it, hand-edit; all the same)
 * - major jump vs baseline (0→1 / 1→2 / …) — entering a major line, whether via
 *   `changeset version` in-run or a hand-edit (baseline is snapshotted by
 *   --save-baseline before `changeset version` runs, so in-run jumps are visible)
 * - exact `1.0.0` with no baseline row — first-major candidate (0→1 shape)
 *
 * Does NOT flag same-major 1.x train versions (1.0.1, 1.3.0, …): those are
 * already published as major=1 and must keep auto-publishing.
 *
 * The 2.x ceiling's only exemption — already-released versions (tagged by a
 * previous publish, a no-op re-attempt) — is applied by the caller
 * (--for-publish main block), which has the repo root for the git tag lookup.
 *
 * @param {Array<{name: string, version: string}>} packages
 * @param {Array<{name: string, version: string}>} [baseline]
 * @returns {string[]}
 */
export function elevatedForPublish(packages, baseline = []) {
  const byName = new Map(baseline.map((b) => [b.name, b.version]));
  const out = [];
  for (const p of packages) {
    const maj = majorOf(p.version);
    if (maj >= MAJOR_CEILING) {
      out.push(`${p.name}@${p.version}`);
      continue;
    }
    const prev = byName.get(p.name);
    if (prev !== undefined) {
      if (majorOf(prev) < maj) out.push(`${p.name}@${p.version}`);
      continue;
    }
    // No baseline row: refuse the classic hand-edit shape `1.0.0` (first major).
    // 1.0.1+ is already on the 1.x train and may auto-publish.
    if (p.version === '1.0.0') out.push(`${p.name}@${p.version}`);
  }
  return out;
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
    // 成功/确认后**保留** baseline：它随后还要喂同一 job 的 --for-publish
    // （jump 证据）。下一次 ci:version 的 --save-baseline 会整体覆盖，不会陈旧。
    if (jumps.length > 0 && confirmed) {
      console.log('[gate-major] CONFIRM_MAJOR=1 — allowing major jumps:');
      for (const j of jumps) console.log(`  - ${j}`);
    }
  }

  // ---- publish-time gate: major jumps + 2.x ceiling + first-major 1.0.0 ----
  // 1.x train (1.0.1+) is NOT gated: packages already at major=1 must auto-publish.
  // Baseline (kept by a failed --check-baseline) is the jump evidence for 0→1.
  // 2.x+ ceiling's only exemption: already-released versions (release git tag
  // exists → this publish attempt is a no-op re-attempt).
  if (forPublish) {
    /** @type {Array<{name: string, version: string}>} */
    let baseline = [];
    if (existsSync(baselinePath)) {
      try {
        baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
      } catch {
        baseline = [];
      }
    }
    const pkgs = publishablePackageJsons(root);
    // elevatedForPublish 返回 `name@version` 字符串；no-op 豁免按包查 tag 后再投影回字符串
    const flagged = new Set(elevatedForPublish(pkgs, baseline));
    const elevated = pkgs
      .filter((p) => flagged.has(`${p.name}@${p.version}`))
      .filter((p) => !alreadyReleased(root, p.name, p.version))
      .map((p) => `${p.name}@${p.version}`);
    if (elevated.length > 0 && !confirmed) {
      fail([
        'Refusing to publish unconfirmed major elevations (unpublished 2.x+, major jumps, first 1.0.0).',
        ...elevated.map((e) => `  - ${e}`),
      ]);
    }
    if (elevated.length > 0 && confirmed) {
      console.log('[gate-major] CONFIRM_MAJOR=1 — allowing major elevations:');
      for (const e of elevated) console.log(`  - ${e}`);
    } else {
      console.log('[gate-major] ok — no unconfirmed major elevations in publish set');
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
