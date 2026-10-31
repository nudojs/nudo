/**
 * BUG-190 —— 模块级**值绑定**（`export const` / `export let` / TS `enum`）在导出
 * 面表里登记了、却从不落地到 `.d.ts` ⇒ 发布的产物里根本没有这些导出 ⇒
 * 消费端 `error TS2305: Module … has no exported member 'VERSION'`，而运行时
 * 确实有该导出（`.d.ts` 与运行时面相反）。
 *
 * 判据：导出面里登记的每个绑定都要有声明；值的**类型**取分析面绑定（同一条
 * 推断来源），无绑定则投影为 `unknown` 并留 `nudo:unresolved-value` 台账。
 */
import { describe, it, expect } from "vitest";
import type { Abs } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

/** CLI export 面的模块值表（与分析面绑定同名：本地名 → Abs） */
function valuesOf(source: string, path = "/test/bug190.ts"): Map<string, Abs> {
  const result = analyzeFile(path, source);
  const out = new Map<string, Abs>();
  for (const [name, info] of result.bindings) out.set(name, info.abs);
  return out;
}

function moduleDts(source: string, path = "/test/bug190.ts", includeValues = true): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions
    .filter((fn) => fn.cases.length > 0)
    .map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) }));
  return projectModuleDts(surface, entries, includeValues ? { values: valuesOf(source, path) } : {})
    .lines.join("\n");
}

describe("BUG-190 —— 值导出落地到 .d.ts", () => {
  it("`export const` / `export let` 有声明，类型来自分析面绑定", () => {
    const dts = moduleDts(`export const VERSION = "1.2.3";
export const LIMIT = 10;
export let counter = 0;
`);
    expect(dts).toContain("export declare const VERSION: string;");
    expect(dts).toContain("export declare const LIMIT: number;");
    expect(dts).toContain("export declare let counter: number;");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts":
        'import { VERSION, LIMIT, counter } from "./mod.js";\n' +
        "const v: string = VERSION;\nconst l: number = LIMIT;\nconst c: number = counter;\nexport { v, l, c };\n",
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("TS `enum` 按 enum 声明（成员 + 字面量初始化器都在）", () => {
    const dts = moduleDts(`export enum Mode {
  A = "a",
  B = "b",
}
`);
    expect(dts).toContain("export declare enum Mode {");
    expect(dts).toContain('A = "a",');
    expect(dts).toContain('B = "b",');
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { Mode } from "./mod.js";\nconst m: Mode = Mode.A;\nexport { m };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("数值 enum：无初始化器成员照常落地（消费方零参 import 可用）", () => {
    const dts = moduleDts(`export enum Level {
  Low,
  High,
}
`);
    expect(dts).toContain("export declare enum Level {");
    expect(dts).toContain("Low,");
    expect(dts).toContain("High,");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { Level } from "./mod.js";\nconst l: Level = Level.High;\nexport { l };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("无分析绑定 ⇒ 声明仍是 `unknown` + 台账（不静默消失）", () => {
    const dts = moduleDts(`export const later = computeSomething();
`, "/test/bug190-unresolved.ts", false);
    expect(dts).toContain("export declare const later: unknown;");
    expect(dts).toContain("nudo:unresolved-value later");
  });

  // ── 负控制：非导出的模块值不进产物 ─────────────────────────────
  it("负控制：非导出的模块级 const 不进 .d.ts", () => {
    const dts = moduleDts(`const secret = 42;
export function reveal() {
  return secret;
}
`);
    expect(dts).not.toContain("secret");
    expect(dts).toContain("export declare function reveal(");
  });
});
