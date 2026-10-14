/**
 * issue #151：循环携带绑定宽化（loop-widen，Bug 47/48）到 prim 域顶的
 * 返回值对无界裸 prim 契约的域隶属证明。
 *
 * 宽化产物形态（实测）：
 *   - m1 `let best='info'; for (const x of xs) best=x`（xs: string[]）
 *     → 单臂 `string #widened`（无 term/pred）；
 *   - m2 `let best=null; …` → sum `null | string #widened`（nullish lit
 *     臂 + widened 裸 prim 臂，parent conf=widened）。
 * 此前两处没接住 #115 的「partial 丢界/路径证据不丢 prim 值域」口径：
 *   1. 单臂：isValueSetUnknown 把 conf="widened" 归「值域未知」→
 *      assertImpliesSingle 无条件 unprovable → 假 unproven-return；
 *   2. sum：isWidenedSumArm 只认 parent.conf==="partial"，loop-widen
 *      产物 parent/arm conf 是 "widened" → discharge 永不触发。
 * 现与 #115 同口径：无界裸 prim 契约（string() / union(string(), lit(null))
 * 的 string 成员）的域隶属可证；带界义务（gt(0)）与错配 prim 仍 unprovable
 * （不得 proved、不得 disproved）。
 *
 * 入口：checkSource + @nudo:import 侧车契约（与 check-return-contract /
 * check-guard-while-assign-118 同 harness）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

/** issue #151 契约形态（array 收集器入参 / 无界 prim / 带界 / nullable） */
const NUDO_SRC = `
export const strArr = array(string());
export const numArr = array(number());
export const bareStr = string();
export const bareNum = number();
export const posNum = number().gt(0);
export const strOrNull = union(string(), lit(null));
`;

const IMP = `/// @nudo:import { strArr, numArr, bareStr, bareNum, posNum, strOrNull } from "./std151.nudo.js"\n`;

const opts = {
  loadModule: (spec: string) => (spec.includes("std151") ? NUDO_SRC : undefined),
  fromFile: "/test/file.js",
};

function check(src: string) {
  return checkSource("/t/loop-widen-bare-prim-151.js", IMP + src, pTrue, opts);
}

/** @nudo:contract return 后置诊断（unproven-return warning / violated error） */
function retIssues(r: ReturnType<typeof check>) {
  return r.issues.filter((i) => i.message.includes("@nudo:contract return"));
}

describe("issue #151：循环宽化 prim 域顶对无界裸 prim 契约可证", () => {
  it("m1 单臂：string #widened 对 string() 证得（无 unproven-return）", () => {
    const r = check(`
/**
 * @nudo:contract xs strArr
 * @nudo:contract return bareStr
 */
export function lastLabel(xs) {
  let best = 'info';
  for (const x of xs) best = x;
  return best;
}
`);
    expect(retIssues(r)).toEqual([]);
  });

  it("m2 sum：null | string #widened 对 union(string(), lit(null)) 证得", () => {
    const r = check(`
/**
 * @nudo:contract xs strArr
 * @nudo:contract return strOrNull
 */
export function lastLabelOrNull(xs) {
  let best = null;
  for (const x of xs) best = x;
  return best;
}
`);
    expect(retIssues(r)).toEqual([]);
  });
});

describe("issue #151 守卫：宽化 discharge 不越界", () => {
  it("单臂 widened number 对 string() 仍 unprovable（warning，非 error）", () => {
    const r = check(`
/**
 * @nudo:contract xs numArr
 * @nudo:contract return bareStr
 */
export function lastCountAsStr(xs) {
  let best = 0;
  for (const x of xs) best = x;
  return best;
}
`);
    const issues = retIssues(r);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.code).toBe("nudo:unproven-return");
  });

  it("单臂 widened number 对带界契约 number().gt(0) 仍 unprovable", () => {
    const r = check(`
/**
 * @nudo:contract xs numArr
 * @nudo:contract return posNum
 */
export function lastCountPositive(xs) {
  let best = 0;
  for (const x of xs) best = x;
  return best;
}
`);
    const issues = retIssues(r);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.code).toBe("nudo:unproven-return");
  });

  it("sum widened number 臂对 union(string(), lit(null)) 仍 unprovable", () => {
    // null 臂被契约 nullish 域 discharged；widened number 臂 prim 错配
    // → 整体 unprovable（不得 proved，也不得对 number 臂报 error）。
    const r = check(`
/**
 * @nudo:contract xs numArr
 * @nudo:contract return strOrNull
 */
export function lastCountOrNullStr(xs) {
  let best = null;
  for (const x of xs) best = x;
  return best;
}
`);
    const issues = retIssues(r);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.code).toBe("nudo:unproven-return");
  });
});

describe("issue #151 回归：非循环 exact 臂语义不变", () => {
  it("exact 字面量臂对 string() 证得（proved 口径不动）", () => {
    const r = check(`
/**
 * @nudo:contract return bareStr
 */
export function label() {
  return 'info';
}
`);
    expect(retIssues(r)).toEqual([]);
  });

  it("exact 字面量臂违约仍 error（disproved 口径不动）", () => {
    const r = check(`
/**
 * @nudo:contract return bareStr
 */
export function badLabel() {
  return 0;
}
`);
    const issues = retIssues(r);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.code).toBe("nudo:constraint-violated");
  });
});
