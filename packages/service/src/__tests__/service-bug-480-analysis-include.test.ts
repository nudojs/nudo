/**
 * Bug 480 回归钉：`nudo.analysis.include` 的白名单判定。
 *
 * 改前：include 走 matchesEmitAllowlist —— 无通配符的字面量被编译成锚定
 * 全等正则 `^literal$`（相对项目根），`include: ["src"]` 对 `src/a.js`
 * **永不命中** → 整张白名单静默作废（该文件整份不被分析，假绿）。
 *
 * 本次定的语义（写在 analysis-scope.includeHit 的注释里）：
 * - 字面量 = **路径形态**（这个文件 / 这个目录），不是子串搜索：
 *   `src` 命中 `src/**`，不命中 `src-other/c.js`。
 * - 通配符 = 锚定 glob（`**` 跨段、`*`/`?` 不跨 `/`），与 exclude 同编译器。
 *
 * 负控制：exclude 的字面量**子串**语义不得被本次改动波及；include 为空
 * 时不过滤。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { shouldAnalyzeFile } from "../analysis-scope.ts";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

function project(include: string[] | undefined, exclude?: string[]): string {
  const analysis: Record<string, unknown> = { mode: "all" };
  if (include) analysis.include = include;
  if (exclude) analysis.exclude = exclude;
  return makeTmpProject("nudo-scope-480-", {
    "package.json": JSON.stringify({ name: "fx", nudo: { analysis } }),
  });
}

function fileIn(dir: string, rel: string): string {
  const file = join(dir, ...rel.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "export function f(x) {\n  return x;\n}\n");
  return file;
}

const SRC = "export function f(x) {\n  return x;\n}\n";

describe("Bug 480 — nudo.analysis.include 的字面量要能命中（路径形态，非子串）", () => {
  it("include: [\"src\"] 命中 src 下的文件（改前：永不命中 → 白名单作废）", () => {
    const dir = project(["src"]);
    const hit = fileIn(dir, "src/a.js");
    const nested = fileIn(dir, "src/nested/b.js");
    expect(shouldAnalyzeFile(hit, SRC)).toBe(true);
    expect(shouldAnalyzeFile(nested, SRC)).toBe(true);
  });

  it("include: [\"src\"] 不命中 src-other / lib（字面量不是子串搜索）", () => {
    const dir = project(["src"]);
    const sibling = fileIn(dir, "src-other/c.js");
    const other = fileIn(dir, "lib/d.js");
    expect(shouldAnalyzeFile(sibling, SRC)).toBe(false);
    expect(shouldAnalyzeFile(other, SRC)).toBe(false);
  });

  it("include: [\"src/a.js\"] 只命中这一个文件", () => {
    const dir = project(["src/a.js"]);
    const exact = fileIn(dir, "src/a.js");
    const sibling = fileIn(dir, "src/b.js");
    expect(shouldAnalyzeFile(exact, SRC)).toBe(true);
    expect(shouldAnalyzeFile(sibling, SRC)).toBe(false);
  });

  it("include: [\"src/**\"] 命中整个子树，不命中 lib", () => {
    const dir = project(["src/**"]);
    const nested = fileIn(dir, "src/nested/b.js");
    const other = fileIn(dir, "lib/d.js");
    expect(shouldAnalyzeFile(nested, SRC)).toBe(true);
    expect(shouldAnalyzeFile(other, SRC)).toBe(false);
  });

  it("include: [\"src/*.js\"] 不跨 /（段内通配）", () => {
    const dir = project(["src/*.js"]);
    const top = fileIn(dir, "src/a.js");
    const nested = fileIn(dir, "src/nested/b.js");
    expect(shouldAnalyzeFile(top, SRC)).toBe(true);
    expect(shouldAnalyzeFile(nested, SRC)).toBe(false);
  });

  it("include: [\"**/*.js\"] 命中任意目录的 .js", () => {
    const dir = project(["**/*.js"]);
    const other = fileIn(dir, "lib/d.js");
    expect(shouldAnalyzeFile(other, SRC)).toBe(true);
  });

  it("include 多条：任一命中即纳入", () => {
    const dir = project(["lib", "src/a.js"]);
    const inLib = fileIn(dir, "lib/d.js");
    const exact = fileIn(dir, "src/a.js");
    const miss = fileIn(dir, "src/b.js");
    expect(shouldAnalyzeFile(inLib, SRC)).toBe(true);
    expect(shouldAnalyzeFile(exact, SRC)).toBe(true);
    expect(shouldAnalyzeFile(miss, SRC)).toBe(false);
  });

  it("负控制：include 为空 → 不过滤（mode=all 全纳入）", () => {
    const dir = project(undefined);
    const any = fileIn(dir, "lib/d.js");
    expect(shouldAnalyzeFile(any, SRC)).toBe(true);
  });

  it("负控制：exclude 的字面量子串语义不变（src/vendored 命中子树）", () => {
    const dir = project(undefined, ["src/vendored"]);
    const vendored = fileIn(dir, "src/vendored/lib.js");
    const keep = fileIn(dir, "src/lib.js");
    expect(shouldAnalyzeFile(vendored, SRC)).toBe(false);
    expect(shouldAnalyzeFile(keep, SRC)).toBe(true);
  });
});
