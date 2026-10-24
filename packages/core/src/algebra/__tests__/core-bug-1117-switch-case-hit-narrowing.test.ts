/**
 * Bug 1117 —— switch **分组 case 标签**的 `hit` 收窄不安全 ⇒ L2 may-throw 假绿。
 *
 * 根因（core/algebra/exec/transpile/stmt-predicates.ts 的 `switchCaseFacts` +
 * `narrowCaseLabelArmThunk`，本分支新增）：
 * - `switchCaseFacts` 只用**原始 prim 标签**算 `hit`，**忽略** `mine.nullish`
 *   （`case null:`）与**非字面量** case 测试（`case v === null:`）⇒ 一个
 *   共享体的多标签臂（`case null: case "ab":`）也被判成「命中值 = "ab"」。
 * - `narrowCaseLabelArmThunk` 据此把判别量**重绑**为那些字面量。
 *
 * 后果（假绿）：
 *   `const x = null; switch (x) { case null: case "ab": return x.length; }`
 *   原生：`case null` 命中（`null === null`）⇒ `null.length` ⇒ **TypeError**；
 *   引擎按源码推导读 `"ab".length` = 2 ⇒ **L2 may-throw 消失**（假绿）。
 *
 * 修法：只有当**同体所有标签都是原始字面量**（无 nullish 标签、无非字面量
 * 测试）时才应用 `hit` 收窄；其余形态**不产命中事实**（宁缺毋假）。
 *
 * P2（`0` 标签）：`case 0:` 命中的是 `x === 0` ⇒ 值域含 **-0**（`-0 === 0`
 * 为真但 `-0 !== 0`）⇒ 直接重绑 `$lit(0)` 会把 -0 改成 +0
 * （`const x = -0; switch (x) { case 0: return 1 / x; }` 原生是 -Infinity，
 * 引擎算成 Infinity = **自信的错值**）⇒ 数值 0 的标签按**交集细化**
 * `{0, -0}`（`$join($lit(0), $lit(-0))`）而非改写单值。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { withStdImport, stdOpts, l2Count, sigOf } from "./nudo-constraints.ts";

/** check 一次（整段函数源码；带标准 import） */
function check(src: string, file = "/t/bug1117.js") {
  return checkSource(file, withStdImport(src), pTrue, stdOpts);
}

describe("Bug 1117：switch 分组 case 标签的 hit 收窄必须安全", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    takeRefineDiags();
    resetSidecarLoadFailureCache();
    takeInterfaceDiags();
    resetParseSourceCache();
    resetAbsCallBudget();
    resetEvalForkBudget();
  });

  it("分组标签（case null + case \"ab\" 共享体）⇒ 不得把 null 重绑成 \"ab\"", () => {
    // 原生：`const x = null` ⇒ `case null` 命中 ⇒ `null.length` ⇒ TypeError。
    const r = check(`
export function f() {
  const x = null;
  switch (x) {
    case null:
    case "ab":
      return x.length;
    default:
      return 0;
  }
}
`);
    // 修前：hit 收窄把 x 重绑成 "ab" ⇒ 读出 2 ⇒ may-throw 消失（假绿）。
    expect(l2Count(r)).toBeGreaterThan(0);
  });

  it("含非字面量 case 测试的分组臂 ⇒ 同样不得按 prim 标签重绑", () => {
    // 原生：`case x` 的测试值 = null ⇒ `null === null` ⇒ 命中 ⇒ `null.length`
    // ⇒ TypeError（switch 用**严格相等**匹配 case 测试）。
    expect(() =>
      new Function(`
  const x = null;
  switch (x) {
    case x:
    case "ab":
      return x.length;
    default:
      return 0;
  }
`)(),
    ).toThrow(TypeError);
    const r = check(`
export function f() {
  const x = null;
  switch (x) {
    case x:
    case "ab":
      return x.length;
    default:
      return 0;
  }
}
`);
    expect(l2Count(r)).toBeGreaterThan(0);
  });

  it("P2：`case 0:` 不得把 -0 谎报成 +0（1 / -0 = -Infinity）", () => {
    const r = check(`
export function f() {
  const x = -0;
  switch (x) {
    case 0:
      return 1 / x;
    default:
      return 0;
  }
}
`);
    const sig = sigOf(r, "f");
    // 原生：`-0 === 0` 为真 ⇒ 命中 ⇒ `1 / -0` = -Infinity。
    // 修前：hit 收窄把 x 重绑成 `$lit(0)` ⇒ `1 / 0` = Infinity（自信的错值）。
    expect(sig).not.toBe("Infinity");
    expect(sig).toContain("-Infinity");
  });

  it("负控制：单一 prim 标签的 hit 收窄**保留**（case \"ab\" ⇒ x.length = 2）", () => {
    const r = check(`
export function f() {
  const x = "ab";
  switch (x) {
    case "ab":
      return x.length;
    default:
      return 0;
  }
}
`);
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "f")).toBe("2");
  });

  it("负控制：单一 nullish 标签的臂仍不产命中事实（case null ⇒ null.length 抛）", () => {
    const r = check(`
export function f() {
  const x = null;
  switch (x) {
    case null:
      return x.length;
    default:
      return 0;
  }
}
`);
    expect(l2Count(r)).toBeGreaterThan(0);
  });

  it("负控制：default 臂的 nullish 排除事实**保留**（x 非 null ⇒ 不抛）", () => {
    // `case null:` 臂存在 ⇒ default 臂上 x 不是 null ⇒ `x.length` 不抛。
    const r = check(`
export function f() {
  const x = "ab";
  switch (x) {
    case null:
      return 0;
    default:
      return x.length;
  }
}
`);
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "f")).toBe("2");
  });
});
