/**
 * 分册 03 · Bug 96 —— 标量 `.optional()` 把**有界谓词**整条折成未决 ⇒
 * L1 调用点零执法（假绿；同一契约去掉 `.optional()` 立刻报红，文档指定的
 * 等价写法 `union(<base>, lit(undefined))` 也照常报红）。
 *
 * 根因：`optionalizePred` 把 `and(typeof, 界)` 包进 `or` 的**一个成员**；
 * `judgeOrMember` 只委托 `judgeLiteralPred`（不认 `and`）⇒ undefined ⇒
 * `memberDomainKind(and)` 取出的域与实参兼容 ⇒ 整条 `or` 未决 ⇒ 跳过。
 *
 * 修法：`judgeOrMember` 对 `and` 成员按合取逐原子求值；`judgeLiteralPred`
 * 的 eq(nullish) 分支对**形态确定**的实参判确定假（undefined 臂对 `[1]` /
 * `500` / `{}` 不再是「不可判定」）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number, string, array, union, lit } from "@nudojs/core";
export const boundedOpt = number().lt(100).optional();
export const bounded = number().lt(100);
export const strMinOpt = string().min(3).optional();
export const arrMinOpt = array(number()).min(2).optional();
export const gtLtOpt = number().gt(0).lt(10).optional();
export const viaUnion = union(number().lt(100), lit(undefined));
export const optNum = number().optional();
`;
const IMP = `/// @nudo:import { boundedOpt, bounded, strMinOpt, arrMinOpt, gtLtOpt, viaUnion, optNum } from "./std96.nudo.js"\n`;
const FILE = "/t/bug96.js";

function check(contract: string, arg: string) {
  const src = `${IMP}/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }
`;
  return checkSource(FILE, src, pTrue, sidecarOpts("std96", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 96 · 有界 .optional() 契约在调用点执法", () => {
  it.each([
    ["boundedOpt", "500", "number().lt(100).optional()"],
    ["strMinOpt", '"ab"', "string().min(3).optional()"],
    ["arrMinOpt", "[1]", "array(number()).min(2).optional()"],
    ["gtLtOpt", "500", "number().gt(0).lt(10).optional()"],
  ])("%s 收到 %s ⇒ 报一条违例（改前假绿）", (contract, arg, _label) => {
    expect(violations(check(contract, arg))).toHaveLength(1);
  });

  it("去掉 .optional() 的同一契约仍报（控制组）", () => {
    expect(violations(check("bounded", "500"))).toHaveLength(1);
  });

  it("等价写法 union(base, lit(undefined)) 与 .optional() 结论一致", () => {
    expect(violations(check("viaUnion", "500"))).toHaveLength(1);
    expect(violations(check("boundedOpt", "500"))).toHaveLength(1);
  });

  it.each([
    ["boundedOpt", "undefined"],
    ["strMinOpt", "undefined"],
    ["arrMinOpt", "undefined"],
    ["gtLtOpt", "undefined"],
    ["optNum", "undefined"],
  ])("负控制：%s 收到 undefined ⇒ 零违例（088 不回归）", (contract, arg) => {
    expect(violations(check(contract, arg))).toHaveLength(0);
  });

  it.each([
    ["boundedOpt", "5"],
    ["strMinOpt", '"abcd"'],
    ["arrMinOpt", "[1, 2]"],
    ["gtLtOpt", "5"],
    ["optNum", "5"],
  ])("负控制：%s 收到满足界的 %s ⇒ 零违例", (contract, arg) => {
    expect(violations(check(contract, arg))).toHaveLength(0);
  });
});
