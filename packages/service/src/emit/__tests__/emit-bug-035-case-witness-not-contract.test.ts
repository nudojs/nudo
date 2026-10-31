/**
 * BUG-035 —— `nudo contract --emit` 把 `@nudo:case` 的**调试见证**写成契约。
 *
 * 现象（同一份文件，三个面三种说法）：
 *
 * | 面 | 输出 |
 * |---|---|
 * | `contract --emit --all` | `export const f = fn({ x: lit(5) }, lit(6));` ← **契约** |
 * | `nudo test` | `debug "one" (5) => 6` + `entry@L4 (any) => number \| string` |
 * | `nudo check` 签名 | `f(x: any) => number \| string` |
 *
 * ⇒ 写出来的契约说「f 只接受 x = 5、只返回 6」，门禁说「f 接受任意 x、
 * 返回 number | string」——**同一份源码，emit 产物与门禁结论互相矛盾**。
 *
 * 根因（`packages/service/src/emit/interface-emitter.ts` 的 `projectFunctionDsl`）：
 * 指令来源（`source === "directive"`）与调用点证据（`source === "callsite"`）
 * **平权**当域来源与返回义务来源 ⇒ 纯点观测见证被写成契约。
 *
 * 修法（与 `analyzer-orchestrate-uncached.ts` 的「点观测不得独占返回面」
 * 同口径）：指令来源**内部**再分档——
 * - **域声明**（实参是约束构建器 `number()`/`shape()`/`union()` … 的域形状，
 *   或带断言 `=> expected`）⇒ 可作域来源；
 * - **纯点观测见证**（实参全是字面量且无断言）⇒ **不产任何契约**（不生成域、
 *   不生成返回义务）。
 *
 * 钉：三种 case 形态（点观测 / 带断言 / 域形状）+ 「有调用点证据时指令见证
 * 不得污染返回义务」+ 分档判据本身（构造器实参 ⇒ 域；字面量实参且无断言 ⇒
 * 见证）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitInterface } from "../interface-emitter.ts";
import { isDomainDeclarationCase } from "../domain-cases.ts";
import { abs as makeAbs, numLit } from "@nudojs/core";
import type { CaseResult } from "../../analyzer.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 写源文件 → 发射 → 返回（侧车文本 / 写盘结果） */
async function emit(name: string, src: string): Promise<{
  sidecar: string;
  exists: boolean;
  written: string[];
  skipped: Array<{ fn: string; reason: string }>;
}> {
  const file = join(dir, `${name}.js`);
  writeFileSync(file, src);
  const r = await emitInterface(file, { fnNames: [name], mode: "add" });
  const sidecarPath = join(dir, `${name}.nudo.js`);
  const exists = existsSync(sidecarPath);
  return {
    sidecar: exists ? readFileSync(sidecarPath, "utf-8") : "",
    exists,
    written: r.written,
    skipped: r.skipped.map((s) => ({ fn: s.fn, reason: s.reason })),
  };
}

describe("BUG-035 —— `@nudo:case` 的调试见证不进契约产物", () => {
  it("点观测见证（实参全是字面量、无断言）不生成任何契约", async () => {
    // 改前：写盘产物是 `export const f = fn({ x: lit(5) }, lit(6));`
    const r = await emit(
      "f",
      `/**
 * @nudo:case "one" (5)
 */
export function f(x) {
  return x + 1;
}
`,
    );
    // 见证不是域来源、也不是返回义务来源 ⇒ 无可投影证据 ⇒ not-projectable
    expect(r.written).toEqual([]);
    expect(r.skipped).toEqual([{ fn: "f", reason: "not-projectable" }]);
    expect(r.exists).toBe(false);
    // 见证的字面量不得出现在任何产物里
    expect(r.sidecar).not.toContain("lit(5)");
    expect(r.sidecar).not.toContain("lit(6)");
  });

  it("带断言的 case 是域声明 ⇒ 仍可作域来源与返回义务来源", async () => {
    const r = await emit(
      "f",
      `/**
 * @nudo:case "as" (7) => 8
 */
export function f(x) {
  return x + 1;
}
`,
    );
    expect(r.written).toEqual(["f"]);
    expect(r.skipped).toEqual([]);
    expect(r.sidecar).toContain("export const f = fn({ x: lit(7) }, lit(8));");
  });

  it("域形状实参（约束构建器）是域来源 ⇒ `not-projectable` 口径不变", async () => {
    const r = await emit(
      "g",
      `/**
 * @nudo:case "dom" (number())
 */
export function g(x) {
  return x + 1;
}
`,
    );
    // 域形状 case 仍是域来源（不是见证）；它投影不出约束 ⇒ 口径不变
    expect(r.written).toEqual([]);
    expect(r.skipped).toEqual([{ fn: "g", reason: "not-projectable" }]);
    expect(r.exists).toBe(false);
  });

  it("有调用点证据时，指令见证不得污染返回义务", async () => {
    const r = await emit(
      "f",
      `/**
 * @nudo:case "one" (5)
 */
export function f(x) {
  return x + 1;
}

f(9);
`,
    );
    expect(r.written).toEqual(["f"]);
    // 调用点证据优先（BUG-021：点观测拓宽到基类型）⇒ 见证的 lit(5)/lit(6) 不得混入
    expect(r.sidecar).toContain("export const f = fn({ x: number() }, number());");
    expect(r.sidecar).not.toContain("lit(5)");
    expect(r.sidecar).not.toContain("lit(6)");
  });

  it("域声明与见证共存时：域声明生效，见证不污染", async () => {
    const r = await emit(
      "f",
      `/**
 * @nudo:case "witness" (5)
 * @nudo:case "declared" (7) => 8
 */
export function f(x) {
  return x + 1;
}
`,
    );
    expect(r.written).toEqual(["f"]);
    expect(r.sidecar).toContain("export const f = fn({ x: lit(7) }, lit(8));");
    expect(r.sidecar).not.toContain("lit(5)");
  });
});

describe("BUG-035 —— 指令 case 的分档判据（见证 vs 域声明）", () => {
  const never = makeAbs({ k: "never" }, undefined, undefined, "exact");
  const primNumber = makeAbs({ k: "prim", type: "number" }, undefined, undefined, "exact");
  const base = (over: Partial<CaseResult>): CaseResult => ({
    name: "c",
    argAbs: [],
    abs: numLit(1),
    throwsAbs: never,
    source: "directive",
    ...over,
  });

  it("实参全是字面量且无断言 ⇒ 见证（不进契约）", () => {
    const c = base({ argAbs: [numLit(5)] });
    expect(isDomainDeclarationCase(c)).toBe(false);
  });

  it("实参全是字面量但带断言 ⇒ 域声明", () => {
    const c = base({ argAbs: [numLit(5)], expected: numLit(6) });
    expect(isDomainDeclarationCase(c)).toBe(true);
  });

  it("实参是约束构建器（域形状）⇒ 域声明", () => {
    const c = base({ argAbs: [primNumber] });
    expect(isDomainDeclarationCase(c)).toBe(true);
  });

  it("实参混合（字面量 + 约束构建器）⇒ 域声明", () => {
    const c = base({ argAbs: [numLit(5), primNumber] });
    expect(isDomainDeclarationCase(c)).toBe(true);
  });
});
