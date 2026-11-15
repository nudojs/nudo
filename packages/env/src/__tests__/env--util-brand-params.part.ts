/**
 * Bug 882 — `node:util` 的**品牌形参**函数（promisify / callbackify / inherits /
 * isDeepStrictEqual）在**具名导入**调用下 ⇒ L2 门禁**假红**（原生必不抛）。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测）：
 *   promisify(readFile) / callbackify(asyncFn) / inherits(Sub, Object) /
 *   isDeepStrictEqual({a:1},{a:1}) —— **一个都不抛**。
 *
 * 旧实现：这四个函数是 relation 面 ⇒ 调用走 core 的 relation 实例化
 * （`bindTypeVars` 做类型变量绑定）。**具名导入**调用时实参可能是**裸宿主值**
 * （宿主函数 / 用户函数声明）⇒ 品牌形参参与绑定时会在代数解引用点炸掉 ⇒
 * 上层记「可能抛 TypeError」⇒ L2 门禁假红（同一函数**成员调用**却完全正常）。
 *
 * 本文件钉的是 **env 侧**那一半（core 侧由 S6 负责：调用面实参归一化 +
 * 绑定保护）：
 * - 这四个函数走 **apply 面** ⇒ **不进入 relation 实例化** ⇒ 品牌形参
 *   **不参与类型变量绑定**（建模侧规避，不依赖实参是否已被归一化）；
 * - 签名面（paramTypes / returnType）**不变** ⇒ format 仍是
 *   "(Function, Function) => undefined" 这类干净文本。
 *
 * 断言双向：正向钉住「有 apply + 裸宿主实参不炸 + 签名不变」；
 * 反向（把 apply 去掉、改回 relation 面）本文件必须失败。
 */
import { describe, it, expect } from "vitest";
import { inherits as nodeInherits, promisify as nodePromisify } from "node:util";
import { readFile } from "node:fs";
import { formatShape, getFnImpl, type Abs } from "@nudojs/core";
import { defineEnv } from "../node.ts";
import { brandName, callSite } from "./env-bug-s4-helpers.ts";

const env = defineEnv();
const util = env.modules!.util!;

/** 裸宿主函数（**不是** Abs）——具名导入调用时引擎拿到的就是这种实参 */
const HOST_FN = function Sub(): void {};

describe("Bug 882 · node:util 品牌形参不参与类型变量绑定（env 侧）", () => {
  it("1. 四个品牌形参函数都走 apply 面 ⇒ 不进 relation 实例化", () => {
    for (const fn of [util.promisify, util.callbackify, util.inherits, util.isDeepStrictEqual]) {
      expect(fn, "node:util member must exist").toBeTruthy();
      expect(
        getFnImpl(fn!)?.apply,
        "brand-param util fn must take the apply path (no type-var binding)",
      ).toBeTypeOf("function");
    }
  });

  it("2. 裸宿主实参 ⇒ 不炸、不记 may-throw、返回值仍是声明面", () => {
    const inheritsSite = callSite(util.inherits!, [HOST_FN as unknown as Abs, HOST_FN as unknown as Abs]);
    expect(inheritsSite.threw, "inherits must not blow up on a raw host fn").toBeUndefined();
    expect(inheritsSite.exits).toHaveLength(0);
    expect(formatShape(inheritsSite.value!)).toBe("undefined");

    const promisifySite = callSite(util.promisify!, [HOST_FN as unknown as Abs]);
    expect(promisifySite.threw).toBeUndefined();
    expect(promisifySite.exits).toHaveLength(0);
    expect(formatShape(promisifySite.value!)).toBe("PromiseFn");

    const callbackifySite = callSite(util.callbackify!, [HOST_FN as unknown as Abs]);
    expect(callbackifySite.threw).toBeUndefined();
    expect(callbackifySite.exits).toHaveLength(0);
    expect(formatShape(callbackifySite.value!)).toBe("CallbackFn");

    const deepSite = callSite(util.isDeepStrictEqual!, [
      HOST_FN as unknown as Abs,
      HOST_FN as unknown as Abs,
    ]);
    expect(deepSite.threw).toBeUndefined();
    expect(deepSite.exits).toHaveLength(0);
    expect(formatShape(deepSite.value!)).toBe("boolean");
  });

  it("3. 签名面不变（品牌形参仍在签名里，format 干净）", () => {
    expect(formatShape(util.inherits!)).toBe("(Function, Function) => undefined");
    expect(formatShape(util.promisify!)).toBe("(CallbackFn) => PromiseFn");
    expect(formatShape(util.callbackify!)).toBe("(PromiseFn) => CallbackFn");
    expect(formatShape(util.isDeepStrictEqual!)).toBe("(Value, Value) => boolean");
    // format 不得漏出 unknown / any（产品语义：unknown = 推断失败）
    for (const fn of [util.inherits!, util.promisify!, util.callbackify!, util.isDeepStrictEqual!]) {
      expect(formatShape(fn)).not.toMatch(/(^|[^\w])(unknown|any)([^\w]|$)/);
    }
  });

  it("4. 原生 oracle：inherits / promisify 都不抛", () => {
    // 原生：inherits(Sub, Object) 与 promisify(readFile) 都不抛
    expect(() => nodeInherits(HOST_FN, Object)).not.toThrow();
    expect(() => nodePromisify(readFile)).not.toThrow();
  });

  it("5. 反向对照：品牌形参的 throws 面不得凭空出现（旧假红路径）", () => {
    const site = callSite(util.inherits!, [HOST_FN as unknown as Abs, HOST_FN as unknown as Abs]);
    expect(site.exits).toHaveLength(0);
    expect(brandName(site.exits[0])).toBeUndefined();
  });
});
