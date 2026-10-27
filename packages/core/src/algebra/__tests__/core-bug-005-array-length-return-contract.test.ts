/**
 * BUG-005 回归：`array(...)` 的**长度界**在返回契约上完全不执法（假绿）。
 *
 * 根因：`assertImpliesSingle` 的 `element` 分支只对账元素类型就 `proved()` 返回，
 * 而 `array(...)` **没有 prim** ⇒ 通用谓词通道（`assertScalar`）根本走不到 ⇒
 * 约束自身的 `preds`（`length(self) ≥ n`）被静默丢弃 ⇒ 返回 `[]`（明确违反
 * `array(number()).min(1)`）也判 OK（CLI exit 0，零诊断）。
 * 同一条契约用作**参数**时由 scan 的独立 length 通道正确拦截 ⇒ 两个通道口径不一致。
 *
 * 修法：结构对账通过后补评约束自身的 preds——`length(<返回项>)` 用已知结构长度
 * （tuple 元素数 / obj 自有键数）接地判定；接地不了降 `unprovable`（不伪装 proved）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { abs } from "../abs.ts";
import { array, number } from "../constraint.ts";
import { assertImplies } from "../postcondition.ts";

const SIDECAR = `
export const nonEmpty = array(number()).min(1);
export const twoOrMore = array(number()).min(2);
export const atMostOne = array(number()).max(1);
export const exactlyOne = array(number()).length(1);
export const anyLen = array(number());
`;

const opts = {
  loadModule: (spec: string) => (spec.includes("len.nudo.js") ? SIDECAR : undefined),
  fromFile: "/t/app.js",
};

function check(contract: string, body: string) {
  const src = `/// @nudo:import { nonEmpty, twoOrMore, atMostOne, exactlyOne, anyLen } from "./len.nudo.js"
/**
 * @nudo:contract return ${contract}
 */
export function f() {
  return ${body};
}
`;
  return checkSource("/t/app.js", src, pTrue, opts);
}

const violations = (r: ReturnType<typeof check>) =>
  r.issues.filter((i) => i.code === "nudo:constraint-violated" && i.fn === "f");

describe("BUG-005: array 长度界在返回契约上必须执法", () => {
  it("返回 [] ⊭ array(number()).min(1) ⇒ error（此前零诊断假绿）", () => {
    const r = check("nonEmpty", "[]");
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.severity).toBe("error");
    // 违约描述必须点出长度界（formatConstraint 不渲染 array 的长度链）
    expect(v[0]!.expected).toContain("length(return) ≥ 1");
  });

  it("返回 [1] ⊭ array(number()).min(2) ⇒ error", () => {
    const v = violations(check("twoOrMore", "[1]"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("length(return) ≥ 2");
  });

  it("返回 [1, 2] ⊭ array(number()).max(1) ⇒ error", () => {
    const v = violations(check("atMostOne", "[1, 2]"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("length(return) ≤ 1");
  });

  it("返回 [1, 2] ⊭ array(number()).length(1) ⇒ error", () => {
    expect(violations(check("exactlyOne", "[1, 2]")).length).toBeGreaterThan(0);
  });

  it("不制造假红：[1] 满足 min(1) / length(1)，[] 满足 max(1)", () => {
    expect(violations(check("nonEmpty", "[1]"))).toEqual([]);
    expect(violations(check("exactlyOne", "[1]"))).toEqual([]);
    expect(violations(check("atMostOne", "[]"))).toEqual([]);
    // 无长度界的 array 契约照旧只问元素域
    expect(violations(check("anyLen", "[]"))).toEqual([]);
  });

  it("元素域仍照旧对账（长度通道不得掩盖元素违约）", () => {
    const r = checkSource(
      "/t/app.js",
      `/// @nudo:import { nonEmpty } from "./len.nudo.js"
/**
 * @nudo:contract return nonEmpty
 */
export function f() {
  return ["x"];
}
`,
      pTrue,
      opts,
    );
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("array element");
  });

  it("单元面：抽象 arr（长度事实已丢）⇒ unprovable，不得伪装 proved", () => {
    const el = abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
    const arrAbs = abs({ k: "arr", element: el }, undefined, undefined, "path");
    expect(assertImplies(arrAbs, array(number()).min(1)).status).toBe("unprovable");
    // tuple 长度已知 ⇒ 可判定（0 < 1）
    const empty = abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
    expect(assertImplies(empty, array(number()).min(1)).status).toBe("disproved");
    expect(assertImplies(empty, array(number())).status).toBe("proved");
  });
});
