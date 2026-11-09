/**
 * Static gate: a test that reads docs/, packages/website/, benchmark/, or
 * .github/workflows/ through `fs` must be listed in scripts/fs-input-tests.mjs.
 *
 * The module graph cannot see `readFileSync` paths, and Vitest's
 * `forceRerunTriggers` is global (a match reruns every spec). CI compensates by
 * unconditionally running the fs-input suite; this gate keeps the manifest in
 * sync when a new reader appears.
 *
 * Scope: git-tracked *.test.ts / *.part.ts under packages/. Comments are
 * ignored (AST, not grep). Root `scripts/` exec/import reads are not
 * statically resolvable and remain a manual review item.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { isFsInputTest } from "./fs-input-tests.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FS_READ_CALLS = new Set([
  "readFile",
  "readFileSync",
  "readdir",
  "readdirSync",
  "existsSync",
  "statSync",
]);
const REPO_INPUTS = [
  /docs\/(?:examples|design|reports)\//,
  /packages\/website\//,
  /(?:^|\/)benchmark\//,
  /(?:^|\/)\.github\/workflows\//,
];

const files = [
  ...execFileSync("git", ["ls-files", "packages"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).split("\n"),
  ...execFileSync("git", ["ls-files", "--others", "--exclude-standard", "packages"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).split("\n"),
]
  .filter((f) => f.endsWith(".test.ts") || f.endsWith(".part.ts"))
  .filter((f) => existsSync(join(repoRoot, f)));

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
      key === "comments"
    ) {
      continue;
    }
    walk(value, visit);
  }
}

function stringLiterals(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) stringLiterals(child, out);
    return out;
  }
  if (node.type === "StringLiteral") out.push(node.value);
  if (node.type === "TemplateElement") out.push(node.value.cooked ?? node.value.raw);
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "leadingComments" ||
      key === "innerComments" ||
      key === "trailingComments" ||
      key === "comments"
    ) {
      continue;
    }
    stringLiterals(value, out);
  }
  return out;
}

const problems = [];
for (const rel of files) {
  if (isFsInputTest(rel)) continue;
  const src = readFileSync(join(repoRoot, rel), "utf8");
  let ast;
  try {
    ast = parse(src, {
      sourceType: "module",
      errorRecovery: true,
      plugins: ["typescript", "jsx"],
    });
  } catch {
    continue; // unparseable test files are tsc/vitest's problem
  }
  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee;
    const name =
      callee.type === "Identifier"
        ? callee.name
        : callee.type === "MemberExpression" && callee.property.type === "Identifier"
          ? callee.property.name
          : undefined;
    if (!FS_READ_CALLS.has(name)) return;
    const hit = stringLiterals(node.arguments[0]).find((value) =>
      REPO_INPUTS.some((re) => re.test(value)),
    );
    if (hit) problems.push(`${rel}: reads ${hit}`);
  });
}

if (problems.length > 0) {
  console.error("fs-input tests missing from scripts/fs-input-tests.mjs:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`fs-input gate ok (${files.length} test files scanned)`);
