/**
 * C7 类别判定 / Proxy 模型簇回归（Bug 105/106/108/122/123/124）。
 *
 * - Bug 105：抽象 bigint 的 Object.prototype.toString 折 "[object BigInt]"；
 *   bigint.toString 值读路由（字面量 radix 精确 / 越界 RangeError / 抽象
 *   bigint 返抽象 string）。
 * - Bug 106：bigint-ness 双侧判定（字面量 ∪ isBigPrim）——恰一侧 bigint 且
 *   另一侧已知非 bigint → 定抛 TypeError；b/0n、b%0n、b**-1n → RangeError；
 *   抽象混合 → recordMayThrow（effects 面）。
 * - Bug 108：借调内建原型方法不查 brand → Number/String/…/Map/Set 等
 *   brand-checking 原型按 home vs 接收者 brand 比对（异 brand 定抛）。
 * - Bug 122：new <proxy> 重入靶（construct 陷阱 / 缺省递归靶构造器）。
 * - Bug 123：typeof 代理 / instanceof 剥靶（fn 靶 → "function"）。
 * - Bug 124：对象级 Proxy 陷阱（deleteProperty/defineProperty/
 *   setPrototypeOf/preventExtensions/getPrototypeOf）——Object 版 falsy
 *   字面量定抛、Reflect 版返布尔、陷阱在场不动靶。
 *
 * 断言锚定原生语义（node v26 strict-mode 实测，tmp/probe/c7-verify.ts 差分
 * compared=73 mismatch=0）。抽象 bigint 用 BigInt(Date.now())（不可折字面量）；
 * BigInt("7") 会折 literal 7n，是字面量控制面。
 */
import { describe, expect, it } from "vitest";
import { call, effects, isNever, throwsError, val } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

/** 共享 val 的解包壳：值面断言直接锚字面量（throws/effects 面走 call/原生导出） */
const valv = (src: string) => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};

describe("Bug 105 抽象 bigint 的 Object.prototype.toString / toString", () => {
  it("抽象 bigint 经 Object.prototype.toString.call 折 \"[object BigInt]\"", () => {
    expect(
      valv(`export function f(){ const b = BigInt(Date.now()); return Object.prototype.toString.call(b); }`),
    ).toBe("[object BigInt]");
  });

  it("bigint 字面量同折 \"[object BigInt]\"（control）", () => {
    expect(valv(`export function f(){ return Object.prototype.toString.call(10n); }`)).toBe("[object BigInt]");
  });

  it("抽象 bigint toString 返抽象 string（非 exact 字面量）", () => {
    const r = call(`export function f(){ const b = BigInt(Date.now()); return b.toString(); }`).result;
    expect(r?.shape?.k).toBe("prim");
    expect((r?.shape as { type?: string }).type).toBe("string");
    expect(litValue(r).ok).toBe(false);
  });

  it("可折字面量 BigInt(\"7\") 的 toString 精确 \"7\"（control）", () => {
    expect(valv(`export function f(){ const b = BigInt("7"); return b.toString(); }`)).toBe("7");
  });

  it("字面量 bigint toString 精确（radix 缺省/16/undefined；越界 RangeError）", () => {
    expect(valv(`export function f(){ return (255n).toString(); }`)).toBe("255");
    expect(valv(`export function f(){ return (255n).toString(16); }`)).toBe("ff");
    expect(valv(`export function f(){ return (10n).toString(undefined); }`)).toBe("10");
    expect(throwsError(call(`export function f(){ return (10n).toString(1); }`).throws, "RangeError")).toBe(true);
    expect(throwsError(call(`export function f(){ return (10n).toString(37); }`).throws, "RangeError")).toBe(true);
  });

  it("抽象 bigint 抽象 radix → may RangeError 不折死（effects 面）", () => {
    expect(
      effects(`export function f(x){ const b = BigInt(Date.now()); return b.toString(x); }`),
    ).toContain("RangeError");
  });

  it("抽象 bigint toLocaleString 走 prim 通道（抽象 string）", () => {
    const r = call(`export function f(){ const b = BigInt(Date.now()); return b.toLocaleString(); }`).result;
    expect(r?.shape?.k).toBe("prim");
    expect((r?.shape as { type?: string }).type).toBe("string");
  });
});

describe("Bug 106 bigint-ness 双侧判定（字面量 ∪ isBigPrim）", () => {
  const bSrc = (expr: string) => `export function f(x){ const b = BigInt(Date.now()); return ${expr}; }`;

  it("抽象 bigint ⊕ 已知非 bigint → 定抛 TypeError（never + throws 面）", () => {
    for (const expr of ["b + 1", "1 + b", "b - 1", "b * 2", "b | 1", "b & 1", "b ^ 1", "b << 1", "b >> 1"]) {
      const r = call(bSrc(expr));
      expect(isNever(r.result), expr).toBe(true);
      expect(throwsError(r.throws, "TypeError"), expr).toBe(true);
    }
  });

  it("字符串侧走拼接臂不抛（原生 1n+\"s\"===\"1s\"；结果 string 面）（control）", () => {
    const r = call(bSrc(`b + "s"`));
    expect(r.result?.shape?.k).toBe("prim");
    expect((r.result?.shape as { type?: string }).type).toBe("string");
    expect(effects(bSrc(`b + "s"`))).not.toContain("TypeError");
  });

  it("b/0n、b%0n、b**-1n → 定抛 RangeError", () => {
    for (const expr of ["b / 0n", "b % 0n", "b ** -1n"]) {
      const r = call(bSrc(expr));
      expect(isNever(r.result), expr).toBe(true);
      expect(throwsError(r.throws, "RangeError"), expr).toBe(true);
    }
  });

  it("字面量双 bigint 幂负指数同抛 RangeError（control）", () => {
    expect(throwsError(call(`export function f(){ return 2n ** -1n; }`).throws, "RangeError")).toBe(true);
  });

  it("抽象混合（b ⊕ 无约束 x）→ recordMayThrow（effects 含 TypeError）", () => {
    for (const expr of ["b + x", "b - x", "b * x", "b / x", "b % x", "b ** x", "b | x"]) {
      expect(effects(bSrc(expr)), expr).toContain("TypeError");
    }
  });

  it("双 bigint 干净面：b + 1n / b * 3n / b ** 2n 不抛不记混型 TypeError", () => {
    // 注：RangeError 可能来自 BigInt(Date.now()) 本身（抽象 number 可能非
    // 整数，原生 may 抛）——非混型面，不在此断言
    for (const expr of ["b + 1n", "b * 3n", "b ** 2n", "b / 2n"]) {
      const r = call(bSrc(expr));
      expect(isNever(r.result), expr).toBe(false);
      expect(effects(bSrc(expr)), expr).not.toContain("TypeError");
    }
  });
});

describe("Bug 108 借调内建原型方法不查 brand", () => {
  it("异 brand 借调 brand-checking 原型 → 定抛 TypeError", () => {
    const rows = [
      `return Array.prototype.push.call("ab", 1);`,
      `return Number.prototype.toFixed.call("s");`,
      `return Map.prototype.get.call([], "a");`,
      `return Set.prototype.has.call({}, 1);`,
      `return Date.prototype.getTime.call("x");`,
    ];
    for (const body of rows) {
      const r = call(`export function f(){ ${body} }`);
      expect(throwsError(r.throws, "TypeError"), body).toBe(true);
      expect(isNever(r.result), body).toBe(true);
    }
  });

  it("nullish 接收者借调 → 定抛", () => {
    expect(throwsError(call(`export function f(){ return Array.prototype.push.call(null); }`).throws, "TypeError")).toBe(true);
  });

  it("同 brand 借调照常（control）", () => {
    expect(valv(`export function f(){ return Array.prototype.push.call([], 1); }`)).toBe(1);
    expect(valv(`export function f(){ return Map.prototype.get.call(new Map([["a", 1]]), "a"); }`)).toBe(1);
  });

  it("非 brand-checking 原型（Object.prototype）对任意对象接收者不抛（control）", () => {
    expect(valv(`export function f(){ return Object.prototype.hasOwnProperty.call([], "a"); }`)).toBe(false);
  });
});

describe("Bug 122 new <proxy> 重入靶", () => {
  it("无 construct 陷阱 → 递归靶构造器", () => {
    expect(
      valv(`export function f(){ const P = new Proxy(function A(){ this.x = 1; }, {}); return new P().x; }`),
    ).toBe(1);
  });

  it("construct 陷阱接管：收 (target, argsList, newTarget)", () => {
    expect(
      valv(`export function f(){ const P = new Proxy(function(){}, { construct(t, a, nt) { return { got: a[0], isFn: typeof t === "function", ntFn: typeof nt === "function" }; } }); const r = new P(42); return r.got + (r.isFn ? 10 : 0) + (r.ntFn ? 100 : 0); }`),
    ).toBe(152);
  });

  it("construct 陷阱返非对象 → 定抛 TypeError", () => {
    const r = call(`export function f(){ const P = new Proxy(function(){}, { construct() { return 1; } }); return new P(); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(isNever(r.result)).toBe(true);
  });
});

describe("Bug 123 typeof / instanceof 代理剥靶", () => {
  it("typeof fn 靶代理 → \"function\"；object 靶 → \"object\"", () => {
    expect(valv(`export function f(){ return typeof new Proxy(function(){}, {}); }`)).toBe("function");
    expect(valv(`export function f(){ return typeof new Proxy({}, {}); }`)).toBe("object");
  });

  it("instanceof 沿靶构造器判", () => {
    expect(valv(`export function f(){ return new Proxy(function(){}, {}) instanceof Function; }`)).toBe(true);
    expect(valv(`export function f(){ return new Proxy({}, {}) instanceof Object; }`)).toBe(true);
  });
});

describe("Bug 124 对象级 Proxy 陷阱派发", () => {
  it("deleteProperty 陷阱 falsy → strict delete 定抛；try/catch 捕获", () => {
    expect(
      valv(`export function f(){ const p = new Proxy({ a: 1 }, { deleteProperty() { return false; } }); try { delete p.a; return "ok"; } catch { return "c"; } }`),
    ).toBe("c");
  });

  it("deleteProperty 陷阱 falsy（表达式位 return delete p.a）→ 同抛", () => {
    const r = call(`export function f(){ const p = new Proxy({ a: 1 }, { deleteProperty() { return false; } }); return delete p.a; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(isNever(r.result)).toBe(true);
  });

  it("deleteProperty 陷阱 truthy → 不动靶（p.a 保留、\"a\" in p 保持 true）", () => {
    expect(
      valv(`export function f(){ const p = new Proxy({ a: 1 }, { deleteProperty(t, k) { return true; } }); delete p.a; return p.a; }`),
    ).toBe(1);
    expect(
      valv(`export function f(){ const p = new Proxy({ a: 1 }, { deleteProperty(t, k) { return true; } }); delete p.a; return "a" in p; }`),
    ).toBe(true);
  });

  it("Reflect.deleteProperty：陷阱 falsy → false 不抛；truthy → true", () => {
    expect(
      valv(`export function f(){ const p = new Proxy({ a: 1 }, { deleteProperty() { return false; } }); return Reflect.deleteProperty(p, "a"); }`),
    ).toBe(false);
    expect(
      valv(`export function f(){ const p = new Proxy({ a: 1 }, { deleteProperty(t, k) { return true; } }); return Reflect.deleteProperty(p, "a"); }`),
    ).toBe(true);
  });

  it("无陷阱代理的 delete 走靶语义（\"a\" in p → false）（control）", () => {
    expect(
      valv(`export function f(){ const p = new Proxy({ a: 1 }, {}); delete p.a; return "a" in p; }`),
    ).toBe(false);
  });

  it("Object.defineProperty 陷阱 falsy → 定抛；truthy → 不装槽", () => {
    expect(
      valv(`export function f(){ const p = new Proxy({}, { defineProperty() { return false; } }); try { Object.defineProperty(p, "b", { value: 1 }); return "ok"; } catch { return "c"; } }`),
    ).toBe("c");
    expect(
      valv(`export function f(){ const p = new Proxy({}, { defineProperty() { return true; } }); Object.defineProperty(p, "b", { value: 1 }); return p.b; }`),
    ).toBe(undefined);
  });

  it("Object.setPrototypeOf 陷阱 falsy → 定抛；truthy → 原样", () => {
    expect(
      valv(`export function f(){ const p = new Proxy({}, { setPrototypeOf() { return false; } }); try { Object.setPrototypeOf(p, {}); return "ok"; } catch { return "c"; } }`),
    ).toBe("c");
    expect(
      valv(`export function f(){ const p = new Proxy({}, { setPrototypeOf() { return true; } }); Object.setPrototypeOf(p, {}); return "ok"; }`),
    ).toBe("ok");
  });

  it("Object.preventExtensions 陷阱 falsy → 定抛；truthy → 原样", () => {
    expect(
      valv(`export function f(){ const p = new Proxy({}, { preventExtensions() { return false; } }); try { Object.preventExtensions(p); return "ok"; } catch { return "c"; } }`),
    ).toBe("c");
    expect(
      valv(`export function f(){ const p = new Proxy({}, { preventExtensions() { return true; } }); Object.preventExtensions(p); return "ok"; }`),
    ).toBe("ok");
  });

  it("Object.getPrototypeOf / Reflect.getPrototypeOf 陷阱 → null 折 null", () => {
    expect(
      valv(`export function f(){ const p = new Proxy({}, { getPrototypeOf() { return null; } }); return Object.getPrototypeOf(p); }`),
    ).toBe(null);
    expect(
      valv(`export function f(){ const p = new Proxy({}, { getPrototypeOf() { return null; } }); return Reflect.getPrototypeOf(p); }`),
    ).toBe(null);
  });

  it("Reflect.setPrototypeOf / preventExtensions 陷阱 falsy → false", () => {
    expect(
      valv(`export function f(){ const p = new Proxy({}, { setPrototypeOf() { return false; } }); return Reflect.setPrototypeOf(p, {}); }`),
    ).toBe(false);
    expect(
      valv(`export function f(){ const p = new Proxy({}, { preventExtensions() { return false; } }); return Reflect.preventExtensions(p); }`),
    ).toBe(false);
  });

  it("无陷阱 Reflect.setPrototypeOf(new Proxy({},{}), null) → true（control）", () => {
    expect(valv(`export function f(){ return Reflect.setPrototypeOf(new Proxy({}, {}), null); }`)).toBe(true);
  });
});
