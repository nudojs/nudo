/**
 * Bug 1112 —— `fn()` 缺少**字段表实参守卫**（Bug 352 / 353 同源）。
 *
 * 缺陷：
 * - `fn()`（缺参）⇒ 宿主 `Object.entries(undefined)` 抛
 *   "Cannot convert undefined or null to object" ⇒ **宿主原文泄进产品诊断**
 *   （用户看不懂、也不是 Nudo 诊断）。
 * - `fn(42)`（非对象）⇒ `Object.entries(42)` ⇒ `{}` ⇒ 契约被**静默削弱成空参表**
 *   （门禁零诊断 = 假绿：用户以为声明了参数约束，其实一条都没生效）。
 *
 * 修法：复用 `constraint.ts` 里 `shape()` 用的 `requireFieldsObject("fn", …)`
 * —— 缺参 / 非对象都**点名构造器 + 说明缺参**，宿主原文不进产品。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fn, number } from "../index.ts";
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

describe("Bug 1112 —— fn() 字段表实参守卫", () => {
  it("fn() 缺参 ⇒ 点名构造器报错，不泄露宿主原文", () => {
    let err: unknown;
    try {
      (fn as unknown as () => unknown)();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("fn()");
    expect(msg).not.toContain("Cannot convert undefined or null to object");
  });

  it("fn(42) 非对象 ⇒ 报错（不再静默变成 fn({})）", () => {
    let err: unknown;
    try {
      (fn as unknown as (x: unknown) => unknown)(42);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("fn()");
    expect(msg).not.toContain("Cannot convert undefined or null to object");
  });

  it("fn(null) ⇒ 报错", () => {
    expect(() => (fn as unknown as (x: unknown) => unknown)(null)).toThrow(/fn\(\)/);
  });

  it("fn({ id: number() }) 正常构造（负控制）", () => {
    expect(() => fn({ id: number() })).not.toThrow();
  });
});
