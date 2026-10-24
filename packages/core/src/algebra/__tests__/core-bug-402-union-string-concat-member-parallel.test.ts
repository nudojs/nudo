/**
 * Bug 402 —— 字符串 union 拼接**伪造不可能字面量**（成员级并联回归钉）
 *
 * 根因（core/src/algebra/template.ts）：
 *   `coerceToStringParts` 的 sum 分支把每个 union 成员的 parts **平铺进同
 *   一个数组**（`parts.push(...mp)`）⇒ 丢掉「成员级并联」信息；`concatString`
 *   再把两侧 parts 合成**单个** template；`createTemplateAbs` 对全字面量
 *   parts 折叠成**一个** lit ⇒ `("a"|"b") + "!"` 折成 `"ab!"`（原生只有
 *   `"a!"` / `"b!"` ⇒ `"ab!"` 是**不含任何真实可能值**的确定字面量）。
 *
 * 修法：
 *   - `coerceToStringParts` 保留「成员 → parts 数组」的边界（模块私有）
 *   - `concatString` 对 sum 侧做**成员级叉乘** ⇒ 产出 `sum` 而不是单个 `lit`
 *   - 上游触发点（core/src/algebra/arithmetic/addsub.ts）：`add()` 的字符串
 *     快路径在「任一侧是 sum」时必须让位给 `distributeSumBinOp`（否则正确
 *     的并联分发器根本没机会介入）
 *
 * 原生对照：f("a")="a!" / f("b")="b!"；g("a")="v=a" / g("b")="v=b"；
 *            h("a")="a-!" / h("b")="b-!"。
 */
import { describe, it, expect } from "vitest";
import { abs, type Abs } from "../abs.ts";
import { lit } from "../term.ts";
import { formatShape } from "../format.ts";
import { concatString } from "../template.ts";
import { call } from "./eval-helpers.ts";

const strLit = (s: string): Abs =>
  abs({ k: "prim", type: "string" }, lit(s), undefined, "exact");

const strUnion = (...ms: string[]): Abs =>
  abs({ k: "sum", members: ms.map(strLit) }, undefined, undefined, "exact");

/** 结果的成员字面量值（顺序敏感；非 sum ⇒ 单成员视图） */
function memberLits(a: Abs): unknown[] {
  const members = a.shape.k === "sum" ? a.shape.members : [a];
  return members.map((m) => (m.term?.op === "lit" ? m.term.value : undefined));
}

describe("Bug 402: 字符串 union 拼接必须是成员级并联", () => {
  it("concatString: (\"a\"|\"b\") + \"!\" ⇒ \"a!\" | \"b!\"（旧实现折成 \"ab!\"）", () => {
    const r = concatString(strUnion("a", "b"), strLit("!"));
    expect(r.shape.k).toBe("sum");
    expect(memberLits(r)).toEqual(["a!", "b!"]);
    expect(formatShape(r)).toBe('"a!" | "b!"');
  });

  it("concatString: union 在左侧同样逐成员并联（`v=` + union）", () => {
    const r = concatString(strLit("v="), strUnion("a", "b"));
    expect(r.shape.k).toBe("sum");
    expect(memberLits(r)).toEqual(["v=a", "v=b"]);
  });

  it("concatString: 两侧都是 union ⇒ 成员级叉乘", () => {
    const r = concatString(strUnion("a", "b"), strUnion("1", "2"));
    expect(r.shape.k).toBe("sum");
    expect(memberLits(r)).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("concatString: 非 union 侧的既有行为不变（单成员 ⇒ 直接返回该成员）", () => {
    const r = concatString(strLit("a"), strLit("b"));
    expect(r.shape.k).toBe("prim");
    expect(memberLits(r)).toEqual(["ab"]);
    expect(formatShape(r)).toBe('"ab"');
  });

  it("产品面：`+` 的 union 实参 ⇒ 成员级并联（不是 \"ab!\"）", () => {
    const src = `export function f(x) { return x + "!"; }`;
    const rec = call(src, "f", [strUnion("a", "b")]);
    expect(formatShape(rec.result)).toBe('"a!" | "b!"');
  });

  it("产品面：模板字面量（`v=${x}`）的 union 实参 ⇒ 成员级并联（不是 \"v=ab\"）", () => {
    const src = "export function f(x) { return `v=${x}`; }";
    const rec = call(src, "f", [strUnion("a", "b")]);
    expect(formatShape(rec.result)).toBe('"v=a" | "v=b"');
  });

  it("产品面：union 实参的两段拼接（`x + \"-\"` 再 `+ \"!\"`）仍是成员级并联", () => {
    const src = `export function f(x) { const y = x + "-"; return y + "!"; }`;
    const rec = call(src, "f", [strUnion("a", "b")]);
    expect(formatShape(rec.result)).toBe('"a-!" | "b-!"');
  });
});
