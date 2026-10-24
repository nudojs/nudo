/**
 * Bug 1062 / 1063 —— 指令诊断的**码归因**与**文案贯通**（族 47 · 片 S13）。
 *
 * 背景：片 S6 修好了两条指令的**本体**（`@nudo:replace` 目标未命中 ⇒ 显式诊断；
 * `@nudo:mock-module` 重复声明 ⇒ 显式诊断 + 导出名并集），但**码**在
 * `nudo test` / `health` 面上**丢了**：`analyzer-orchestrate-uncached-modules.ts`
 * 把 `composed.mockErrors`（**只有 message**）映射成固定码 `nudo:module-missing`
 * ⇒ 「重复声明」被说成「模块缺失」（归因错误：码与文案不自洽）。
 *
 * 本钉锁四件事：
 * 1. **码归因**：分析器面（= `nudo test` / `health` 面的诊断源）上，重复声明的
 *    码是 `nudo:mock-invalid`（**不是** `nudo:module-missing`），文案自明
 *    （点名重复声明 + 两条 fromPath）。
 * 2. **既有码不被误改**：「mock 文件缺失」仍然是 `nudo:module-missing`（error）
 *    ⇒ 不许把别的错误也改成 mock-invalid。
 * 3. **suggestion 文案**：重复声明 ⇒ 提示「只保留一条声明」；导出名缺失 ⇒ 点名
 *    那个缺失的导出（原先两族都落到通用句 ⇒ 提示与事实不符）。
 * 4. **body-read**：`param.trimLeft()` ⇒ `param: string()`（与 `trimStart` 同口径）；
 *    `param.includes(...)` **仍推不出**（该表刻意排除 Array 同名方法 ⇒ 负控）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { analyzeFileAsync } from "../analyzer.ts";
import type { Diagnostic } from "../analyzer-types.ts";
import { collectCheckSupplementIssues } from "../check-issues.ts";
import { collectParamBodyReadTypes } from "../emit/body-read-types.ts";
import { tmpProject, writeTmpFile } from "./tmp-project.ts";

// ── 夹具 ─────────────────────────────────────────────────────────────────────

let dir: string;

beforeEach(() => {
  dir = tmpProject("nudo-bug-1062-1063-attr-");
  writeTmpFile(dir, "mock-fs.js", `export const readFile = (p) => "mock1:" + p;\n`);
  writeTmpFile(dir, "mock-fs3.js", `export const writeFile = (p, d) => "w:" + p;\n`);
});

/** ② 同一模块声明两次（重复声明族）。 */
const DUP_SRC = `/// @nudo:mock-module "fs" from "./mock-fs.js"
/// @nudo:mock-module "fs" from "./mock-fs3.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** ① 单条声明（零重复诊断的负控）。 */
const SINGLE_SRC = `/// @nudo:mock-module "fs" from "./mock-fs.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** ③ mock 文件缺失（既有码 `nudo:module-missing` 不得被误改）。 */
const MISSING_FILE_SRC = `/// @nudo:mock-module "fs" from "./no-such-mock.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** ④ mock 文件在、但没导出被点名的那个名字（点名缺失族）。 */
const MISSING_EXPORT_SRC = `/// @nudo:mock-module "fs" { readFile, writeFile } from "./mock-fs.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** 分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。 */
function dupDiags(diags: Diagnostic[]): Diagnostic[] {
  return diags.filter((d) => d.message.includes("Duplicate @nudo:mock-module"));
}

// ── 1. 码归因（分析器面 = `nudo test` / `health` 面的诊断源）───────────────────

describe("码归因 — 重复声明的诊断码是 nudo:mock-invalid（不是 nudo:module-missing）", () => {
  it("② 重复声明 ⇒ 分析器诊断的码是 nudo:mock-invalid", async () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", DUP_SRC);
    const r = await analyzeFileAsync(file, DUP_SRC);
    const dups = dupDiags(r.diagnostics);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.code).toBe("nudo:mock-invalid");
    // 文案自明：点名是重复声明 + 两条来源
    expect(dups[0]!.message).toContain("./mock-fs.js");
    expect(dups[0]!.message).toContain("./mock-fs3.js");
    expect(dups[0]!.message).toContain('"fs"');
  });

  it("② 重复声明 ⇒ 该诊断**不得**再被说成 nudo:module-missing", async () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", DUP_SRC);
    const r = await analyzeFileAsync(file, DUP_SRC);
    // 改前：这条诊断的码恒为 nudo:module-missing（归因错误）
    const misattributed = r.diagnostics.filter(
      (d) => d.code === "nudo:module-missing" && d.message.includes("Duplicate @nudo:mock-module"),
    );
    expect(misattributed).toEqual([]);
  });

  it("② 重复声明 ⇒ warning 级（同码同级：mock-invalid = 指令写法有歧义）", async () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", DUP_SRC);
    const r = await analyzeFileAsync(file, DUP_SRC);
    const dups = dupDiags(r.diagnostics);
    expect(dups[0]!.severity).toBe("warning");
  });

  it("① 单条声明 ⇒ 零该诊断（不许误报）", async () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", SINGLE_SRC);
    const r = await analyzeFileAsync(file, SINGLE_SRC);
    expect(dupDiags(r.diagnostics)).toEqual([]);
  });
});

// ── 2. 既有码不被误改 ────────────────────────────────────────────────────────

describe("既有码不被误改 — mock 文件缺失仍然是 nudo:module-missing", () => {
  it("③ mock 文件缺失 ⇒ nudo:module-missing + error", async () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", MISSING_FILE_SRC);
    const r = await analyzeFileAsync(file, MISSING_FILE_SRC);
    const missing = r.diagnostics.filter((d) => d.code === "nudo:module-missing");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]!.severity).toBe("error");
    // 该族**不得**被改成 mock-invalid
    expect(r.diagnostics.filter((d) => d.code === "nudo:mock-invalid")).toEqual([]);
  });

  it("③ 门禁面（check 补充通道）同口径：nudo:module-missing + error", () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", MISSING_FILE_SRC);
    const issues = collectCheckSupplementIssues(file, MISSING_FILE_SRC);
    const missing = issues.filter((i) => i.code === "nudo:module-missing");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]!.severity).toBe("error");
  });
});

// ── 3. suggestion 文案（按错误种类分族）──────────────────────────────────────

describe("suggestion 文案 — 按错误的**具体种类**给贴切提示", () => {
  it("重复声明 ⇒ 提示「只保留一条声明」（不是通用表达式句）", () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", DUP_SRC);
    const issues = collectCheckSupplementIssues(file, DUP_SRC);
    const dups = issues.filter((i) => i.code === "nudo:mock-invalid");
    expect(dups).toHaveLength(1);
    const s = dups[0]!.suggestion ?? "";
    expect(s.toLowerCase()).toContain("duplicate");
    expect(s.toLowerCase()).toContain("keep only one");
    // 旧通用句（对重复声明不贴切）不得再出现
    expect(s).not.toContain("@nudo:mock expression");
  });

  it("导出名缺失 ⇒ 提示点名那个缺失的导出", () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", MISSING_EXPORT_SRC);
    const issues = collectCheckSupplementIssues(file, MISSING_EXPORT_SRC);
    const missing = issues.filter((i) => i.code === "nudo:module-missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain('does not export "writeFile"');
    const s = missing[0]!.suggestion ?? "";
    expect(s).toContain("writeFile");
    // 旧通用句（说「建 mock 文件」⇒ 与事实不符：文件在，只是没导出它）
    expect(s).not.toContain("Create the mock file");
  });

  it("mock 文件缺失 ⇒ 仍是「建 mock 文件 / 改路径」那句（既有文案逐字保留）", () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", MISSING_FILE_SRC);
    const issues = collectCheckSupplementIssues(file, MISSING_FILE_SRC);
    const missing = issues.filter((i) => i.code === "nudo:module-missing");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]!.suggestion).toContain("Create the mock file or fix the path");
  });
});

// ── 4. body-read：trimLeft / trimRight 与 trimStart 同口径 ───────────────────

describe("body-read — trimLeft / trimRight 是 string 证据（与 trimStart 同口径）", () => {
  it("param.trimLeft() ⇒ param: string()", () => {
    const map = collectParamBodyReadTypes(`
export function f(o) {
  return o.label.trimLeft();
}
`);
    const fields = map.get("f")?.get("o");
    expect(fields?.find((f) => f.field === "label")?.type).toBe("string()");
  });

  it("param.trimRight() ⇒ param: string()", () => {
    const map = collectParamBodyReadTypes(`
export function g(o) {
  return o.label.trimRight();
}
`);
    const fields = map.get("g")?.get("o");
    expect(fields?.find((f) => f.field === "label")?.type).toBe("string()");
  });

  it("负控：param.includes(...) 仍推不出 string()（该表刻意排除 Array 同名方法）", () => {
    const map = collectParamBodyReadTypes(`
export function h(o) {
  return o.label.includes("x");
}
`);
    const fields = map.get("h")?.get("o");
    expect(fields?.find((f) => f.field === "label")?.type).not.toBe("string()");
  });
});
