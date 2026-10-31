/**
 * BUG-211 —— 长度界链用在**数值 prim** 上（`number().min(1)`）时：
 * ① 构造期**不被拒** ⇒ 产出恒假约束（guard 产物 `data.length >= 1` 对数字恒
 *   假 ⇒ 拒绝全部合法输出）；
 * ② 参数通道把 `ge(length(x), 1)` 当**普通数值比较**（`3 >= 1` ⇒ 满足）⇒
 *    假绿；返回通道按**长度语义**读同一谓词 ⇒ 假红 ⇒ 同一约束两通道结论相反。
 *
 * 修法：
 * - `constraint.ts` 的 `min` / `max` / `length` 补**构造期 prim 门禁**（与
 *   `gt/ge/lt/le`、`.int()` 同口径）：只有 `string()`、`array(...)` 与无 prim
 *   的开放链允许；数值 / 布尔的 prim 上直接报错；
 * - `diagnostics.ts` 的 `decideLitCmp` 按**比较式左项**分派：纯 `var` 才是数值
 *   比较；`length(t)` 走**长度语义**（字符串字面量）；其余形态（含数字字面量上
 *   的 `length`）判「不可判定」⇒ 不再当中普通数值比较。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  array,
  boolean,
  checkArg,
  checkSource,
  ge,
  lenTerm,
  lit,
  number,
  numLit,
  pTrue,
  strLit,
  string,
  v,
} from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  takeRefineDiags();
  takeInterfaceDiags();
});

const SIDE = `import { number, string, array } from "@nudojs/core";
export const cLen3 = string().length(3);
export const cArr3 = array(number()).min(3);
`;

function check(src: string, file = "/t/minmax.js") {
  const imp = `/// @nudo:import { cLen3, cArr3 } from "./std.nudo.js"\n`;
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

/** 参数通道（谓词执法）的违例 */
function paramViolations(r: {
  issues: { code: string; message: string; expected?: string }[];
}) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && !i.message.includes("return value ⊭"),
  );
}

/** 返回通道的违例 */
function returnViolations(r: {
  issues: { code: string; message: string; expected?: string }[];
}) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && i.message.includes("return value ⊭"),
  );
}

describe("BUG-211 —— 长度界链的构造期 prim 门禁", () => {
  it("number().min(1) / .max(1) / .length(1) 构造期抛错", () => {
    expect(() => number().min(1)).toThrow(/only string \/ array length chains/);
    expect(() => number().min(1)).toThrow(/prim=number/);
    expect(() => number().max(1)).toThrow(/only string \/ array length chains/);
    expect(() => number().length(1)).toThrow(/only string \/ array length chains/);
  });

  it("boolean() / 结构型链上同样抛错（与 gt/ge/lt/le 同口径）", () => {
    expect(() => boolean().min(1)).toThrow(/prim=boolean/);
    expect(() => boolean().max(1)).toThrow(/prim=boolean/);
    expect(() => boolean().length(1)).toThrow(/prim=boolean/);
  });

  it("负控制：string() / array(...) 的长度链仍然可用", () => {
    expect(() => string().min(1)).not.toThrow();
    expect(() => string().max(20)).not.toThrow();
    expect(() => string().length(3)).not.toThrow();
    expect(() => array(number()).min(3)).not.toThrow();
    expect(() => array(number()).max(2)).not.toThrow();
  });
});

describe("BUG-211 —— 参数通道与返回通道同结论（长度语义）", () => {
  it("string().length(3)：两通道都判违例（'ab'）", () => {
    const param = check(`/** @nudo:contract s cLen3 */
export function fStr(s) { return s; }
fStr("ab");
`);
    const ret = check(`/** @nudo:contract return cLen3 */
export function gStr() { return "ab"; }
`);
    expect(paramViolations(param)).toHaveLength(1);
    expect(returnViolations(ret)).toHaveLength(1);
    // 同结论（不是「一绿一红」）
    expect(paramViolations(param).length > 0).toBe(returnViolations(ret).length > 0);
  });

  it("string().length(3)：两通道都放行（'abc'）", () => {
    const param = check(`/** @nudo:contract s cLen3 */
export function fStr(s) { return s; }
fStr("abc");
`);
    const ret = check(`/** @nudo:contract return cLen3 */
export function gStr() { return "abc"; }
`);
    expect(paramViolations(param)).toEqual([]);
    expect(returnViolations(ret)).toEqual([]);
  });

  it("array(...).min(3)：两通道都判违例（[1,2]）", () => {
    const param = check(`/** @nudo:contract xs cArr3 */
export function fArr(xs) { return xs; }
fArr([1, 2]);
`);
    const ret = check(`/** @nudo:contract return cArr3 */
export function gArr() { return [1, 2]; }
`);
    expect(paramViolations(param)).toHaveLength(1);
    expect(returnViolations(ret)).toHaveLength(1);
    expect(paramViolations(param).length > 0).toBe(returnViolations(ret).length > 0);
  });

  it("array(...).min(3)：两通道都放行（[1,2,3]）", () => {
    const param = check(`/** @nudo:contract xs cArr3 */
export function fArr(xs) { return xs; }
fArr([1, 2, 3]);
`);
    const ret = check(`/** @nudo:contract return cArr3 */
export function gArr() { return [1, 2, 3]; }
`);
    expect(paramViolations(param)).toEqual([]);
    expect(returnViolations(ret)).toEqual([]);
  });
});

describe("BUG-211 —— decideLitCmp 不得把 length(...) 当普通数值比较", () => {
  const lengthAtLeast1 = ge(lenTerm(v("s")), lit(1));

  it("数字字面量 × length(s) ≥ 1 ⇒ 不可判定（不是「满足」）", () => {
    const d = checkArg(numLit(3), lengthAtLeast1);
    // 修复前：decideLitCmp 按 3 >= 1 判满足 ⇒ 返回 undefined（假绿）
    expect(d?.code).toBe("nudo:constraint-unproven");
  });

  it("数字字面量 0 × length(s) ≥ 1 同样是「不可判定」（不是「违例」）", () => {
    // 修复前：0 >= 1 判**不满足** ⇒ 假红（长度语义不可判 ⇒ 不得给结论）
    expect(checkArg(numLit(0), lengthAtLeast1)?.code).toBe(
      "nudo:constraint-unproven",
    );
  });

  it("字符串字面量 × length(s) ≥ 1 ⇒ 按长度语义裁决", () => {
    expect(checkArg(strLit("ab"), lengthAtLeast1)).toBeUndefined();
    expect(checkArg(strLit(""), lengthAtLeast1)?.code).toBe(
      "nudo:constraint-violated",
    );
  });

  it("纯 var 左项的数值比较语义不变", () => {
    expect(checkArg(numLit(3), ge(v("s"), lit(1)))).toBeUndefined();
    expect(checkArg(numLit(0), ge(v("s"), lit(1)))?.code).toBe(
      "nudo:constraint-violated",
    );
  });
});

/**
 * **手写纯数据约束**直接塞 `app(length, …)`（`__nudoConstraint` 纯数据形态，
 * 不经构建器 ⇒ 构造期门禁管不到）。产品路径的**参数通道**（`checkReqs` 的
 * 数值界分支）此前会在 `argLen` 不可判时把 `length(x) ≥ n` 当普通数值比较
 * ⇒ 数字 3 判「满足」（假绿）、数字 0 判「违例」（假红）。
 */
describe("BUG-211 —— 手写数据约束的 length 谓词：参数通道不得当数值比较", () => {
  const RAW = (prim: string): string =>
    `{ __nudoConstraint: true, prim: "${prim}", preds: [{ op: "ge", a: { op: "app", fn: "length", args: [{ op: "var", id: "__nudo_self__" }] }, b: { op: "lit", value: 1 } }] }`;
  const SIDE_RAW = `export const cStrLen = ${RAW("string")};
export const cNumLen = ${RAW("number")};
`;
  function checkRaw(src: string) {
    const imp = `/// @nudo:import { cStrLen, cNumLen } from "./std.nudo.js"\n`;
    return checkSource("/t/raw.js", imp + src, pTrue, sidecarOpts("std.nudo", SIDE_RAW));
  }

  it("数字实参：3 与 0 都不落进数值比较（0 不再假红）", () => {
    for (const argLit of ["3", "0"]) {
      const r = checkRaw(`/** @nudo:contract x cNumLen */
export function fNum(x) { return x; }
fNum(${argLit});
`);
      expect(paramViolations(r), `fNum(${argLit})`).toEqual([]);
    }
  });

  it("字符串实参：参数位按长度语义裁决（'ab' 放行 / '' 违例）", () => {
    const ok = checkRaw(`/** @nudo:contract s cStrLen */
export function fStr(s) { return s; }
fStr("ab");
`);
    const bad = checkRaw(`/** @nudo:contract s cStrLen */
export function fStr(s) { return s; }
fStr("");
`);
    expect(paramViolations(ok)).toEqual([]);
    expect(paramViolations(bad)).toHaveLength(1);
    expect(paramViolations(bad)[0]!.expected).toContain("length(s) ≥ 1");
  });

  it("与返回位同结论（字符串长度链：'ab' 两通道放行 / '' 两通道违例）", () => {
    const ok = checkRaw(`/** @nudo:contract return cStrLen */
export function gStr() { return "ab"; }
`);
    const bad = checkRaw(`/** @nudo:contract return cStrLen */
export function gStr() { return ""; }
`);
    expect(returnViolations(ok)).toEqual([]);
    expect(returnViolations(bad)).toHaveLength(1);
    // 与参数位同结论（长度可判时两通道一致）
    expect(returnViolations(bad).length > 0).toBe(
      paramViolations(
        checkRaw(`/** @nudo:contract s cStrLen */
export function fStr(s) { return s; }
fStr("");
`),
      ).length > 0,
    );
  });
});
