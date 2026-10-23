/**
 * 族 65 · core 剩余 6 条（BC #28 / #44 / #45 + 族 62 的 3 条）——新钉。
 *
 * 每条断言的期望值均与 **node v26.10.0 原生**逐条对拍（见各例注释里的
 * 「原生：」行；探针脚本 tmp/probe/fix-r95/W17/*.mjs 跑的是同一批源码，
 * 引擎侧与 node 侧逐值比对）。
 *
 * 覆盖面：
 * - 第 1 条 · BC #44：`Object.getOwnPropertySymbols` 的自有 symbol 键面
 *   （原生：普通对象 / 数组 / 字符串 / 数字 / 函数 / Error 实例 / TA 实例 /
 *   **生成器对象** ⇒ `[]`；Math / JSON / Intl / Reflect ⇒ `[Symbol.toStringTag]`）。
 * - 第 2 条 · BC #45：生成器身份面（`Object.prototype.toString.call(g())`
 *   原生 "[object Generator]"）——**不扩 Abs 形状**的部分（生成器对象仍是
 *   闭 obj；类型投影面仍与空对象同形 ⇒ 属 A 类架构债，见交回报告）。
 * - 第 3 条 · BC #28：try/catch 与控制流信号（break / continue 穿过 catch；
 *   块内早退提升不得把「后续路径的值」当函数返回值）。
 * - 第 4 条 · 族 62①：`Intl.Collator` 实例面（compare / resolvedOptions）。
 * - 第 5 条 · 族 62③：Error 的 `cause` 槽（**继承**面：原生
 *   `new Error("m", Object.create({cause: 1})).cause` === 1 ⇒ 存在性确定；
 *   键不可判时读出 unknown，不得读出「确定不存在」）。
 * - 第 6 条 · 族 62④：类型化数组的元素**值**面（原生
 *   `new Int8Array(["3"])[0]` === 3）。
 */
import { describe, it, expect } from "vitest";
import { anyAbs } from "../abs.ts";
import { call, val, tupleEls, isNever, throwsError } from "./eval-helpers.ts";

/** 结果的 shape 摘要（用于「值域」类断言） */
function shapeOf(r: unknown): string {
  const a = r as { shape?: { k?: string; elements?: unknown[]; element?: { shape?: { type?: string } } } };
  const s = a?.shape;
  if (!s) return "?";
  if (s.k === "tuple") return `tuple[${s.elements?.length ?? 0}]`;
  if (s.k === "arr") return `arr<${s.element?.shape?.type ?? "?"}>`;
  return s.k ?? "?";
}

/* ── 第 1 条 · BC #44：Object.getOwnPropertySymbols 的自有 symbol 键面 ──── */

describe("族 65 · 第 1 条 —— Object.getOwnPropertySymbols 自有 symbol 键面", () => {
  it("1.1 生成器对象 ⇒ [] （原生：Object.getOwnPropertySymbols(g()) === []）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; } return Object.getOwnPropertySymbols(g()); }`,
    ).result;
    expect(tupleEls(r)).toEqual([]);
    // 无 yield 的生成器同款（原生同 [])
    const r2 = call(
      `export function f() { function* g() {} return Object.getOwnPropertySymbols(g()); }`,
    ).result;
    expect(tupleEls(r2)).toEqual([]);
  });

  it("1.2 普通对象 / 数组 / 字符串 / 数字 / 函数 / Error / TA ⇒ [] （原生同）", () => {
    for (const body of [
      `return Object.getOwnPropertySymbols({a:1});`,
      `return Object.getOwnPropertySymbols([1,2]);`,
      `return Object.getOwnPropertySymbols("ab");`,
      `return Object.getOwnPropertySymbols(1);`,
      `return Object.getOwnPropertySymbols(function f(){});`,
      `return Object.getOwnPropertySymbols(new Error("m"));`,
      `return Object.getOwnPropertySymbols(new Uint8Array([1,2]));`,
    ]) {
      expect(tupleEls(call(`export function f() { ${body} }`).result)).toEqual([]);
    }
  });

  it("1.3 宿主命名空间对象 ⇒ 1 个 symbol 键 （原生：Math ⇒ [Symbol.toStringTag]）", () => {
    const r = call(`export function f() { return Object.getOwnPropertySymbols(Math); }`).result;
    expect(shapeOf(r)).toBe("tuple[1]");
  });

  it("1.4 负控：键集不可判的接收者仍是保守 symbol[] （不折空）", () => {
    const r = call(`export function f(x) { return Object.getOwnPropertySymbols(x); }`, "f", [anyAbs]).result;
    expect(shapeOf(r)).toBe("arr<symbol>");
    // 原型 brand 的自有 symbol 键未建模 ⇒ 同样保守
    const p = call(`export function f() { return Object.getOwnPropertySymbols(Array.prototype); }`).result;
    expect(shapeOf(p)).toBe("arr<symbol>");
  });

  it("1.5 负控：nullish 接收者定抛 TypeError （原生同）", () => {
    const r = call(`export function f() { return Object.getOwnPropertySymbols(null); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});

/* ── 第 2 条 · BC #45：生成器身份面（不扩 Abs 形状的部分） ───────────── */

describe("族 65 · 第 2 条 —— 生成器身份面", () => {
  it("2.1 Object.prototype.toString.call(g()) ⇒ \"[object Generator]\" （原生同）", () => {
    // 原生：Object.prototype.toString.call((function* g(){})()) === "[object Generator]"
    expect(
      val(`export function f() { function* g() {} return Object.prototype.toString.call(g()); }`),
    ).toEqual({ ok: true, value: "[object Generator]" });
    expect(
      val(`export function f() { function* g() { yield 1; } return Object.prototype.toString.call(g()); }`),
    ).toEqual({ ok: true, value: "[object Generator]" });
  });

  it("2.2 async 生成器 ⇒ \"[object AsyncGenerator]\" （原生同，既有口径不回归）", () => {
    expect(
      val(`export function f() { async function* g() { yield 1; } return Object.prototype.toString.call(g()); }`),
    ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
  });

  it("2.3 负控：生成器对象仍无自有可枚举属性 / 无自有 symbol 键 （原生同）", () => {
    // 原生：Object.getOwnPropertyNames(g()) === []；Object.getOwnPropertySymbols(g()) === []
    expect(
      tupleEls(call(`export function f() { function* g() {} return Object.getOwnPropertyNames(g()); }`).result),
    ).toEqual([]);
    expect(
      tupleEls(call(`export function f() { function* g() {} return Object.getOwnPropertySymbols(g()); }`).result),
    ).toEqual([]);
  });
});

/* ── 第 3 条 · BC #28：try/catch 与控制流信号 ────────────────────────── */

describe("族 65 · 第 3 条 —— try/catch 与控制流信号", () => {
  it("3.1 try { break } catch {} ⇒ break 穿过 catch，外层循环退出 （原生同）", () => {
    // 原生：n === 1（break 退出 for 循环 ⇒ n++ 不再执行）
    expect(
      val(`export function f() { let n=0; for (let i=0;i<3;i++){ n++; try { break; } catch (e) {} n++; } return n; }`),
    ).toEqual({ ok: true, value: 1 });
    // 原生：out === "1"（break 前 push 已发生，break 后不再 push）
    expect(
      val(
        `export function f() { const out=[]; for (const x of [1,2,3]) { out.push(x); try { break; } catch (e) {} out.push("after"); } return out.join(","); }`,
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("3.2 try { continue } catch {} ⇒ continue 穿过 catch （原生同）", () => {
    // 原生：n === 3（continue 跳过本轮剩余语句 ⇒ 三轮都只 n++ 一次）
    expect(
      val(`export function f() { let n=0; for (let i=0;i<3;i++){ n++; try { continue; } catch (e) {} n++; } return n; }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("3.3 try 块内的早退提升：后续路径的值不得被当成函数返回值 （原生：1）", () => {
    // 原生：let n=0; try { if (0) return 42; n++; } catch (e) {} return n;  ⇒ 1
    // （此前引擎折 undefined —— 把「块内后续路径的值」当成了函数返回值）
    expect(
      val(`export function f() { let n=0; try { if (0) return 42; n++; } catch (e) {} return n; }`),
    ).toEqual({ ok: true, value: 1 });
    // 原生：try 块内测试为真 ⇒ 早退值 42
    expect(
      val(`export function f() { let n=0; try { if (1) return 42; n++; } catch (e) {} return n; }`),
    ).toEqual({ ok: true, value: 42 });
  });

  it("3.4 catch 体 / finally 体内的早退提升同口径 （原生：1 / 2）", () => {
    expect(
      val(`export function f() { let n=0; try { throw 1; } catch (e) { if (0) return 42; n++; } return n; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { let n=0; try { n=1; } finally { if (0) return 42; n++; } return n; }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("3.5 负控：函数体顶层（块外）的早退提升口径不变 （原生：1 / 42）", () => {
    expect(val(`export function f() { let n=0; if (0) return 42; n++; return n; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(val(`export function f() { let n=0; if (1) return 42; n++; return n; }`)).toEqual({
      ok: true,
      value: 42,
    });
  });
});

/* ── 第 4 条 · 族 62①：Intl.Collator 实例面 ─────────────────────────── */

describe("族 65 · 第 4 条 —— Intl.Collator 实例面", () => {
  it("4.1 compare / resolvedOptions ⇒ \"function\" （原生同）", () => {
    // 原生：typeof new Intl.Collator().compare === "function"
    expect(
      val(`export function f() { return typeof new Intl.Collator().compare; }`),
    ).toEqual({ ok: true, value: "function" });
    expect(
      val(`export function f() { return typeof new Intl.Collator().resolvedOptions; }`),
    ).toEqual({ ok: true, value: "function" });
  });

  it("4.2 负控：已建模的 Intl.NumberFormat 面不回归 （原生同）", () => {
    expect(
      val(`export function f() { return typeof new Intl.NumberFormat().format; }`),
    ).toEqual({ ok: true, value: "function" });
  });
});

/* ── 第 5 条 · 族 62③：Error 的 cause 槽（继承面） ───────────────────── */

describe("族 65 · 第 5 条 —— Error 的 cause 槽", () => {
  it("5.1 继承的 cause ⇒ 读出 unknown （不得读出「确定不存在」）", () => {
    // 原生：new Error("m", Object.create({cause: 1})).cause === 1（原型链命中）
    // 引擎口径：值不经原型链 Get 解析 ⇒ 保守 unknown；**不得**是精确 undefined
    const r = call(
      `export function f() { const o = Object.create({cause: 1}); return new Error("m", o).cause; }`,
    ).result;
    const disp = shapeOf(r);
    expect(disp).not.toBe("prim");
    const v = val(
      `export function f() { const o = Object.create({cause: 1}); return new Error("m", o).cause; }`,
    );
    expect(v.ok).toBe(false);
  });

  it("5.2 继承的 cause ⇒ 存在性确定（原生：\"cause\" in e === true）", () => {
    expect(
      val(
        `export function f() { const o = Object.create({cause: 1}); return "cause" in new Error("m", o); }`,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("5.3 自有 cause 键 ⇒ 值精确 （原生：1）", () => {
    expect(
      val(`export function f() { return new Error("m", {cause: 1}).cause; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("5.4 负控：无 options / 闭 obj 无 cause 键 ⇒ 确定无 cause 槽 （原生同）", () => {
    // 原生：new Error("m").cause === undefined；"cause" in e === false
    expect(val(`export function f() { return new Error("m").cause; }`)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(val(`export function f() { return "cause" in new Error("m"); }`)).toEqual({
      ok: true,
      value: false,
    });
    expect(val(`export function f() { return new Error("m", {a:1}).cause; }`)).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

/* ── 第 6 条 · 族 62④：类型化数组的元素值面 ─────────────────────────── */

describe("族 65 · 第 6 条 —— 类型化数组的元素值面", () => {
  it("6.1 字符串源逐元素 ToNumber ⇒ 精确值 （原生：new Int8Array([\"3\"])[0] === 3）", () => {
    expect(val(`export function f() { return new Int8Array(["3"])[0]; }`)).toEqual({
      ok: true,
      value: 3,
    });
    expect(val(`export function f() { return new Int8Array([1])[0]; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("6.2 整数 TA 的取值转换（模 2^n 回绕 / 向零截断） （原生同）", () => {
    // 原生：new Uint8Array([256])[0] === 0；new Int8Array([200])[0] === -56
    expect(val(`export function f() { return new Uint8Array([256])[0]; }`)).toEqual({
      ok: true,
      value: 0,
    });
    expect(val(`export function f() { return new Int8Array([200])[0]; }`)).toEqual({
      ok: true,
      value: -56,
    });
    // 原生：new Int8Array([1.5])[0] === 1；new Uint8Array([-1])[0] === 255
    expect(val(`export function f() { return new Int8Array([1.5])[0]; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(val(`export function f() { return new Uint8Array([-1])[0]; }`)).toEqual({
      ok: true,
      value: 255,
    });
  });

  it("6.3 浮点 / bigint 家族同口径 （原生同）", () => {
    // 原生：new Float64Array([1.5])[0] === 1.5
    expect(val(`export function f() { return new Float64Array([1.5])[0]; }`)).toEqual({
      ok: true,
      value: 1.5,
    });
    // 原生：new Float32Array([0.1])[0] === 0.10000000149011612（Float32 舍入）
    expect(val(`export function f() { return new Float32Array([0.1])[0]; }`)).toEqual({
      ok: true,
      value: 0.10000000149011612,
    });
    // 原生：new BigInt64Array([1n])[0] === 1n
    expect(val(`export function f() { return new BigInt64Array([1n])[0]; }`)).toEqual({
      ok: true,
      value: 1n,
    });
  });

  it("6.4 负控：长度形态（元素不可知）仍是元素域 ∪ undefined （不假精确）", () => {
    // 原生：new Uint8Array(3)[0] === 0，但长度形态的元素值未建模 ⇒ 保守
    const r = call(`export function f() { return new Uint8Array(3)[0]; }`).result;
    expect(val(`export function f() { return new Uint8Array(3)[0]; }`).ok).toBe(false);
    expect(r).toBeTruthy();
  });
});
