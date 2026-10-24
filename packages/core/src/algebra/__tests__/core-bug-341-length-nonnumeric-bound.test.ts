/**
 * Bug 341 — `length(...)` 不校验界的**类型**：`string().length("3")` 这类笔误
 * 把右端写成字符串字面量 ⇒ 执法层「右端非数值 ⇒ 整条分支跳过」⇒ 契约
 * **完全失效**（门禁零诊断 = 假绿）：明显违规的实参一个都不报。
 *
 * 修法：与 gt/ge/lt/le/min/max 同源走 `finiteBoundArg`（构造期拒绝）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { string, checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 341 · length 界的类型校验（非数值界不得静默废掉契约）", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeInterfaceDiags();
  });

  it("length(\"3\") / length(null) / length(true) 在构造期抛错", () => {
    expect(() => string().length("3" as unknown as number)).toThrow(
      /finite numeric bound expected/,
    );
    expect(() => string().length(null as unknown as number)).toThrow(
      /finite numeric bound expected/,
    );
    expect(() => string().length(true as unknown as number)).toThrow(
      /finite numeric bound expected/,
    );
  });

  it("错误文案带引号地展示字符串界（got \"3\"），并点名 length()", () => {
    expect(() => string().length("3" as unknown as number)).toThrow(/nudo length\(\)/);
    expect(() => string().length("3" as unknown as number)).toThrow(/got "3"/);
  });

  it("产品面：length(\"3\") 的契约不再静默失效（改前 0 error = 假绿）", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, string } from "@nudojs/core";
export const f = fn({ s: string().length("3") }, string());`,
    });
    const src = `
export function f(s) {
  return s;
}
export function g() {
  return f("abcd");
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:interface-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("finite numeric bound expected");
    // 改前：契约完全失效 ⇒ 门禁 0 error（"abcd" 长度 4 > 3 也不报）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  });

  it("对照组：合法数值界仍然产出真正的长度约束（length(3) 仍报违例）", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, string } from "@nudojs/core";
export const f = fn({ s: string().length(3) }, string());`,
    });
    const src = `
export function f(s) {
  return s;
}
export function g() {
  return f("abcd");
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBeGreaterThan(0);
  });
});
