/**
 * Static hygiene gate. This repo deliberately has no ESLint / Prettier
 * (CONTRIBUTING.md "No ESLint / no Prettier — type-check only"), so the few
 * rules a type-checker cannot see are enforced here instead of by reviewers.
 *
 *   node scripts/check-hygiene.mjs
 *
 * Hard failures:
 *   1. Empty catch (real CatchClause, no statements AND no comment) in
 *      production sources. Parsed with @babel/parser — a regex would flag the
 *      many `try{}catch(e){}` snippets held as *strings* in test corpora.
 *   2. Re-implemented test harness: a local `tmpProject` that also inlines
 *      `mkdtempSync`. Thin adapters around the shared helper are allowed.
 *   3. `console.log` in non-CLI production sources (CLI output belongs to
 *      packages/nudojs; libraries use console.error/warn or the diagnostic
 *      channel).
 *
 * Scope: git-tracked .ts under packages/ (dist / node_modules excluded).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const files = execFileSync("git", ["ls-files", "packages"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .filter((f) => !f.includes("/node_modules/") && !f.includes("/dist/"))
  // git ls-files 仍列出未提交的删除；本地跑 gate 时跳过它们
  .filter((f) => existsSync(join(repoRoot, f)));

const problems = [];

/** Minimal recursive AST walk (Babel nodes only, no comment subtrees). */
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "leadingComments" ||
      key === "innerComments" ||
      key === "trailingComments" ||
      key === "tokens" ||
      key === "comments"
    ) {
      continue;
    }
    walk(value, visit);
  }
}

for (const rel of files) {
  const src = readFileSync(join(repoRoot, rel), "utf8");
  const isTestSurface =
    rel.includes("/__tests__/") || rel.endsWith(".test.ts") || rel.endsWith(".spec.ts");

  // 1. real empty catch in production sources
  if (!isTestSurface) {
    let ast;
    try {
      ast = parse(src, {
        sourceType: "module",
        errorRecovery: true,
        plugins: ["typescript", "jsx"],
      });
    } catch {
      // Non-parseable source is the type-checker's job, not this gate's.
      ast = null;
    }
    if (ast) {
      walk(ast, (node) => {
        if (node.type !== "CatchClause") return;
        const body = node.body;
        const slice = src.slice(body.start, body.end);
        if (body.body.length === 0 && !/\/\/|\/\*/.test(slice)) {
          const line = src.slice(0, node.start).split("\n").length;
          problems.push(
            `${rel}:${line} empty catch without explanation — handle the error or document why it is intentionally ignored`,
          );
        }
      });
    }
  }

  // 2. inline harness re-implementation (the shared helper files are exempt)
  const isSharedHelper = rel.endsWith("/tmp-project.ts");
  if (
    !isSharedHelper &&
    /function\s+tmpProject\b/.test(src) &&
    /\bmkdtempSync\s*\(/.test(src)
  ) {
    const line = src.slice(0, src.search(/function\s+tmpProject\b/)).split("\n").length;
    problems.push(
      `${rel}:${line} inlines tmpProject — import the package's shared __tests__/tmp-project.ts (or helpers/tmp-project.ts)`,
    );
  }

  // 3. console.log in non-CLI production sources
  if (!isTestSurface && !rel.startsWith("packages/nudojs/")) {
    for (const m of src.matchAll(/\bconsole\.log\s*\(/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      problems.push(
        `${rel}:${line} console.log in production source — use console.error/warn or the diagnostic channel`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`Hygiene gate FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `ok: hygiene clean across ${files.length} tracked .ts files (empty catch / inline harness / console.log)`,
);
