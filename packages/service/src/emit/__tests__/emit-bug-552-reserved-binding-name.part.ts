/**
 * Bug 552 —— dts 面把**保留字**当绑定名直出。
 *
 * 改前：`export declare function default(...)` / `export declare function class(...)`
 * ⇒ **TS1359 + TS1005**（整份 `.d.ts` 解析失败，tsc exit 2）——而同一次导出
 * 的 zod / standard / guard 三面全部合法 ⇒ 四面不一致。
 *
 * 根因：dts 面的声明名只做了「字符级清洗」（`C.m` → `C_m`），**没做保留字
 * 清洗**；core 的 `toJsBindingIdent` 是仓里既有的保留字口径（保留字加 `_`
 * 前缀）⇒ 复用它。
 */
import { describe, it, expect } from "vitest";
import { anyAbs, numLit, type Abs } from "@nudojs/core";
import { projectFunctionDts } from "../dts-generator.ts";
import type { FunctionAnalysis } from "../../analyzer-types.ts";

const neverAbs = (): Abs =>
  ({ shape: { k: "never" }, term: undefined, pred: undefined, conf: "exact" }) as Abs;

function fnOf(name: string): FunctionAnalysis {
  return {
    name,
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    paramNames: ["x"],
    cases: [{ name: "entry@L1", argAbs: [anyAbs], abs: numLit(2), throwsAbs: neverAbs() }],
  } as FunctionAnalysis;
}

describe("Bug 552 —— 导出绑定名清洗（保留字）", () => {
  it("保留字作绑定名 ⇒ `_` 前缀（不是直出）", () => {
    const p = projectFunctionDts(fnOf("class"));
    const text = p.lines.join("\n");
    expect(text).toContain("export declare function _class(");
    expect(text).not.toContain("function class(");
  });

  it("多个保留字都清洗（default / let / eval / await）", () => {
    for (const name of ["default", "let", "eval", "await", "static", "yield"]) {
      const p = projectFunctionDts(fnOf(name));
      const text = p.lines.join("\n");
      expect(text, name).not.toMatch(new RegExp(`function ${name}\\(`));
    }
  });

  it("负控制：合法绑定名原样保留（不误伤）", () => {
    const p = projectFunctionDts(fnOf("calculate"));
    expect(p.lines.join("\n")).toContain("export declare function calculate(");
  });

  it("负控制：点号名仍按既有口径清洗成 C_m（#494 不回退）", () => {
    const p = projectFunctionDts(fnOf("C.m"));
    const text = p.lines.join("\n");
    expect(text).not.toContain("C.m(");
    expect(text).toContain("C_m(");
  });
});
