/**
 * Collapse per-bug vitest entry points into one entry per (directory, family).
 *
 *   node scripts/aggregate-tests.mjs                 # dry run
 *   node scripts/aggregate-tests.mjs --apply        # all eligible groups
 *   node scripts/aggregate-tests.mjs --apply --only <group-key>
 *   node scripts/aggregate-tests.mjs --revert       # undo every aggregation
 *   node scripts/aggregate-tests.mjs --revert-only <group-key>  # undo ONE group
 *
 * Why this shape (zero semantic change):
 *   Each original `foo.test.ts` is renamed IN PLACE to `foo.part.ts` and the
 *   generated `zz-agg-<family>.test.ts` only imports it. Every part stays a
 *   separate ES module (its own scope, mocks, import.meta.url / dirname), and
 *   no directory moves happen, so fixtures and path-dependent helpers keep
 *   resolving identically. Vitest now collects 1 file instead of N, which is
 *   the actual CI scheduling cost (2151 entries -> ~25 families).
 *
 * Guards — a file is NEVER aggregated when:
 *   - it is path-sensitive (import.meta.url / fileURLToPath / __dirname)
 *   - it is a precision gate (gold / real-package / public-api)
 *   - a matching __snapshots__/*.snap exists (snapshot names follow the test
 *     filename, so renaming would orphan them)
 *   - it registers a module-level `vi.mock` / `vi.hoisted` (worker-scoped
 *     registration: in a shared aggregate entry the mock from one part leaks
 *     into every other part's imports — root cause of most of the 15 historical
 *     new failures; keep those files as standalone entries)
 *   - its family has fewer than MIN_GROUP files.
 *
 * After --apply update tsconfig.test-lint.json (it must include *.part.ts) and
 * run the full suite, comparing the failure set to the pre-change baseline.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_GROUP = 3;
const AGG_PREFIX = "zz-agg-";
const PART_SUFFIX = ".part.ts";

const apply = process.argv.includes("--apply");
const revert = process.argv.includes("--revert");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined;
const revertOnlyIdx = process.argv.indexOf("--revert-only");
const revertOnly = revertOnlyIdx >= 0 ? process.argv[revertOnlyIdx + 1] : undefined;

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function trackedFiles() {
  return new Set([
    ...git(["ls-files"]).split("\n"),
    ...git(["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ]);
}

if (revertOnly) {
  // 单族回退（`--revert` 是全局的，会抹掉全部已启用族 —— CONTRIBUTING 的
  // 已知坑）。key = "<dir>/<family>"；只动该 dir 下 `<family>-bug-*.part.ts`
  // 与该族的 zz-agg 入口，其余族逐字不动。
  const slash = revertOnly.lastIndexOf("/");
  if (slash < 0) {
    console.error("--revert-only needs a full key like packages/vscode/src/__tests__/lsp");
    process.exit(2);
  }
  const dir = revertOnly.slice(0, slash);
  const family = revertOnly.slice(slash + 1);
  const parts = [...trackedFiles()].filter(
    (f) =>
      dirname(f) === dir &&
      basename(f).startsWith(`${family}-bug-`) &&
      f.endsWith(PART_SUFFIX),
  );
  let restored = 0;
  for (const rel of parts) {
    const back = rel.slice(0, -PART_SUFFIX.length) + ".test.ts";
    if (existsSync(join(repoRoot, back))) {
      console.error(`revert conflict: ${back} already exists — skipping ${rel}`);
      continue;
    }
    git(["mv", rel, back]);
    restored++;
  }
  const aggAbs = join(repoRoot, `${dir}/${AGG_PREFIX}${family}.test.ts`);
  const removed = existsSync(aggAbs) ? (unlinkSync(aggAbs), 1) : 0;
  console.log(`reverted group ${revertOnly}: ${restored} parts restored, ${removed} entry removed`);
  process.exit(0);
}

if (revert) {
  let removed = 0;
  let restored = 0;
  for (const rel of trackedFiles()) {
    if (!rel.endsWith(PART_SUFFIX) && !basename(rel).startsWith(AGG_PREFIX)) continue;
    const abs = join(repoRoot, rel);
    if (basename(rel).startsWith(AGG_PREFIX)) {
      unlinkSync(abs);
      removed++;
    } else {
      const back = rel.slice(0, -PART_SUFFIX.length) + ".test.ts";
      if (existsSync(join(repoRoot, back))) {
        console.error(`revert conflict: ${back} already exists — skipping ${rel}`);
        continue;
      }
      git(["mv", rel, back]);
      restored++;
    }
  }
  console.log(`reverted: ${removed} aggregate entries removed, ${restored} parts restored`);
  process.exit(0);
}

const snapshots = [...trackedFiles()].filter((f) => f.includes("__snapshots__/"));
const bugFiles = [...trackedFiles()].filter(
  (f) => /bug-\d+.*\.test\.ts$/.test(f) && !f.includes("/node_modules/"),
);

const groups = new Map();
let guarded = 0;

for (const rel of bugFiles) {
  const abs = join(repoRoot, rel);
  const dir = dirname(rel);
  const name = basename(rel);
  const src = readFileSync(abs, "utf8");
  const pathSensitive = /import\.meta\.url|fileURLToPath|__dirname/.test(src);
  const isGate = /gold|real-package|public-api/i.test(name);
  const hasSnapshot = snapshots.some((s) => s.includes(`${name}.snap`));
  // 模块级 mock 是 worker 级注册 ⇒ 同入口内会串到别的 part。只认顶格调用，
  // 不误伤 describe 内部的局部 spy（缩进形式）。
  const moduleMock = /^vi\.(mock|hoisted)\(/m.test(src);
  if (pathSensitive || isGate || hasSnapshot || moduleMock) {
    guarded++;
    continue;
  }
  const m = /^([a-z]+)-bug-/.exec(name);
  const family = m ? m[1] : "misc";
  const key = `${dir}/${family}`;
  if (!groups.has(key)) groups.set(key, { dir, family, files: [] });
  groups.get(key).files.push(rel);
}

const eligible = [...groups.entries()]
  .filter(([, g]) => g.files.length >= MIN_GROUP)
  .filter(([key]) => !only || key === only)
  .sort(([a], [b]) => a.localeCompare(b));

const totalParts = eligible.reduce((n, [, g]) => n + g.files.length, 0);
console.log(
  `${apply ? "applied" : "dry run"}: ${bugFiles.length} bug files, ${guarded} guarded, ` +
    `${eligible.length} groups / ${totalParts} parts`,
);
for (const [key, g] of eligible.slice(0, 30)) {
  console.log(`  ${String(g.files.length).padStart(4)}  ${key}`);
}
if (eligible.length > 30) console.log(`  ... ${eligible.length - 30} more groups`);

if (!apply) {
  console.log("re-run with --apply (optionally --only <group-key>) to apply");
  process.exit(0);
}

let written = 0;
for (const [, g] of eligible) {
  const aggRel = `${g.dir}/${AGG_PREFIX}${g.family}.test.ts`;
  const parts = g.files.map((f) => `./${basename(f).replace(/\.test\.ts$/, PART_SUFFIX)}`);
  const body = [
    "// GENERATED by scripts/aggregate-tests.mjs — do not edit by hand.",
    "// One vitest entry per (directory, family). Each part remains a separate",
    "// ES module; renaming is IN PLACE so import.meta.url / fixtures / mocks",
    "// are unchanged. Run one case with: pnpm vitest run <this file> -t <name>",
    ...parts.map((p) => `import "${p}";`),
    "",
  ].join("\n");
  for (const rel of g.files) {
    const partRel = rel.replace(/\.test\.ts$/, PART_SUFFIX);
    if (existsSync(join(repoRoot, partRel))) {
      throw new Error(`part already exists: ${partRel}`);
    }
    git(["mv", rel, partRel]);
  }
  writeFileSync(join(repoRoot, aggRel), body, "utf8");
  written++;
}
console.log(`wrote ${written} aggregate entries; ${totalParts} files renamed to .part.ts`);
