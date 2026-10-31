/**
 * BUG-261：`@nudo:contract` 的**返回位**约束名写成 **builder 调用**
 * （`return number()`）⇒ 整条契约被**静默丢弃**、零诊断 ⇒ 声明的后置条件
 * 从未执法（假绿）；而**参数位**同款写法有 `nudo:contract-syntax` 警告
 * ⇒ 两处判据不对称。
 *
 * 根因：`refine.ts` 的返回段守卫判的是「**有没有第二个 token**」
 * （`!/^return\s+\S+$/.test(part)`）而不是「第二个 token 是不是合法约束名」
 * ⇒ `return number()` 恰好有 token ⇒ 不报诊断 ⇒ `continue`。
 *
 * 钉：返回位非法形态必须报 `nudo:contract-syntax`（与参数位同口径）；
 * 合法绑定名写法仍然正常工作（不被新守卫误伤）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import {
  extractRefineReturnFromSource,
  extractRefinesFromSource,
  takeRefineDiags,
  setRefineDiagCollector,
} from "../refine.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  setRefineDiagCollector(null);
  takeRefineDiags();
});

describe("BUG-261 @nudo:contract 返回段的文法判据", () => {
  it("return number()（builder 调用）⇒ 发 nudo:contract-syntax（不再静默丢弃）", () => {
    const src = `/**
 * @nudo:contract return number()
 */
export function f(x) { return "s"; }`;
    takeRefineDiags();
    const got = extractRefineReturnFromSource(src, "f", {
      loadModule: () => `export const number = 1;`,
      fromFile: "/t/f.js",
    });
    const diags = takeRefineDiags();
    expect(got).toBeUndefined();
    expect(diags.some((d) => d.code === "nudo:contract-syntax" && d.message.includes("return number()"))).toBe(true);
  });

  it("返回位与参数位同款写法的诊断集一致（两处判据对称）", () => {
    const src = `/**
 * @nudo:contract x number()
 * @nudo:contract return number()
 */
export function f(x) { return x; }`;
    takeRefineDiags();
    extractRefinesFromSource(src, "f", { loadModule: () => undefined, fromFile: "/t/f.js" });
    extractRefineReturnFromSource(src, "f", { loadModule: () => undefined, fromFile: "/t/f.js" });
    const messages = takeRefineDiags()
      .filter((d) => d.code === "nudo:contract-syntax")
      .map((d) => d.message);
    expect(messages.some((m) => m.includes("segment 'x number()'"))).toBe(true);
    expect(messages.some((m) => m.includes("return segment 'return number()'"))).toBe(true);
  });

  it("合法绑定名写法不被误伤（对照）：return positive 仍然执法", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().ge(0);\n`,
    });
    const r = checkSource(
      "/t/f.js",
      `
/// @nudo:import { positive } from "./f.nudo.js"

/**
 * @nudo:contract return positive
 */
export function f() {
  return "s";
}
`,
      pTrue,
      { loadModule, fromFile: "/t/f.js" },
    );
    expect(r.issues.filter((i) => i.code === "nudo:contract-syntax")).toEqual([]);
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.severity).toBe("error");
  });
});
