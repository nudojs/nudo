/**
 * 分册 03 · Bug 38 —— 契约**槽位**（shape 字段 / 数组元素）上的数组长度界
 * 在 L1 门禁零执法（假绿）；同一界在顶层形参 / guard 面都生效。
 *
 * 根因：`checkFieldConstraint` 复制顶层长度通道时只抄了字符串半边
 * （`sv = typeof lv === "string" ? lv.length : undefined`）⇒ 数组 Abs 的
 * `sv === undefined` 命中 `continue` ⇒ 该槽位的长度谓词一次都不裁决。
 *
 * 修法：与顶层 `checkReqs` 同口径 —— 字符串取字数、数组取元素个数
 * （`arrayLengthOf`）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number, shape, array } from "@nudojs/core";
export const twoNumbers = array(number()).min(2);
export const nestedTwo = shape({ list: array(number()).min(2) });
export const nestedArr = array(array(number()).min(2));
`;
const IMP = `/// @nudo:import { twoNumbers, nestedTwo, nestedArr } from "./std38.nudo.js"\n`;
const FILE = "/t/bug38.js";

function check(contract: string, arg: string) {
  const src = `${IMP}/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }
`;
  return checkSource(FILE, src, pTrue, sidecarOpts("std38", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string; expected?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 38 · shape 槽位 / 数组元素的长度界执法", () => {
  it("顶层形参（对照组）topLevel([1]) ⇒ 报 length(xs) ≥ 2", () => {
    const v = violations(check("twoNumbers", "[1]"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("length");
  });

  it("shape 槽位 nested({ list: [1] }) ⇒ 报 length(s.list) ≥ 2（改前零诊断）", () => {
    const v = violations(check("nestedTwo", "{ list: [1] }"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("length");
  });

  it("数组元素位 [[1]]（array(array(...).min(2))）⇒ 报违例", () => {
    expect(violations(check("nestedArr", "[[1]]"))).toHaveLength(1);
  });

  it.each([
    ["twoNumbers", "[1, 2]"],
    ["nestedTwo", "{ list: [1, 2] }"],
    ["nestedArr", "[[1, 2]]"],
  ])("负控制：%s 收到满足长度界的 %s ⇒ 零违例", (contract, arg) => {
    expect(violations(check(contract, arg))).toHaveLength(0);
  });
});
