/**
 * Relocate flat packages/core/src/algebra/*.ts into second-level subdomains.
 *
 * The algebra/ top level carried 93 flat .ts files. This codemod is the
 * mechanical part of docs/design/architecture-debt.md's "core 拆域" work:
 *
 *   node scripts/relocate-core-subdomains.mjs          # dry run (default)
 *   node scripts/relocate-core-subdomains.mjs --apply  # rewrite imports + git mv
 *
 * Algorithm (handles BOTH sides of a move):
 *   For every source file F, compute its NEW location F' (moved or unchanged).
 *   For every relative specifier S in F, resolve it against F's OLD directory
 *   to T, compute T's NEW location T' (moved or unchanged), then rewrite S as
 *   relative(dirname(F'), T'). That covers:
 *     - imports pointing at a moved file  (./check.ts -> ./check/check.ts)
 *     - imports INSIDE a moved file pointing at a stayed file
 *       (./abs.ts -> ../abs.ts)
 *     - imports inside a moved file pointing at another moved file.
 *
 * Only relative specifiers are touched. Package-level specifiers (@nudojs/*)
 * and build entries (tsup.config.ts: src/algebra/exec/index.ts) are unaffected.
 * Re-run `pnpm run lint` + the full test suite afterwards; compare the failure
 * set against the pre-change baseline.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const algebraAbs = join(repoRoot, "packages/core/src/algebra");

/** Target subdomain → flat file basenames (without .ts). */
const GROUPS = {
  check: [
    "check", "check-assign", "check-case-scan", "check-interface-drift",
    "check-may-throw", "check-memo", "check-report", "check-return",
    "check-signatures", "check-types",
  ],
  scan: [
    "scan", "scan-call-graph", "scan-deps", "scan-injected-domain",
    "scan-literal-calls", "scan-named-exports", "scan-top-functions",
  ],
  format: [
    "format", "inlay", "code-text", "codegen-escape", "text-scan",
    "param-surface",
  ],
  interface: [
    "interface", "contract-face", "export-slot", "projection",
    "projection-budget", "slot-visibility", "ts-type-shape", "sidecar-path",
  ],
  diagnostics: [
    "diag-channel", "diag-codes", "diagnostics", "error-names",
    "error-type-abs", "may-throw", "nudo-throw", "leak",
  ],
  key: [
    "abs-key", "generalize-key", "memo-identity", "memo-store", "fn-fp",
    "load-deps-fp", "hash-source", "stable-source-key", "instance-id",
    "symbol-id", "lru-map",
  ],
};

/** old absolute path → new absolute path */
const moves = new Map();
for (const [group, names] of Object.entries(GROUPS)) {
  for (const name of names) {
    const from = join(algebraAbs, `${name}.ts`);
    const to = join(algebraAbs, group, `${name}.ts`);
    moves.set(from, to);
  }
}

const apply = process.argv.includes("--apply");

// Include untracked-but-not-ignored files: a freshly added test that imports
// a moved module would otherwise keep a stale specifier (it is not in
// `git ls-files` yet). Both lists are cwd-relative and may overlap via a Set.
const allFiles = new Set([
  ...execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" }).split("\n"),
  ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).split("\n"),
]);
const tracked = [...allFiles]
  .filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f))
  .filter((f) => !f.includes("/node_modules/") && !f.includes("/dist/"));

const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*)(["'])([^"']+)\2/g;

function relocated(absPath) {
  return moves.get(absPath) ?? absPath;
}

let changedFiles = 0;
let rewritten = 0;

for (const rel of tracked) {
  const fileAbs = join(repoRoot, rel);
  const src = readFileSync(fileAbs, "utf8");
  const fileNew = relocated(fileAbs);
  const oldDir = dirname(fileAbs);
  const newDir = dirname(fileNew);

  let next = src;
  let count = 0;
  next = next.replace(SPEC_RE, (whole, prefix, quote, spec, offset) => {
    if (!spec.startsWith(".")) return whole;
    // Guard: `from "…"` inside a string literal or a // comment is TEXT, not
    // a specifier. A first pass rewrote a test assertion
    // ('from "../../src/helper.js"') and a doc comment example because of
    // this — tsc stayed green, but the test's expected value changed.
    const lineStart = src.lastIndexOf("\n", offset - 1) + 1;
    const before = src.slice(lineStart, offset);
    if (before.includes("//")) return whole;
    const quoteCount = (before.match(/(^|[^\\])['"]/g) ?? []).length;
    if (quoteCount % 2 === 1) return whole;
    let targetOld = resolve(oldDir, spec);
    // source-level imports carry .ts; tolerate extensionless specifiers
    if (!targetOld.endsWith(".ts") && moves.has(`${targetOld}.ts`)) {
      targetOld = `${targetOld}.ts`;
    }
    const targetNew = relocated(targetOld);
    let out = relative(newDir, targetNew).split("\\").join("/");
    if (!out.startsWith(".")) out = `./${out}`;
    if (out === spec) return whole;
    count++;
    return `${prefix}${quote}${out}${quote}`;
  });

  if (count > 0) {
    rewritten += count;
    changedFiles++;
    if (apply) writeFileSync(fileAbs, next, "utf8");
  }
}

console.log(`${apply ? "applied" : "dry run"}: ${tracked.length} files scanned, ${changedFiles} files / ${rewritten} specifiers rewritten`);
console.log(`moves: ${moves.size} files into ${Object.keys(GROUPS).length} subdomains`);
for (const [group, names] of Object.entries(GROUPS)) {
  console.log(`  ${group.padEnd(12)} ${names.length} files`);
}

if (!apply) {
  console.log("re-run with --apply to rewrite imports and git mv the files");
  process.exit(0);
}

for (const [from, to] of moves) {
  mkdirSync(dirname(to), { recursive: true });
  execFileSync("git", ["mv", from, to], { cwd: repoRoot, stdio: "inherit" });
}
console.log(`moved ${moves.size} files; run 'pnpm run lint' and the full suite next`);
