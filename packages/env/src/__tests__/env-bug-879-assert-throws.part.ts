/**
 * Bug 879 — env 的 `node:assert` 族**建模成永不抛** ⇒ L2 门禁**假绿**。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测）：
 *   ok(false)                  ⇒ 抛 AssertionError（ERR_ASSERTION）
 *   ok(0) / ok(undefined)       ⇒ 抛 AssertionError
 *   ok(true) / ok(1)           ⇒ 不抛
 *   strictEqual(1, 2)          ⇒ 抛 AssertionError
 *   strictEqual(1, 1)          ⇒ 不抛
 *   deepStrictEqual({a:1},{a:1}) ⇒ 不抛；{a:1} vs {a:2} ⇒ 抛 AssertionError
 *   notStrictEqual(1, 1)       ⇒ 抛 AssertionError；notStrictEqual(1, 2) ⇒ 不抛
 *   match("abc", /b/)          ⇒ 不抛；match("abc", /z/) ⇒ 抛 AssertionError
 *   fail() / fail("boom")      ⇒ **恒抛** AssertionError
 *   strictEqual(1)（缺参）      ⇒ 抛 TypeError [ERR_MISSING_ARGS]（**不是** AssertionError）
 *
 * 旧实现：六个函数全是 relation 面（**恒不抛**）⇒ 六个必抛入口一次放行（假绿）。
 *
 * 新建模（走 core 的 throws 通道）：
 * - 实参可判定且断言**失败** ⇒ **必抛**（abs 面 = never + AssertionError）；
 * - 实参可判定且断言**成立** ⇒ **零抛**（裸 Abs 返回）；
 * - 实参**判不出**（抽象值 / 抽象 pattern）⇒ **may-throw**（原生在该域上确实可能抛）。
 *
 * 断言双向：正向钉住「失败必抛 / 成立零抛 / 抽象 may-throw」；
 * 反向（把 apply 改回旧的 `undefined` 回落）本文件必须失败。
 */
import { describe, it, expect } from "vitest";
import {
  ok as nodeOk,
  strictEqual as nodeStrictEqual,
  fail as nodeFail,
} from "node:assert";
import { boolLit, numLit, strLit, type Abs } from "@nudojs/core";
import { brandOf, objAbs, prim } from "../abs-helpers.ts";
import { defineEnv } from "../node.ts";
import { brandName, callSite, thrownBrand } from "./env-bug-s4-helpers.ts";

const env = defineEnv();
const assertMod = env.modules!.assert!;

/** RegExp brand（引擎里正则字面量就是这个形状：source / flags 槽） */
function regexpOf(source: string, flags = ""): Abs {
  return brandOf("RegExp", objAbs({ source: strLit(source), flags: strLit(flags) }));
}

/** 抽象值（判不出真值 / 相等性） */
const ABSTRACT = prim.str();

/** 原生 oracle：调用 fn，取原生抛出的错误名（不抛 ⇒ undefined） */
function nativeErrorName(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as Error).name;
  }
}

describe("Bug 879 · node:assert 族有真实 throws 面", () => {
  it("1. ok(false) ⇒ 必抛 AssertionError（旧实现恒不抛）", () => {
    // 原生 oracle：ok(false) 抛 AssertionError
    expect(nativeErrorName(() => nodeOk(false))).toBe("AssertionError");
    const site = callSite(assertMod.ok!, [boolLit(false)]);
    expect(site.threw, "ok(false) must throw (always-throw)").toBeTruthy();
    expect(thrownBrand(site.threw)).toBe("AssertionError");
    expect(site.exits).toHaveLength(0);
  });

  it("2. ok(true) ⇒ 零抛（断言成立）", () => {
    const site = callSite(assertMod.ok!, [boolLit(true)]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
  });

  it("3. ok(抽象值) ⇒ may-throw AssertionError（原生在该域上确实可能抛）", () => {
    const site = callSite(assertMod.ok!, [ABSTRACT]);
    expect(site.threw, "abstract arg must not be a hard throw").toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("AssertionError");
  });

  it("4. strictEqual(1, 2) ⇒ 必抛 AssertionError；strictEqual(1, 1) ⇒ 零抛", () => {
    const bad = callSite(assertMod.strictEqual!, [numLit(1), numLit(2)]);
    expect(bad.threw).toBeTruthy();
    expect(thrownBrand(bad.threw)).toBe("AssertionError");

    const good = callSite(assertMod.strictEqual!, [numLit(1), numLit(1)]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("5. deepStrictEqual ⇒ 结构判定：相等零抛 / 不等必抛", () => {
    const same = callSite(assertMod.deepStrictEqual!, [
      objAbs({ a: numLit(1) }),
      objAbs({ a: numLit(1) }),
    ]);
    expect(same.threw).toBeUndefined();
    expect(same.exits).toHaveLength(0);

    const diff = callSite(assertMod.deepStrictEqual!, [
      objAbs({ a: numLit(1) }),
      objAbs({ a: numLit(2) }),
    ]);
    expect(diff.threw).toBeTruthy();
    expect(thrownBrand(diff.threw)).toBe("AssertionError");
  });

  it("6. notStrictEqual ⇒ 相等必抛 / 不等零抛", () => {
    const same = callSite(assertMod.notStrictEqual!, [numLit(1), numLit(1)]);
    expect(same.threw).toBeTruthy();
    expect(thrownBrand(same.threw)).toBe("AssertionError");

    const diff = callSite(assertMod.notStrictEqual!, [numLit(1), numLit(2)]);
    expect(diff.threw).toBeUndefined();
    expect(diff.exits).toHaveLength(0);
  });

  it("7. match ⇒ pattern 可判定时精确判定：命中零抛 / 不命中必抛", () => {
    const hit = callSite(assertMod.match!, [strLit("abc"), regexpOf("b")]);
    expect(hit.threw).toBeUndefined();
    expect(hit.exits).toHaveLength(0);

    const miss = callSite(assertMod.match!, [strLit("abc"), regexpOf("z")]);
    expect(miss.threw).toBeTruthy();
    expect(thrownBrand(miss.threw)).toBe("AssertionError");
  });

  it("8. fail() ⇒ 恒抛 AssertionError", () => {
    // 原生 oracle：fail() 恒抛
    expect(nativeErrorName(() => nodeFail("boom"))).toBe("AssertionError");
    const site = callSite(assertMod.fail!, []);
    expect(site.threw).toBeTruthy();
    expect(thrownBrand(site.threw)).toBe("AssertionError");
  });

  it("9. strictEqual 缺参 ⇒ 必抛 TypeError（原生 ERR_MISSING_ARGS，不是 AssertionError）", () => {
    // 原生 oracle：strictEqual(1) 缺参 ⇒ TypeError（不是 AssertionError）
    expect(nativeErrorName(() => (nodeStrictEqual as (a: unknown, b?: unknown) => void)(1))).toBe(
      "TypeError",
    );
    const site = callSite(assertMod.strictEqual!, [numLit(1)]);
    expect(site.threw).toBeTruthy();
    expect(thrownBrand(site.threw)).toBe("TypeError");
  });
});
