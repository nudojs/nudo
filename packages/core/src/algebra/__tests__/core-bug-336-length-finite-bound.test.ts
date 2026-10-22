/**
 * Bug 336 — `length(...)` 没走 issue-#152 的**有限数值界护栏**：
 * `string().length(NaN)` 造出恒假契约（`length(x) ≥ NaN ∧ ≤ NaN`）
 * ⇒ 每个**合法**字符串实参都被判违反（假红），且零诊断说明契约无效。
 *
 * 修法：`length` 与 gt/ge/lt/le/min/max 同源走 `finiteBoundArg`。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { string, checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 336 · length 有限数值界护栏", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeInterfaceDiags();
  });

  it("length(NaN) / length(±Infinity) 在构造期抛错（不再造恒假契约）", () => {
    expect(() => string().length(NaN)).toThrow(/finite numeric bound expected/);
    expect(() => string().length(Infinity)).toThrow(/finite numeric bound expected/);
    expect(() => string().length(-Infinity)).toThrow(/finite numeric bound expected/);
  });

  it("错误文案点名 length() 与实际入参（Nudo 原生，非宿主原文）", () => {
    expect(() => string().length(NaN)).toThrow(/nudo length\(\)/);
    expect(() => string().length(NaN)).toThrow(/got NaN/);
    expect(() => string().length(Infinity)).toThrow(/got Infinity/);
  });

  it("合法界仍然通过（3 / 2.5 / 0）", () => {
    expect(() => string().length(3)).not.toThrow();
    expect(() => string().length(2.5)).not.toThrow();
    expect(() => string().length(0)).not.toThrow();
  });

  it("产品面：契约里的 length(NaN) 变成侧车装载失败，不再对合法字符串报假红", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, string } from "@nudojs/core";
export const f = fn({ s: string().length(NaN) }, string());`,
    });
    const src = `
export function f(s) {
  return s;
}
export function g() {
  return f("abc");
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:interface-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("finite numeric bound expected");
    // 改前：2 条 nudo:constraint-violated（合法实参 "abc" 判违规 = 假红）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  });
});
