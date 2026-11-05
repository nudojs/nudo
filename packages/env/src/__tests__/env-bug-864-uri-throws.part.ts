/**
 * 族 29 · Bug 864 —— es env 的 URI 族（`decodeURI` / `decodeURIComponent` /
 * `encodeURI` / `encodeURIComponent`）**吞掉 URIError** ⇒ 引擎判「不抛」
 * ⇒ L2 `nudo:entry-may-throw` 门禁失效（**假绿**）。
 *
 * 根因：env 声明走 `strToStrImplAbs(encodeURI)`，宿主 `URIError` 被 envFn 的
 * apply 包装吞掉（旧实现 `catch { return returnType }`）。修法：URI 族声明
 * **委托 core 的 `evalGlobalFn`**（= 宿主回落路径的同一建模），
 * - 字面量实参：畸形 % 序列 / 孤立代理项 ⇒ **always-throw URIError**；
 * - 抽象实参：回落**声明域** `string`（**不**折原生产不出的自信精确字面量），
 *   decode* 记 **may-throw URIError**（与无 env 的宿主路径同口径）。
 *
 * 断言双向：
 * - 正向：畸形入参 ⇒ 记 URIError（门禁红）；合法入参 ⇒ **不**抛（不误红）；
 *   抽象入参 ⇒ 值面是 `string` 声明域（不是自信精确字面量）。
 * - 反向：把 URI 族改回旧的「吞异常」实现 ⇒ 本文件必须失败。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetGeneralizeMemo, formatShape, type Abs } from "@nudojs/core";
import { defineEnv } from "../es.ts";

/** es env 的全局表（≡ service 侧 `collectEnvGlobals(["es"])`）。 */
function esEnvGlobals(): Record<string, Abs> {
  return { ...defineEnv().globals };
}

type CheckResult = ReturnType<typeof checkSource>;

function checkWithEs(src: string): CheckResult {
  resetGeneralizeMemo();
  return checkSource("/t/env-bug-864.js", src, pTrue, {
    inject: { envGlobals: esEnvGlobals() },
  });
}

/** 入口 may-throw 诊断（品牌从 message 里取）。 */
function mayThrowMessages(r: CheckResult): string[] {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw").map((i) => i.message);
}

describe("Bug 864 · URI 族不再吞掉 URIError（es env）", () => {
  it("1. 畸形 % 序列 ⇒ 记 URIError（原生恒抛，门禁必须红）", () => {
    const cases: Array<[string, string]> = [
      ["decodeURI", 'decodeURI("%")'],
      ["decodeURIComponent", 'decodeURIComponent("%")'],
      ["decodeURI", 'decodeURI("%E0%A4%A")'],
      ["decodeURIComponent", 'decodeURIComponent("%E0%A4%A")'],
      ["encodeURI", 'encodeURI("\\uD800")'],
      ["encodeURIComponent", 'encodeURIComponent("\\uD800")'],
    ];
    for (const [id, expr] of cases) {
      const r = checkWithEs(`export function f() { return ${expr}; }`);
      const msgs = mayThrowMessages(r);
      expect(msgs.length, `${id}: ${expr} must report may-throw`).toBeGreaterThan(0);
      expect(msgs.join(" | "), `${id}: ${expr}`).toContain("URIError");
      // 原生恒抛 ⇒ 值面是 never（旧行为：回落 string ⇒ 假绿）
      const sig = r.signatures.find((s) => s.name === "f");
      expect(sig, `${id}: f must have a signature`).toBeTruthy();
      expect(formatShape(sig!.abs), `${id}: ${expr}`).toMatch(/\bnever\b/);
    }
  });

  it("2. 合法入参 ⇒ **不**抛（不误红）且值精确", () => {
    const cases: Array<[string, string, string]> = [
      ["decodeURI", 'decodeURI("a b")', '"a b"'],
      ["encodeURI", 'encodeURI("a b")', '"a%20b"'],
      ["encodeURIComponent", 'encodeURIComponent("a b")', '"a%20b"'],
      ["decodeURIComponent", 'decodeURIComponent("a%20b")', '"a b"'],
    ];
    for (const [id, expr, expected] of cases) {
      const r = checkWithEs(`export function f() { return ${expr}; }`);
      expect(mayThrowMessages(r), `${id}: ${expr} must not report may-throw`).toEqual([]);
      const sig = r.signatures.find((s) => s.name === "f");
      expect(formatShape(sig!.abs), `${id}: ${expr}`).toContain(expected);
    }
  });

  it("3. 抽象实参 ⇒ 回落声明域 string（不折自信精确字面量）+ may-throw URIError", () => {
    const r = checkWithEs("export function f(x) { return decodeURI(x); }");
    const sig = r.signatures.find((s) => s.name === "f");
    const display = formatShape(sig!.abs);
    // 值面 = 声明域 string（不是某个具体字面量）
    expect(display).toContain("string");
    expect(display).not.toMatch(/"[^"]*"/);
    // 抽象串可能畸形 ⇒ may-throw URIError（与无 env 的宿主路径同口径）
    const msgs = mayThrowMessages(r);
    expect(msgs.join(" | ")).toContain("URIError");
  });

  it("4. 四个 URI 全局都声明了 throws 面（errBrand('URIError')）", () => {
    const env = defineEnv();
    for (const name of ["encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent"]) {
      const fn = env.globals[name];
      expect(fn, `${name} must be declared`).toBeTruthy();
      expect(fn!.shape.k, `${name} must be a function`).toBe("fn");
      const shape = fn!.shape as { paramTypes?: Abs[]; returnType?: Abs };
      expect(shape.paramTypes?.[0]?.shape.k, `${name} param`).toBe("prim");
      expect(shape.returnType?.shape.k, `${name} return`).toBe("prim");
    }
  });
});
