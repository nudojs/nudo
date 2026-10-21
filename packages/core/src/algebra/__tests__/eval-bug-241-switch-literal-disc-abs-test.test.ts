/**
 * Bug 241 回归（core 运行时）：`$switch` 在「**字面量判别式 + 非字面量 case
 * 测试**」下不得把该臂整条丢弃。
 *
 * 修复前：判别式是字面量（`switch (true)`）时走「严格相等匹配」路径，只有
 * **case 测试本身也是字面量**的臂才可能被比较；`case x > 0:` 这类臂的测试
 * 是抽象值 ⇒ 该臂**永不命中** ⇒ 臂内返回值从返回域/签名里彻底消失：
 *   - 签名谎报：`switch (true) { case x > 0: return 0; default: return 1; }`
 *     的返回域原生是 `0 | 1`，引擎只给 `1`；
 *   - L1 门禁假绿：契约 `return number().gt(0)` 被判「满足」（原生在 x=5 时
 *     返回 0 ⇒ 真实违约）。
 *
 * 修复后：非字面量 case 测试 ⇒ **分叉**（命中该臂 / 不命中继续后续臂与
 * default），两路结果并入返回域 ⇒ 签名诚实 + 违约被报出。
 *
 * 负控制钉住：① 全字面量 case 的 switch 仍精确匹配（不进入分叉）；
 * ② 同语义的 if 写法结论不变；③ 抽象判别式（switch (x)）路径不变；
 * ④ 非字面量 case 测试的**值**求值仍按序惰性（Bug 168 口径）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { abs, litValue } from "../abs.ts";
import { pTrue } from "../pred.ts";
import { formatAbs } from "../format.ts";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";

/** 抽象 number 判别值（非字面量） */
const NUMBER_ABS = abs({ k: "prim", type: "number" }, undefined, pTrue, "exact");

/** 引擎返回域（formatAbs 渲染） */
function domain(src: string, arg: unknown): string {
  const r = call(src, "f", [arg as never]);
  return formatAbs(r.result as never);
}

/** L1 契约门禁：sidecar 声明 `f: (x: number) => number().gt(0)` */
function checkSwitch(src: string, file: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(
    file,
    src,
    pTrue,
    {
      loadModule: (spec: string): string | undefined =>
        spec.includes("s241")
          ? `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number() }, number().gt(0));\n`
          : undefined,
      fromFile: file,
    },
  );
}

describe("Bug 241: 字面量判别式 + 非字面量 case 测试 ⇒ 该臂不得被丢弃", () => {
  it("返回域含被丢掉的分支（0 | 1）", () => {
    const src = `export function f(x) { switch (true) { case x > 0: return 0; default: return 1; } }`;
    const d = domain(src, NUMBER_ABS);
    expect(d).toContain("0");
    expect(d).toContain("1");
  });

  it("返回域含被丢掉的分支（无 default ⇒ 隐式 no-match 臂）", () => {
    const src = `export function f(x) { switch (true) { case x > 0: return 0; } }`;
    const d = domain(src, NUMBER_ABS);
    expect(d).toContain("0");
  });

  it("返回域含多个非字面量 case 臂", () => {
    const src = `export function f(x) { switch (true) { case x > 0: return 0; case x < 0: return 2; default: return 1; } }`;
    const d = domain(src, NUMBER_ABS);
    expect(d).toContain("0");
    expect(d).toContain("1");
    expect(d).toContain("2");
  });

  it("L1 门禁：契约真实违约被报出（不再假绿）", () => {
    const src = `export function f(x) {
  switch (true) {
    case x > 0:
      return 0;
    default:
      return 1;
  }
}`;
    const r = checkSwitch(src, "/t/s241-switch.js");
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  });

  // --- 负控制 ---------------------------------------------------------
  it("负控制：全字面量 case 的 switch 仍精确匹配（返回域不含未命中臂）", () => {
    const src = `export function f(x) { switch (x) { case 1: return "one"; case 2: return "two"; default: return "other"; } }`;
    const r = call(src, "f", [NUMBER_ABS]);
    const lv = litValue(r.result);
    // 抽象判别式 ⇒ 抽象路径（全部臂参与）——行为与修复前一致
    expect(lv.ok).toBe(false);
  });

  it("负控制：同语义的 if 写法结论不变（同样报违约）", () => {
    const src = `export function f(x) {
  if (x > 0) {
    return 0;
  }
  return 1;
}`;
    const r = checkSwitch(src, "/t/s241-if.js");
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  });

  it("负控制：字面量判别式 + 字面量 case ⇒ 仍是精确命中（单一分支）", () => {
    const src = `export function f(x) { switch (true) { case true: return "t"; default: return "f"; } }`;
    const r = call(src, "f", [NUMBER_ABS]);
    const lv = litValue(r.result);
    expect(lv.ok).toBe(true);
    expect(lv.value).toBe("t");
  });

  it("负控制：非字面量 case 测试仍按序惰性求值（命中即停，Bug 168 口径）", () => {
    const src = `export function f(x) { let n = 0; switch (true) { case (n++, true): return n; default: return 0; } }`;
    const r = call(src, "f", [NUMBER_ABS]);
    const lv = litValue(r.result);
    expect(lv.ok).toBe(true);
    expect(lv.value).toBe(1);
  });
});
