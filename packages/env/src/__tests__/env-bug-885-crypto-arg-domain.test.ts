/**
 * Bug 885 — `@nudo:env node` 的 `node:crypto` 族**实参域抛错全缺** ⇒ L2 门禁**假绿**
 *（一次放行五个必抛入口）。
 *
 * 原生 oracle（Node v26.10.0 **独立进程**逐个实测，**不猜**）：
 *   createHash("nope")              ⇒ 抛 **Error**（"Digest method not supported"）
 *   createHash("sha256")            ⇒ 不抛
 *   randomBytes(-1)                 ⇒ 抛 **RangeError**（ERR_OUT_OF_RANGE；size ∈ [0, 2^31-1]）
 *   randomBytes(8)                  ⇒ 不抛
 *   randomInt(5, 1)                 ⇒ 抛 **RangeError**（ERR_OUT_OF_RANGE；max 必须 > min）
 *   randomInt(1, 5)                 ⇒ 不抛
 *   pbkdf2Sync("p","s",0,8,"sha256") ⇒ 抛 **RangeError**（iterations ∈ [1, 2^31-1]）
 *   pbkdf2Sync("p","s",1,8,"sha256") ⇒ 不抛
 *   timingSafeEqual(Buffer.alloc(1), Buffer.alloc(2))
 *                                    ⇒ 抛 **RangeError**（ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH）
 *
 * 旧实现：五个入口全是 relation 面（**恒不抛**）⇒ 五个必抛入口一次放行（假绿）。
 *
 * 新建模（走 core 的 throws 通道）：
 * - 实参**可判定**且越界 ⇒ **必抛**（abs 面 = never + 对应错误品牌）；
 * - 实参**抽象** ⇒ **may-throw**（原生在该域上确实可能抛）；
 * - 落在合法域 ⇒ **零抛**。
 *
 * 断言双向：正向钉住「越界必抛 / 合法零抛 / 抽象 may-throw」；
 * 反向（把 apply 去掉、改回恒不抛的 relation 面）本文件必须失败。
 */
import { describe, it, expect } from "vitest";
import {
  createHash as nodeCreateHash,
  pbkdf2Sync as nodePbkdf2Sync,
  randomBytes as nodeRandomBytes,
  randomInt as nodeRandomInt,
  timingSafeEqual as nodeTimingSafeEqual,
} from "node:crypto";
import { numLit, strLit, type Abs } from "@nudojs/core";
import { prim } from "../abs-helpers.ts";
import { defineEnv } from "../node.ts";
import { brandName, callSite } from "./env-bug-s4-helpers.ts";

const env = defineEnv();
const cryptoMod = env.modules!.crypto!;

/** 原生 oracle：调用 fn，取原生抛出的错误名（不抛 ⇒ undefined） */
function nativeErrorName(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as Error).name;
  }
}

describe("Bug 885 · node:crypto 族有实参域 throws 面", () => {
  it("1. createHash：不支持的算法名 ⇒ 必抛 Error（旧实现恒不抛）", () => {
    expect(nativeErrorName(() => nodeCreateHash("nope"))).toBe("Error");
    const bad = callSite(cryptoMod.createHash!, [strLit("nope")]);
    expect(bad.threw, "unsupported digest must be an always-throw").toBeTruthy();
    expect(brandName((bad.threw as { absValue: Abs }).absValue)).toBe("Error");

    const good = callSite(cryptoMod.createHash!, [strLit("sha256")]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("2. randomBytes：size 越界 ⇒ 必抛 RangeError；合法 size 零抛", () => {
    expect(nativeErrorName(() => nodeRandomBytes(-1))).toBe("RangeError");
    const bad = callSite(cryptoMod.randomBytes!, [numLit(-1)]);
    expect(bad.threw).toBeTruthy();
    expect(brandName((bad.threw as { absValue: Abs }).absValue)).toBe("RangeError");

    const good = callSite(cryptoMod.randomBytes!, [numLit(8)]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("3. randomInt：max <= min ⇒ 必抛 RangeError；合法区间零抛", () => {
    expect(nativeErrorName(() => nodeRandomInt(5, 1))).toBe("RangeError");
    const bad = callSite(cryptoMod.randomInt!, [numLit(5), numLit(1)]);
    expect(bad.threw).toBeTruthy();
    expect(brandName((bad.threw as { absValue: Abs }).absValue)).toBe("RangeError");

    const good = callSite(cryptoMod.randomInt!, [numLit(1), numLit(5)]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("4. pbkdf2Sync：iterations = 0 ⇒ 必抛 RangeError；合法参数零抛", () => {
    expect(nativeErrorName(() => nodePbkdf2Sync("p", "s", 0, 8, "sha256"))).toBe("RangeError");
    const bad = callSite(cryptoMod.pbkdf2Sync!, [
      strLit("p"),
      strLit("s"),
      numLit(0),
      numLit(8),
      strLit("sha256"),
    ]);
    expect(bad.threw).toBeTruthy();
    expect(brandName((bad.threw as { absValue: Abs }).absValue)).toBe("RangeError");

    const good = callSite(cryptoMod.pbkdf2Sync!, [
      strLit("p"),
      strLit("s"),
      numLit(1),
      numLit(8),
      strLit("sha256"),
    ]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("5. timingSafeEqual：长度不等 ⇒ RangeError（env 的 Buffer 面不建模长度 ⇒ may-throw）", () => {
    expect(
      nativeErrorName(() => nodeTimingSafeEqual(Buffer.alloc(1), Buffer.alloc(2))),
    ).toBe("RangeError");
    const site = callSite(cryptoMod.timingSafeEqual!, [
      env.globals.Buffer as Abs,
      env.globals.Buffer as Abs,
    ]);
    expect(site.threw, "undecidable length must not be a hard throw").toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("RangeError");
  });

  it("6. 抽象实参 ⇒ may-throw（原生在该域上确实可能抛）", () => {
    const site = callSite(cryptoMod.createHash!, [prim.str()]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("Error");
  });
});
