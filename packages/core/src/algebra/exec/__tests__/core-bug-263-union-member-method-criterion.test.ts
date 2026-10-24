/**
 * Bug 263：core 的 **union 方法分派**用 `memberLikelyHasMethod` 过滤成员，
 * 而该判据**只认 `string`**（`method` 形参根本没被使用）。
 *
 * 原生：`u.m()`（u : string | number）逐成员按**该成员自己的原型面**解析
 * `m`——number 侧有 toFixed / toPrecision / toExponential ⇒ 跑出值；string
 * 侧没有 ⇒ 该分支调用 undefined ⇒ **定抛 TypeError**。
 *
 * 引擎此前：
 * - number 成员被**无条件排除** ⇒ 值域塌成 unknown（且 L2 门禁把「成员
 *   不支持该方法」误报成「成员缺方法」——诊断点名的是 string 侧）；
 * - string 成员被**无条件放行** ⇒ string 上不存在的方法也被判「有」⇒
 *   派发到 string 成员 ⇒ 报「missing on string receiver」。
 *
 * 钉：改前 union-toFixed 的值 = unknown + 误导诊断（点名 string 侧）；
 * union-toUpperCase 无 throws 记录（假绿）。
 */
import { describe, it, expect } from "vitest";
import { call, effects } from "../../__tests__/eval-helpers.ts";
import { litValue, anyAbs } from "../../abs.ts";
import { runTranspiled, callTranspiledExportFull } from "../run.ts";

/** 以 any 实参调用导出函数（抽象实参 ⇒ 逼出 union 分支） */
function callAny(src: string, fn: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fn, [anyAbs]);
}

describe("Bug 263: union 成员按方法名判定（prim 原型方法表）", () => {
  it("number 侧成员不再被排除：pick(y).toFixed() 的值是 number 分支结果（native \"1\"）", () => {
    const rec = callAny(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useNum(y) { return pick(y).toFixed(); }`,
      "useNum",
    );
    const r = litValue(rec.result);
    if (!r.ok) {
      throw new Error(
        `expected literal "1" (number 分支的 toFixed 结果), got non-literal result`,
      );
    }
    expect(r.value).toEqual("1");
  });

  it("string 侧缺该方法 ⇒ 该分支记 TypeError may-throw（原生该分支定抛）", () => {
    const eff = effects(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useNum(y) { return pick(y).toFixed(); }`,
      "useNum",
    );
    expect(eff).toContain("TypeError");
  });

  it("number 侧缺该方法（toUpperCase）⇒ 同样记 TypeError may-throw（改前无记录 = 假绿）", () => {
    const eff = effects(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useUp(y) { return pick(y).toUpperCase(); }`,
      "useUp",
    );
    expect(eff).toContain("TypeError");
  });

  it("两侧都有该方法（toString）⇒ 不记 throws，值域是两侧的并", () => {
    const eff = effects(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useStr(y) { return pick(y).toString(); }`,
      "useStr",
    );
    expect(eff).not.toContain("TypeError");
    const rec = callAny(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useStr(y) { return pick(y).toString(); }`,
      "useStr",
    );
    // 两侧结果 "1" | "a" ⇒ 并集形态（sum），不是 unknown
    expect(rec.result.shape.k).toEqual("sum");
  });

  it("control：字面量 number 的 toFixed 仍是精确值（native \"1\"）", () => {
    const r = litValue(call(`export function f() { return (1).toFixed(); }`, "f").result);
    expect(r.ok).toBe(true);
    expect(r.ok ? r.value : undefined).toEqual("1");
  });

  it("control：字面量 string 的 toFixed 记 TypeError may-throw（原生定抛）", () => {
    const eff = effects(`export function f() { return ("a").toFixed(); }`, "f");
    expect(eff).toContain("TypeError");
  });
});
